import { area, booleanPointInPolygon, pointOnFeature, polygon } from '@turf/turf'
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl'
import { BUILDINGS_DATA, formatEur, impactSummary, type ImpactSummary } from './buildings'
import type { Graph } from './graph'
import type { LayerGroup } from './layers'
import { KV_FEATURES } from '../stats/model'
import SEGMENTS from '../data/supply_zones.json'

// Supply zones: buildings grouped by the 110/35 kV substation that feeds them (dependency graph, ESO data).
// Colour = the chosen metric as one blue hue whose strength grows with the value (0 = no fill, outline only);
// identity = the label. Outlines are precomputed segments (npm run build:zones): each building's Voronoi cell,
// clipped to 120 m around it and merged per zone – zones never overlap and empty land stays empty.

export const ZONES_SOURCE = 'supply-zones'
export type ZoneMetric = 'perHour' | 'employees' | 'buildings' | 'water' | 'waterUnplanned' | 'customers'
export const ZONE_METRICS: { id: ZoneMetric; label: string; group: string }[] = [
  { id: 'perHour', label: 'FEZ revenue / h', group: 'Importance' },
  { id: 'employees', label: 'FEZ employees', group: 'Importance' },
  { id: 'buildings', label: 'Buildings', group: 'Importance' },
  { id: 'water', label: 'Water interruptions (all)', group: 'Incidents (Klaipėdos vanduo)' },
  { id: 'waterUnplanned', label: 'Water interruptions (unplanned)', group: 'Incidents (Klaipėdos vanduo)' },
  { id: 'customers', label: 'Customers affected by water interruptions', group: 'Incidents (Klaipėdos vanduo)' },
]
export const metricLabel = (m: ZoneMetric) => ZONE_METRICS.find((x) => x.id === m)!.label
const ZONE_BLUE = '#3987e5'
const ZONE_RGB = '57, 135, 229'
// Fill strength for a value: nothing for 0, then 0.15 … 0.65 in proportion to the largest zone.
export const zoneOpacity = (v: number, max: number) => (v <= 0 ? 0 : 0.15 + 0.5 * (v / Math.max(1, max)))
export const zoneSwatch = (v: number, max: number) => `rgba(${ZONE_RGB}, ${zoneOpacity(v, max)})`

export interface Zone {
  id: string
  name: string
  buildings: string[]
  summary: ImpactSummary
  hull: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  // Klaipėdos vanduo interruptions whose recorded point lies inside the zone outline.
  water: { total: number; planned: number; unplanned: number; customers: number; ids: number[] }
}

const lezIds = new Set(BUILDINGS_DATA.features.map((f) => `building/${f.properties!.OBJECTID}`))

export function supplyZones(graph: Graph): Zone[] {
  const groups = new Map<string, string[]>()
  for (const [buildingId, deps] of Object.entries(graph.file.buildings)) {
    const root = deps.power?.chain.at(-1)
    if (!root || graph.node.get(root)?.type !== 'substation_hv') continue
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(buildingId)
  }
  const segments = new Map(
    (SEGMENTS as unknown as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { zone: string }>).features.map((f) => [
      f.properties.zone,
      f,
    ]),
  )
  const raw = [...groups.entries()].map(([id, buildings]) => {
    const node = graph.node.get(id)!
    const byPurpose: Record<string, number> = {}
    for (const b of buildings) {
      if (lezIds.has(b)) continue
      const p = graph.node.get(b)?.purpose ?? 'nežinoma'
      byPurpose[p] = (byPurpose[p] ?? 0) + 1
    }
    const lez = buildings.filter((b) => lezIds.has(b))
    const summary = impactSummary({ lez: lez.length, other: buildings.length - lez.length, other_by_purpose: byPurpose }, lez)
    return { id, name: `${node.name} ${node.voltage_kv} kV`, buildings, summary, hull: (segments.get(id) ?? null) as Zone['hull'] }
  })
  return raw.map((z) => {
    const inside = z.hull ? KV_FEATURES.filter((f) => f.geometry && booleanPointInPolygon(f, z.hull!)) : []
    return {
      ...z,
      water: {
        total: inside.length,
        planned: inside.filter((f) => f.properties.ivykio_tipas === 'Planinis').length,
        unplanned: inside.filter((f) => f.properties.ivykio_tipas === 'Neplaninis').length,
        customers: inside.reduce((a, f) => a + (f.properties.vartotoju_skaicius ?? 0), 0),
        ids: inside.map((f) => f.properties.OBJECTID),
      },
    }
  })
}

export function metricValue(z: Zone, m: ZoneMetric): number {
  switch (m) {
    case 'perHour':
      return z.summary.perHour
    case 'employees':
      return z.summary.employees
    case 'buildings':
      return z.summary.lez + z.summary.other
    case 'water':
      return z.water.total
    case 'waterUnplanned':
      return z.water.unplanned
    case 'customers':
      return z.water.customers
  }
}
export const formatMetric = (v: number, m: ZoneMetric, eur: (v: number) => string) =>
  v === 0 && m === 'perHour' ? '—' : m === 'perHour' ? eur(v) : v.toLocaleString('en-GB')
const UNIT: Record<ZoneMetric, string> = {
  perHour: '/ h',
  employees: 'employees',
  buildings: 'buildings',
  water: 'interruptions',
  waterUnplanned: 'unplanned',
  customers: 'customers',
}
export const metricText = (v: number, m: ZoneMetric) => (m === 'perHour' && !v ? 'no FEZ revenue' : `${formatMetric(v, m, formatEur)} ${v === 1 ? UNIT[m].replace(/s$/, '') : UNIT[m]}`)

// Label goes on the biggest piece of a zone (a zone can be several separate building clusters).
function largestPart(f: NonNullable<Zone['hull']>) {
  if (f.geometry.type === 'Polygon') return f
  const parts = f.geometry.coordinates.map((c) => polygon(c))
  return parts.reduce((a, b) => (area(b) > area(a) ? b : a))
}

// Zone polygons + label points, each with its fill strength for the chosen metric.
export function zonesData(zones: Zone[], metric: ZoneMetric): GeoJSON.FeatureCollection {
  const max = Math.max(0, ...zones.map((z) => metricValue(z, metric)))
  const features: GeoJSON.Feature[] = []
  for (const z of zones) {
    if (!z.hull) continue
    const v = metricValue(z, metric)
    const props = { zone: z.id, name: z.name, opacity: zoneOpacity(v, max), empty: v <= 0 }
    features.push({ ...z.hull, properties: { ...props, part: 'area' } })
    features.push({
      ...pointOnFeature(largestPart(z.hull)),
      properties: { ...props, part: 'label', label: `${z.name.replace(/ \d+ kV$/, '')} zone\n${metricText(v, metric)}` },
    })
  }
  return { type: 'FeatureCollection', features }
}

const empty: ExpressionSpecification = ['get', 'empty']

export const ZONES_GROUP: LayerGroup = {
  id: 'supply_zones',
  label: 'Supply zones (110 kV)',
  color: ZONE_BLUE,
  count: null,
  layers: [
    {
      id: 'supply-zones-fill',
      type: 'fill',
      source: ZONES_SOURCE,
      filter: ['==', ['get', 'part'], 'area'],
      paint: { 'fill-color': ['case', empty, '#64748b', ZONE_BLUE], 'fill-opacity': ['case', empty, 0.1, ['get', 'opacity']] },
    },
    {
      id: 'supply-zones-outline',
      type: 'line',
      source: ZONES_SOURCE,
      filter: ['==', ['get', 'part'], 'area'],
      // Edge keeps neighbouring zones apart; zones with 0 for the metric get a grey outline only.
      paint: { 'line-color': ['case', empty, '#64748b', '#93c5fd'], 'line-width': 1.5, 'line-opacity': 0.9 },
    },
    {
      id: 'supply-zones-label',
      type: 'symbol',
      source: ZONES_SOURCE,
      filter: ['==', ['get', 'part'], 'label'],
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-line-height': 1.3 },
      paint: { 'text-color': ['case', empty, '#94a3b8', '#ffffff'], 'text-halo-color': '#0f172a', 'text-halo-width': 2 },
    },
  ] as LayerSpecification[],
}
