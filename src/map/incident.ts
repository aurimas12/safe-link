import { booleanIntersects, circle, destination, distance, midpoint } from '@turf/turf'
import type { LayerSpecification } from 'maplibre-gl'
import { AREA_BUILDINGS_URL, BUILDINGS_DATA, fezCompaniesIn, impactSummary, type ImpactSummary } from './buildings'
import { fireEta } from './emergency'
import type { Graph } from './graph'
import { COORDINATION, companyContact, sector, type Contact, type Sector } from './responsibility'

// Incident ("detected hazard") marker with a danger radius: which buildings are inside the zone (direct impact)
// and which lose power because a substation / transformer inside the zone feeds them (cascade, via the graph).

export const INCIDENT_SOURCE = 'incident'
export const DEFAULT_RADIUS_M = 300
export const RADIUS_RANGE_M: [number, number] = [50, 1500]

// Status palette: red – incident source / T+0, orange – risk zone.
const RED = '#ef4444'

export const INCIDENT_LAYERS: LayerSpecification[] = [
  {
    id: 'incident-zone-fill',
    type: 'fill',
    source: INCIDENT_SOURCE,
    filter: ['==', ['get', 'part'], 'zone'],
    paint: { 'fill-color': RED, 'fill-opacity': 0.12 },
  },
  {
    id: 'incident-zone-line',
    type: 'line',
    source: INCIDENT_SOURCE,
    filter: ['==', ['get', 'part'], 'zone'],
    paint: { 'line-color': RED, 'line-width': 2.5, 'line-dasharray': [3, 2] },
  },
  // Radius: a line from the centre to the edge with the distance written on it.
  {
    id: 'incident-radius-line',
    type: 'line',
    source: INCIDENT_SOURCE,
    filter: ['==', ['get', 'part'], 'radius'],
    paint: { 'line-color': '#fecaca', 'line-width': 1.5, 'line-dasharray': [2, 1.5] },
  },
  {
    id: 'incident-radius-label',
    type: 'symbol',
    source: INCIDENT_SOURCE,
    filter: ['==', ['get', 'part'], 'label'],
    layout: {
      'text-field': ['get', 'text'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 13,
      'text-offset': [0, -0.9],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#7f1d1d', 'text-halo-width': 2 },
  },
]

export interface Incident {
  center: [number, number]
  radiusM: number
}

export function incidentZone(incident: Incident): GeoJSON.FeatureCollection {
  const zone = circle(incident.center, incident.radiusM / 1000, { steps: 96, units: 'kilometers', properties: { part: 'zone' } })
  // The radius is drawn towards the east so it does not cover the marker label area.
  const edge = destination(incident.center, incident.radiusM / 1000, 90, { units: 'kilometers' })
  const label = midpoint(incident.center, edge)
  return {
    type: 'FeatureCollection',
    features: [
      zone,
      { type: 'Feature', properties: { part: 'radius' }, geometry: { type: 'LineString', coordinates: [incident.center, edge.geometry.coordinates] } },
      { ...label, properties: { part: 'label', text: `${incident.radiusM} m` } },
    ],
  }
}

// Surrounding buildings are needed in JS for the zone test – loaded once (3.5 MB).
let areaPromise: Promise<GeoJSON.FeatureCollection> | null = null
const loadArea = () => (areaPromise ??= fetch(AREA_BUILDINGS_URL).then((r) => r.json() as Promise<GeoJSON.FeatureCollection>))

// ---------------------------------------------------------------------------------------------
// Address: official Klaipėda address locator (AB „Klaipėdos vanduo“ public GeocodeServer).

const KV = 'https://maps.vanduo.lt/arcgis/rest/services'

export async function reverseGeocode(center: [number, number]): Promise<string | null> {
  const params = new URLSearchParams({
    location: JSON.stringify({ x: center[0], y: center[1], spatialReference: { wkid: 4326 } }),
    distance: '300',
    f: 'json',
  })
  try {
    const res = await fetch(`${KV}/Klaipeda_Address_Locator/GeocodeServer/reverseGeocode?${params}`)
    const data = (await res.json()) as { address?: { Match_addr?: string } }
    return data.address?.Match_addr ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------
// Water, sewage and stormwater assets in the zone with their owners and operators (live query).

const WATER_NETWORKS = [
  { key: 'water', label: 'Water supply pipes', layers: ['V_sistema_ViesamNaudojimui/MapServer/5'] },
  { key: 'valves', label: 'Water valves', layers: ['V_sistema_ViesamNaudojimui/MapServer/3'] },
  { key: 'hydrants', label: 'Hydrants', layers: ['Hidrantai_ViesamNaudojimui/MapServer/0'] },
  { key: 'sewer', label: 'Sewage pipes', layers: ['FK_sistema_ViesamNaudojimui/MapServer/5', 'FK_sistema_ViesamNaudojimui/MapServer/6'] },
  {
    key: 'storm',
    label: 'Stormwater pipes',
    layers: ['LK_sistema_ViesamNaudojimui/MapServer/4', 'LK_sistema_ViesamNaudojimui/MapServer/5'],
  },
] as const

// Source values → readable text; the original value is kept in brackets.
const OWNER_LABEL: Record<string, string> = {
  'AB "Klaipedos vanduo"': 'AB „Klaipėdos vanduo“',
  'Apžiuri AB "Klaipedos vanduo"': 'inspected by AB „Klaipėdos vanduo“',
  Svetimas: 'third party (Svetimas)',
  Savivaldybes: 'municipality (Savivaldybės)',
  Kiti: 'other operators (Kiti)',
  Nežinoma: 'unknown (Nežinoma)',
}
export const ownerLabel = (v: string) => OWNER_LABEL[v] ?? v

export interface AssetGroup {
  key: string
  label: string
  count: number
  // operator (AssemblerId) → owner (Owner) → count
  operators: Record<string, Record<string, number>>
}

async function waterAssets(incident: Incident): Promise<AssetGroup[]> {
  const geometry = JSON.stringify({ x: incident.center[0], y: incident.center[1], spatialReference: { wkid: 4326 } })
  const stats = JSON.stringify([{ statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }])
  return Promise.all(
    WATER_NETWORKS.map(async (net) => {
      const operators: Record<string, Record<string, number>> = {}
      let count = 0
      for (const layer of net.layers) {
        const params = new URLSearchParams({
          geometry,
          geometryType: 'esriGeometryPoint',
          inSR: '4326',
          distance: String(incident.radiusM),
          units: 'esriSRUnit_Meter',
          spatialRel: 'esriSpatialRelIntersects',
          where: '1=1',
          outStatistics: stats,
          groupByFieldsForStatistics: 'Owner,AssemblerId',
          f: 'json',
        })
        const res = await fetch(`${KV}/${layer}/query?${params}`)
        const data = (await res.json()) as { features?: { attributes: { Owner: string; AssemblerId: string; n: number } }[] }
        for (const { attributes: a } of data.features ?? []) {
          const op = a.AssemblerId ?? 'Nežinoma'
          const own = a.Owner ?? 'Nežinoma'
          operators[op] ??= {}
          operators[op][own] = (operators[op][own] ?? 0) + a.n
          count += a.n
        }
      }
      return { key: net.key, label: net.label, count, operators }
    }),
  )
}

// ---------------------------------------------------------------------------------------------

export interface Recipient {
  role: 'operator' | 'company' | 'coordination'
  name: string
  reason: string
  contact: Partial<Contact> | null
}

export interface IncidentSummary {
  location: [number, number]
  radiusM: number
  zone: ImpactSummary
  // null – the dependency graph is still loading
  power: { hv: string[]; transformers: number; units: string[] } | null
  cascade: { power: ImpactSummary | null; water: ImpactSummary | null; note: string | null }
  // null – Klaipėdos vanduo data could not be loaded
  water: AssetGroup[] | null
  fire: { station: string; minutes: number } | null
}

export interface IncidentAnalysis {
  summary: IncidentSummary
  direct: { lez: number[]; area: number[] }
  cascade: { lez: number[]; area: number[] }
  recipients: Recipient[]
}

const idOf = (f: GeoJSON.Feature) => Number(f.properties!.OBJECTID)

// Which network failures an incident of this sector causes inside the zone (cascade through the graph).
// Fire / chemical / explosion: the zone is evacuated and all network nodes in it are treated as failed.
const CASCADE: Record<Sector, { power: boolean; water: boolean }> = {
  power: { power: true, water: false },
  gas: { power: false, water: false },
  water: { power: false, water: true },
  sewer: { power: false, water: false },
  storm: { power: false, water: false },
  fire: { power: true, water: true },
}

export async function analyzeIncident(incident: Incident, graph: Graph | null, incidentSector: Sector): Promise<IncidentAnalysis> {
  const zone = incidentZone(incident).features.find((f) => f.properties?.part === 'zone') as GeoJSON.Feature<GeoJSON.Polygon>
  const [area, water] = await Promise.all([loadArea(), waterAssets(incident).catch(() => null)])
  const lezIds = new Set(BUILDINGS_DATA.features.map(idOf))

  // Direct impact: building footprint touches the zone.
  const directLez = BUILDINGS_DATA.features.filter((f) => booleanIntersects(f, zone))
  const directArea = area.features.filter((f) => !lezIds.has(idOf(f)) && booleanIntersects(f, zone))
  const direct = new Set([...directLez, ...directArea].map((f) => `building/${idOf(f)}`))

  // Cascade (graph): network nodes inside the zone fail → every building they feed loses the service.
  const inZone = (c: [number, number]) => distance(c, incident.center, { units: 'meters' }) <= incident.radiusM
  const nodes = graph ? graph.file.nodes.filter((n) => n.type !== 'building' && inZone(n.coords)) : []
  const powerNodes = nodes.filter((n) => n.type === 'substation' || n.type === 'substation_hv')
  const waterNodes = nodes.filter((n) => n.type === 'water_valve' || n.type === 'water_main')
  const cascadeOf = (list: typeof nodes) => {
    const out = new Set<string>()
    for (const n of list) for (const b of n.affects ?? []) if (!direct.has(b)) out.add(b)
    return out
  }
  const powerCascade = CASCADE[incidentSector].power ? cascadeOf(powerNodes) : new Set<string>()
  const waterCascade = CASCADE[incidentSector].water ? cascadeOf(waterNodes) : new Set<string>()
  const cascade = new Set([...powerCascade, ...waterCascade])

  const split = (ids: Iterable<string>) => {
    const nums = [...ids].map((b) => Number(b.slice('building/'.length)))
    return { lez: nums.filter((n) => lezIds.has(n)), area: nums.filter((n) => !lezIds.has(n)) }
  }
  const purpose = new Map<number, string | null>(area.features.map((f) => [idOf(f), f.properties!.PASK as string | null]))
  const byPurpose = (ids: number[]) => {
    const out: Record<string, number> = {}
    for (const id of ids) {
      const p = purpose.get(id) ?? 'nežinoma'
      out[p] = (out[p] ?? 0) + 1
    }
    return out
  }


  const d = split(direct)
  const summaryOf = (ids: Set<string>) => {
    const x = split(ids)
    return impactSummary({ lez: x.lez.length, other: x.area.length, other_by_purpose: byPurpose(x.area) }, ids)
  }

  // Power: assets in the zone and their ESO units (service territories differ).
  const esoUnits = [...new Set(powerNodes.map((n) => n.unit).filter(Boolean))] as string[]
  const power = graph
    ? {
        hv: powerNodes.filter((n) => n.type === 'substation_hv').map((n) => `${n.name} ${n.voltage_kv} kV`),
        transformers: powerNodes.filter((n) => n.type === 'substation').length,
        units: esoUnits,
      }
    : null
  const modelled = CASCADE[incidentSector]
  const cascadeInfo = {
    power: powerCascade.size ? summaryOf(powerCascade) : null,
    water: waterCascade.size ? summaryOf(waterCascade) : null,
    note: !graph
      ? 'Loading the dependency graph…'
      : !modelled.power && !modelled.water
        ? `Cascade is not modelled for ${sector(incidentSector).label.toLowerCase()} incidents.`
        : null,
  }

  // Water, sewage, stormwater assets with operators.
  const operatorsAll: Record<string, Record<string, number>> = {}
  for (const g of water ?? []) {
    for (const [op, owners] of Object.entries(g.operators)) {
      operatorsAll[op] ??= {}
      for (const [own, n] of Object.entries(owners)) operatorsAll[op][own] = (operatorsAll[op][own] ?? 0) + n
    }
  }

  // Fastest fire service arrival: the best ETA among FEZ buildings in the zone, else the nearest FEZ building.
  const etaCandidates = d.lez.length
    ? d.lez
    : [...lezIds]
        .sort(
          (a, b) =>
            distance(BUILDINGS_DATA.features.find((f) => idOf(f) === a)!.properties!._centroid, incident.center) -
            distance(BUILDINGS_DATA.features.find((f) => idOf(f) === b)!.properties!._centroid, incident.center),
        )
        .slice(0, 1)
  const fire = etaCandidates.map((id) => fireEta(`building/${id}`)).filter(Boolean).sort((a, b) => a!.minutes - b!.minutes)[0] ?? null

  const summary: IncidentSummary = {
    location: incident.center,
    radiusM: incident.radiusM,
    zone: summaryOf(direct),
    power,
    cascade: cascadeInfo,
    water,
    fire,
  }

  // Who has to be informed: network operators with assets in the zone, affected FEZ companies, FEZ management.
  const recipients: Recipient[] = [
    { role: 'coordination', name: COORDINATION.name, reason: 'FEZ coordination', contact: COORDINATION },
  ]
  for (const unit of esoUnits) {
    recipients.push({ role: 'operator', name: `ESO – ${unit}`, reason: 'power assets in the zone', contact: sector('power').team })
  }
  const kvOps = Object.keys(operatorsAll).filter((op) => op.includes('Klaipedos vanduo'))
  if (kvOps.length) {
    recipients.push({ role: 'operator', name: 'AB „Klaipėdos vanduo“', reason: 'water / sewage assets in the zone', contact: sector('water').team })
  }
  const thirdParty = Object.entries(operatorsAll).filter(([op]) => !op.includes('Klaipedos vanduo'))
  for (const [op, owners] of thirdParty) {
    const n = Object.values(owners).reduce((a, b) => a + b, 0)
    recipients.push({
      role: 'operator',
      name: ownerLabel(op),
      reason: `${n} water / sewage objects in the zone (owners: ${Object.keys(owners).map(ownerLabel).join(', ')}) – operator to be identified`,
      contact: null,
    })
  }
  const inZoneCompanies = fezCompaniesIn(direct)
  const cascadeCompanies = fezCompaniesIn(cascade).filter((c) => !inZoneCompanies.includes(c))
  for (const name of inZoneCompanies) recipients.push({ role: 'company', name, reason: 'building in the danger zone', contact: companyContact(name) })
  for (const name of cascadeCompanies) {
    const why = [
      fezCompaniesIn(powerCascade).includes(name) ? 'power' : null,
      fezCompaniesIn(waterCascade).includes(name) ? 'water' : null,
    ].filter(Boolean)
    recipients.push({ role: 'company', name, reason: `may lose ${why.join(' and ')} (cascade)`, contact: companyContact(name) })
  }

  return { summary, direct: d, cascade: split(cascade), recipients }
}
