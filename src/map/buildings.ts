import type { FilterSpecification, LayerSpecification } from 'maplibre-gl'
import areaBuildingsUrl from '../data/area_buildings.json?url'
import lezBuildings from '../data/lez_buildings.json'
import lezCompanies from '../data/lez_companies.json'
import type { LayerGroup } from './layers'

// Buildings: official GRPK footprints and attributes (unchanged) – FEZ buildings (with OSM companies)
// and surrounding buildings in the graph area (npm run fetch:buildings, fetch:area-buildings).
export const BUILDINGS_DATA = lezBuildings as unknown as GeoJSON.FeatureCollection & {
  metadata: { fetched_at: string; ntr_purposes: Record<string, string>; ntr_purposes_en: Record<string, string> }
}
export const AREA_BUILDINGS_URL = areaBuildingsUrl
export const BUILDINGS_SOURCE = 'lez-buildings'
export const AREA_SOURCE = 'area-buildings'

const LEZ_COLOR = '#cbd5e1'
const AREA_COLOR = '#64748b'
const SELECTED = '#facc15'
// Buildings affected by a failure of the selected network node – "risk zone" orange from the status palette.
const AFFECTED = '#f97316'
const NONE: ['==', ['get', string], number] = ['==', ['get', 'OBJECTID'], -1]

export const BUILDINGS_GROUP: LayerGroup = {
  id: 'lez_buildings',
  label: 'FEZ buildings',
  color: LEZ_COLOR,
  count: BUILDINGS_DATA.features.length,
  layers: [
    {
      id: 'lez-buildings-fill',
      type: 'fill',
      source: BUILDINGS_SOURCE,
      // Buildings with a known company are a bit brighter.
      paint: { 'fill-color': LEZ_COLOR, 'fill-opacity': ['case', ['has', '_name'], 0.35, 0.18] },
    },
    {
      id: 'lez-buildings-outline',
      type: 'line',
      source: BUILDINGS_SOURCE,
      paint: { 'line-color': LEZ_COLOR, 'line-width': 1, 'line-opacity': 0.8 },
    },
    {
      id: 'lez-buildings-label',
      type: 'symbol',
      source: BUILDINGS_SOURCE,
      filter: ['has', '_name'],
      minzoom: 15,
      layout: { 'text-field': ['get', '_name'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-max-width': 10 },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#0f172a', 'text-halo-width': 1.6 },
    },
  ],
}

export const AREA_GROUP: LayerGroup = {
  id: 'area_buildings',
  label: 'Surrounding buildings',
  color: AREA_COLOR,
  count: null,
  layers: [
    {
      id: 'area-buildings-fill',
      type: 'fill',
      source: AREA_SOURCE,
      paint: { 'fill-color': AREA_COLOR, 'fill-opacity': 0.25 },
    },
    {
      id: 'area-buildings-outline',
      type: 'line',
      source: AREA_SOURCE,
      minzoom: 14,
      paint: { 'line-color': AREA_COLOR, 'line-width': 0.8, 'line-opacity': 0.8 },
    },
  ],
}

// Selection and influence highlights – always visible, independent of the layer toggles.
export const SELECTED_LAYERS: Record<string, string> = {
  [BUILDINGS_SOURCE]: 'lez-buildings-selected',
  [AREA_SOURCE]: 'area-buildings-selected',
}
export const AFFECTED_LAYERS: Record<string, string> = {
  [BUILDINGS_SOURCE]: 'lez-buildings-affected',
  [AREA_SOURCE]: 'area-buildings-affected',
}
// Incident: buildings inside the danger zone (red) and those losing power through the cascade (orange).
export const INCIDENT_DIRECT_LAYERS: Record<string, string> = {
  [BUILDINGS_SOURCE]: 'lez-buildings-incident',
  [AREA_SOURCE]: 'area-buildings-incident',
}
export const INCIDENT_CASCADE_LAYERS: Record<string, string> = {
  [BUILDINGS_SOURCE]: 'lez-buildings-incident-cascade',
  [AREA_SOURCE]: 'area-buildings-incident-cascade',
}
const fillLayer = (id: string, source: string, color: string, opacity: number): LayerSpecification => ({
  id,
  type: 'fill',
  source,
  filter: NONE,
  paint: { 'fill-color': color, 'fill-opacity': opacity, 'fill-outline-color': color },
})

export const HIGHLIGHT_LAYERS: LayerSpecification[] = [
  ...Object.entries(INCIDENT_CASCADE_LAYERS).map(([source, id]) => fillLayer(id, source, AFFECTED, 0.45)),
  ...Object.entries(INCIDENT_DIRECT_LAYERS).map(([source, id]) => fillLayer(id, source, '#ef4444', 0.6)),
  ...Object.entries(AFFECTED_LAYERS).map(
    ([source, id]): LayerSpecification => ({
      id,
      type: 'fill',
      source,
      filter: NONE,
      paint: { 'fill-color': AFFECTED, 'fill-opacity': 0.55, 'fill-outline-color': AFFECTED },
    }),
  ),
  ...Object.entries(SELECTED_LAYERS).map(
    ([source, id]): LayerSpecification => ({
      id,
      type: 'line',
      source,
      filter: NONE,
      paint: { 'line-color': SELECTED, 'line-width': 3 },
    }),
  ),
]
export const byIds = (ids: number[]): FilterSpecification =>
  ids.length ? ['in', ['get', 'OBJECTID'], ['literal', ids]] : NONE

// ---------------------------------------------------------------------------------------------
// Companies (Sodra employees, Registrų centras revenue) – matched to OSM company names.

interface CompanyRecord {
  code: string
  name: string
  municipality: string
  activity: string | null
  month: string
  employees: number | null
  avg_wage_eur: number | null
}
interface CompanyMatch {
  confidence: 'tikslus' | 'tikėtinas' | 'kitur' | 'neaiškus'
  sodra: CompanyRecord | null
  finance: { revenue_eur: number; period_to: string } | null
  candidates: CompanyRecord[]
}
const COMPANIES = (lezCompanies as unknown as { companies: Record<string, CompanyMatch> }).companies

const MATCH_LABEL: Record<CompanyMatch['confidence'], string> = {
  tikslus: 'exact match',
  tikėtinas: 'likely match – similar name, worth checking',
  kitur: 'company registered elsewhere – figures are for the whole company, not the FEZ site',
  neaiškus: 'not matched',
}
const eur = (n: number) => `€${new Intl.NumberFormat('en-GB').format(Math.round(n))}`
const month = (m: string) => `${m.slice(0, 4)}-${m.slice(4)}`
// Figures that describe the FEZ site itself (not a company registered elsewhere).
const onSite = (m: CompanyMatch | undefined) => m?.sodra && (m.confidence === 'tikslus' || m.confidence === 'tikėtinas')

function companyRows(name: string, several: boolean): [string, string][] {
  const m = COMPANIES[name]
  if (!m) return []
  const rows: [string, string][] = []
  // With several companies in a building, say which one each block is about.
  const prefix = several ? `${name}: ` : ''
  if (!m.sodra) {
    rows.push([
      'Registry',
      `${prefix}${m.candidates.length ? `not matched – ${m.candidates.length} candidates in other municipalities` : 'not found in Sodra data'}`,
    ])
    return rows
  }
  const s = m.sodra
  rows.push(['Registry', `${prefix}${s.name}, code ${s.code} (${MATCH_LABEL[m.confidence]})`])
  if (m.confidence === 'kitur') rows.push(['Registered in', s.municipality])
  if (s.activity) rows.push(['Activity', s.activity])
  if (s.employees != null) rows.push(['Employees', `${s.employees} (Sodra, ${month(s.month)})`])
  if (s.avg_wage_eur != null) rows.push(['Average wage', eur(s.avg_wage_eur)])
  if (m.finance) {
    rows.push(['Revenue', `${eur(m.finance.revenue_eur)} (${m.finance.period_to.slice(0, 4)})`])
    // Rough loss of a stopped operation – only when the company is matched to its FEZ site.
    if (onSite(m)) rows.push(['Revenue per hour', `≈ ${eur(m.finance.revenue_eur / 8760)} (annual ÷ 8,760 h)`])
  }
  return rows
}

// ---------------------------------------------------------------------------------------------

// GKODAS values of the GRPK "Pastatai" layer (from the service legend).
const GKODAS: Record<string, string> = {
  pa0: 'building',
  pa23: 'garage',
  pa58: 'greenhouse',
  pa6: 'tower-type structure',
  pa651: 'windmill, wind turbine',
  pa652: 'windmill, wind turbine',
}

interface OsmRef {
  osm_id: string
  _role: 'building' | 'site'
  name?: string
  'addr:street'?: string
  'addr:housenumber'?: string
  [tag: string]: string | undefined
}

// Filled values only; GRPK "Null" and empty fields are skipped.
const has = (v: unknown) => v != null && v !== '' && v !== 'Null'
const purposeName = (code: unknown) => BUILDINGS_DATA.metadata.ntr_purposes_en[String(code)]

const osmOf = (p: Record<string, unknown>): OsmRef[] =>
  // MapLibre returns nested arrays as JSON text.
  typeof p._osm === 'string' ? JSON.parse(p._osm) : ((p._osm as OsmRef[]) ?? [])
const namesOf = (osm: OsmRef[], role: OsmRef['_role']) =>
  [...new Set(osm.filter((o) => o._role === role).map((o) => o.name).filter(Boolean))] as string[]

export function describeBuilding(p: Record<string, unknown>, isLez: boolean): { title: string; rows: [string, string][] } {
  const osm = osmOf(p)
  const own = namesOf(osm, 'building')
  const site = namesOf(osm, 'site').filter((n) => !own.includes(n))
  const addresses = [
    ...new Set(osm.filter((o) => o['addr:street']).map((o) => `${o['addr:street']} ${o['addr:housenumber'] ?? ''}`.trim())),
  ]

  const rows: [string, string][] = [['Zone', isLez ? 'Klaipėda FEZ' : 'outside the FEZ']]
  if (own.length) rows.push(['Company (OSM)', own.join(', ')])
  if (site.length) rows.push(['Part of site (OSM)', site.join(', ')])
  if (addresses.length) rows.push(['Address (OSM)', addresses.join(', ')])
  // Company figures only on its main building – so they are not counted twice.
  for (const name of own) rows.push(...companyRows(name, own.length > 1))
  if (has(p.PASK)) {
    const purpose = purposeName(p.PASK)
    rows.push(['Purpose', purpose ? `${purpose} (${p.PASK})` : String(p.PASK)])
  }
  if (has(p.GKODAS)) rows.push(['Type', GKODAS[String(p.GKODAS)] ?? String(p.GKODAS)])
  if (has(p.GRAKTAS)) {
    // Real estate register unique number, written in groups of 4: 4400-5271-6537.
    const n = String(p.GRAKTAS)
    rows.push(['Register unique no.', n.length === 12 ? n.match(/.{4}/g)!.join('-') : n])
  }
  if (has(p.SHAPE_Area)) rows.push(['Footprint', `${Math.round(Number(String(p.SHAPE_Area).replace(',', '.')))} m²`])
  // GRPK returns the date as milliseconds since 1970.
  if (has(p.Suk_DATA)) {
    const date = typeof p.Suk_DATA === 'number' ? new Date(p.Suk_DATA).toISOString().slice(0, 10) : String(p.Suk_DATA)
    rows.push(['GRPK record', date])
  }
  if (isLez && !own.length && !site.length && !addresses.length) rows.push(['Company', 'no OSM data for this building'])

  const purpose = has(p.PASK) ? purposeName(p.PASK) : null
  return { title: own[0] ?? site[0] ?? (purpose ? `${purpose} building` : 'Building'), rows }
}

// ---------------------------------------------------------------------------------------------
// Influence summary for a set of affected buildings (graph ids "building/<OBJECTID>").

// FEZ companies (registry-listed names) whose main building is among the given buildings.
export function fezCompaniesIn(buildingIds: Iterable<string>): string[] {
  const out = new Set<string>()
  for (const id of buildingIds) {
    const p = lezById.get(id)
    if (!p) continue
    for (const name of namesOf(osmOf(p), 'building')) if (name in COMPANIES) out.add(name)
  }
  return [...out]
}

const lezById = new Map(BUILDINGS_DATA.features.map((f) => [`building/${f.properties!.OBJECTID}`, f.properties!]))

export interface ImpactSummary {
  lez: number
  other: number
  // Surrounding buildings by purpose (English label, count), largest first.
  purposes: [string, number][]
  companies: string[]
  // Only companies matched to their FEZ site (exact / likely) – not "registered elsewhere".
  employees: number
  perHour: number
}

export function impactSummary(
  impact: { lez: number; other: number; other_by_purpose: Record<string, number> },
  affected: Iterable<string>,
): ImpactSummary {
  const purposes = Object.entries(impact.other_by_purpose)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]): [string, number] => [purposeName(code) ?? (code === 'nežinoma' ? 'Unknown purpose' : code), n])
  const companies = new Set<string>()
  let employees = 0
  let perHour = 0
  for (const id of affected) {
    const p = lezById.get(id)
    if (!p) continue
    // Only real companies (the registry list) – not substations or ATMs that also carry an OSM name.
    for (const name of namesOf(osmOf(p), 'building').filter((n) => n in COMPANIES)) {
      if (companies.has(name)) continue
      companies.add(name)
      const m = COMPANIES[name]
      if (!onSite(m)) continue
      employees += m!.sodra!.employees ?? 0
      if (m!.finance) perHour += m!.finance.revenue_eur / 8760
    }
  }
  return { lez: impact.lez, other: impact.other, purposes, companies: [...companies], employees, perHour }
}

export const formatEur = eur

export function describeImpact(
  impact: { lez: number; other: number; other_by_purpose: Record<string, number> },
  affected: string[],
  label = 'Buildings depending on it',
): [string, string][] {
  const s = impactSummary(impact, affected)
  const rows: [string, string][] = [[label, `${s.lez} in the FEZ, ${s.other} outside`]]
  if (s.purposes.length) rows.push(['Outside the FEZ', s.purposes.slice(0, 5).map(([l, n]) => `${l} ${n}`).join(', ')])
  if (s.companies.length) rows.push(['FEZ companies', s.companies.join(', ')])
  if (s.employees) rows.push(['Employees (matched companies)', String(s.employees)])
  if (s.perHour) rows.push(['Revenue at risk per hour', `≈ ${eur(s.perHour)}`])
  return rows
}
