import { booleanPointInPolygon } from '@turf/turf'
import pagdUrl from '../data/incidents_pagd.json?url'
import kvData from '../data/incidents_kv.json'
import { BUILDINGS_DATA, impactSummary, type ImpactSummary } from '../map/buildings'
import { FEZ_BOUNDARY } from '../map/config'
import type { Graph } from '../map/graph'

// Incident statistics: PAGD (fire & rescue, Klaipėda city, last 12 months) and Klaipėdos vanduo accidents.
// Categories are derived only from what is recorded (cause / burning material) – nothing is guessed.

export interface PagdRecord {
  korteles_id: string
  korteles_data: string
  iskvietimo_laikas: string | null
  likvidavimo_laikas: string | null
  ivykio_priezastis: string | null
  ivykio_medziaga: string | null
  ivykio_vieta: string | null
  vietoves_tipas: string | null
  isgelbeta_zmoniu: number | null
  zuvo_zmoniu: number | null
  traumuota_zmoniu: number | null
  sunaikinta_statiniu: number | null
}
export interface PagdFile {
  metadata: { data_from: string; data_to: string; fetched_at: string; municipality: string; note: string }
  records: PagdRecord[]
}

let pagdPromise: Promise<PagdFile> | null = null
export const loadPagd = () => (pagdPromise ??= fetch(pagdUrl).then((r) => r.json() as Promise<PagdFile>))

// --- categories -----------------------------------------------------------------------------

export const CATEGORIES = ['Fire', 'Traffic accident', 'Natural hazard', 'Under investigation', 'Other / not specified'] as const
export type Category = (typeof CATEGORIES)[number]

const FIRE_CAUSES = new Set([
  'Pašalinis ugnies šaltinis',
  'Tyčinė žmonių veika (padegimai)',
  'Elektros įrenginių, prietaisų, elektros instaliacijos gedimai',
  'Transporto priemonių elektros instaliacijos gedimai',
  'Kiti transporto priemonių gedimai',
  'Neatsargus žmogaus elgesys',
  'Savaiminis medžiagų užsidegimas',
  'Neatsargus rūkymas',
  'Transporto priemonių kuro tiekimo sistemos gedimai',
  'Krosnių, židinių bei dūmtraukių įrengimo ir eksploatavimo reikalavimų pažeidimai',
])

export function categoryOf(r: PagdRecord): Category {
  const cause = r.ivykio_priezastis
  if (cause === 'Eismo įvykio padariniai') return 'Traffic accident'
  if (cause === 'Gamtiniai pavojai (potvynis, viesulas ir pan.)') return 'Natural hazard'
  // A burning material or a fire cause is recorded → a fire.
  if (r.ivykio_medziaga || (cause && FIRE_CAUSES.has(cause))) return 'Fire'
  if (cause === 'Įvykis tiriamas') return 'Under investigation'
  return 'Other / not specified'
}

// English labels for recorded PAGD causes / materials / places (original kept in the table view).
const CAUSE_EN: Record<string, string> = {
  'Kitos priežastys': 'Other causes',
  'Eismo įvykio padariniai': 'Traffic accident consequences',
  'Įvykis tiriamas': 'Under investigation',
  'Gamtiniai pavojai (potvynis, viesulas ir pan.)': 'Natural hazards (flood, storm)',
  'Pašalinis ugnies šaltinis': 'External fire source',
  'Tyčinė žmonių veika (padegimai)': 'Arson',
  'Elektros įrenginių, prietaisų, elektros instaliacijos gedimai': 'Electrical equipment / wiring fault',
  'Transporto priemonių elektros instaliacijos gedimai': 'Vehicle electrical fault',
  'Kiti transporto priemonių gedimai': 'Other vehicle fault',
  'Neatsargus žmogaus elgesys': 'Careless behaviour',
  'Savaiminis medžiagų užsidegimas': 'Spontaneous ignition',
  'Neatsargus rūkymas': 'Careless smoking',
  'Transporto priemonių kuro tiekimo sistemos gedimai': 'Vehicle fuel system fault',
  'Krosnių, židinių bei dūmtraukių įrengimo ir eksploatavimo reikalavimų pažeidimai': 'Stove / chimney violations',
}
const MATERIAL_EN: Record<string, string> = {
  'Kiti gaminiai, medžiagos': 'Other products / materials',
  'Atliekos, šiukšlės': 'Waste, rubbish',
  'Transporto priemonės variklio skyrius': 'Vehicle engine compartment',
  Žolė: 'Grass',
  'Elektros instaliacija': 'Electrical wiring',
  'Įvadinis elektros skydas, elektros paskirstymo skydelis': 'Electrical switchboard',
  Dūmtraukis: 'Chimney',
  'Elektros buitinis prietaisas': 'Household electrical appliance',
  'Lova, čiužinys, antklodė': 'Bed, mattress, blanket',
  'Transporto priemonės kuro tiekimo sistema': 'Vehicle fuel system',
  Liftas: 'Lift',
  'Technologinis aparatas, įrenginys': 'Industrial equipment',
}
const PLACE_EN: Record<string, string> = {
  'Butas (išskyrus virtuvę)': 'Apartment (not kitchen)',
  Kitos: 'Other',
  Laiptinė: 'Staircase',
  Virtuvė: 'Kitchen',
  'Rūsys, pusrūsis': 'Basement',
  'Balkonas, lodžija': 'Balcony',
  Stogas: 'Roof',
  'Lifto šachta': 'Lift shaft',
  'Kambarys (privačiame name)': 'Room (private house)',
  'Palėpė, mansarda': 'Attic',
}
export const causeEn = (v: string | null) => (v ? (CAUSE_EN[v] ?? v) : 'Not recorded')
export const materialEn = (v: string | null) => (v ? (MATERIAL_EN[v] ?? v) : 'Not recorded')
export const placeEn = (v: string | null) => (v ? (PLACE_EN[v] ?? v) : 'Not recorded')

// --- aggregations ---------------------------------------------------------------------------

const harm = (r: PagdRecord) => (r.zuvo_zmoniu ?? 0) + (r.traumuota_zmoniu ?? 0)
const countBy = <T,>(items: T[], key: (t: T) => string) => {
  const m = new Map<string, number>()
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export interface PagdStats {
  total: number
  byCategory: { category: Category; count: number; harmed: number; deaths: number; injured: number }[]
  deaths: number
  injured: number
  rescued: number
  destroyed: number
  medianMinutes: number | null
  minutesN: number
  months: string[]
  monthGrid: Record<Category, number[]>
  hourGrid: Record<Category, number[]>
  fireCauses: [string, number][]
  fireMaterials: [string, number][]
  places: [string, number][]
}

export function pagdStats(records: PagdRecord[]): PagdStats {
  const months = [...new Set(records.map((r) => r.korteles_data.slice(0, 7)))].sort()
  const monthGrid = Object.fromEntries(CATEGORIES.map((c) => [c, months.map(() => 0)])) as Record<Category, number[]>
  const hourGrid = Object.fromEntries(CATEGORIES.map((c) => [c, Array(24).fill(0)])) as Record<Category, number[]>
  for (const r of records) {
    const c = categoryOf(r)
    monthGrid[c][months.indexOf(r.korteles_data.slice(0, 7))]++
    if (r.iskvietimo_laikas) hourGrid[c][Number(r.iskvietimo_laikas.slice(11, 13))]++
  }
  const minutes = records
    .filter((r) => r.iskvietimo_laikas && r.likvidavimo_laikas)
    .map((r) => (Date.parse(r.likvidavimo_laikas!) - Date.parse(r.iskvietimo_laikas!)) / 60000)
    .filter((m) => m >= 0)
  const fires = records.filter((r) => categoryOf(r) === 'Fire')
  return {
    total: records.length,
    byCategory: CATEGORIES.map((category) => {
      const rs = records.filter((r) => categoryOf(r) === category)
      return {
        category,
        count: rs.length,
        harmed: rs.reduce((a, r) => a + harm(r), 0),
        deaths: rs.reduce((a, r) => a + (r.zuvo_zmoniu ?? 0), 0),
        injured: rs.reduce((a, r) => a + (r.traumuota_zmoniu ?? 0), 0),
      }
    }).sort((a, b) => b.count - a.count),
    deaths: records.reduce((a, r) => a + (r.zuvo_zmoniu ?? 0), 0),
    injured: records.reduce((a, r) => a + (r.traumuota_zmoniu ?? 0), 0),
    rescued: records.reduce((a, r) => a + (r.isgelbeta_zmoniu ?? 0), 0),
    destroyed: records.reduce((a, r) => a + (r.sunaikinta_statiniu ?? 0), 0),
    medianMinutes: median(minutes),
    minutesN: minutes.length,
    months,
    monthGrid,
    hourGrid,
    fireCauses: countBy(fires.filter((r) => r.ivykio_priezastis && r.ivykio_priezastis !== 'Įvykis tiriamas' && r.ivykio_priezastis !== 'Kitos priežastys'), (r) => causeEn(r.ivykio_priezastis)),
    fireMaterials: countBy(fires.filter((r) => r.ivykio_medziaga), (r) => materialEn(r.ivykio_medziaga)),
    places: countBy(records.filter((r) => r.ivykio_vieta), (r) => placeEn(r.ivykio_vieta)),
  }
}

// --- Klaipėdos vanduo accidents ------------------------------------------------------------

interface KvProps {
  OBJECTID: number
  miestas: string | null
  pranesimo_turinys: string | null
  pranesimo_datetime: number | null
  likvidavimo_data: number | null
  ivykio_tipas: string | null
  pranesimo_tipas: string | null
  vartotoju_skaicius: number | null
  busena: string | null
}
const kv = kvData as unknown as GeoJSON.FeatureCollection<GeoJSON.Point, KvProps> & {
  metadata: { collecting_since: string; last_run: string; data_from: string | null; data_to: string | null }
}
export const KV_META = kv.metadata
export const KV_FEATURES = kv.features
export type KvFeature = (typeof kv.features)[number]

const KV_REASON_EN: Record<string, string> = {
  'Pranešimas apie planuojamą vandens tiekimo nutraukimą': 'Planned interruption',
  'Dėl PLANUOJAMŲ vandentiekio tinklų plovimo darbų SU ORU': 'Planned network flushing',
  'Vandens planuojamas nutraukimas dėl ESO': 'Planned – ESO power works',
  'Pranešimas kad yra nutrauktas vandens tiekimas': 'Unplanned interruption',
  'Pranešimas kad bus nutrauktas vanduo': 'Upcoming interruption',
}

export const kvReasonEn = (v: string | null) => (v ? (KV_REASON_EN[v] ?? v) : 'Not recorded')

export function kvStats() {
  const f = kv.features
  const fez = FEZ_BOUNDARY.features[0] as GeoJSON.Feature<GeoJSON.Polygon>
  const restore = f
    .filter((x) => x.properties.likvidavimo_data && x.properties.pranesimo_datetime)
    .map((x) => (x.properties.likvidavimo_data! - x.properties.pranesimo_datetime!) / 3600000)
  return {
    total: f.length,
    planned: f.filter((x) => x.properties.ivykio_tipas === 'Planinis').length,
    unplanned: f.filter((x) => x.properties.ivykio_tipas === 'Neplaninis').length,
    customers: f.reduce((a, x) => a + (x.properties.vartotoju_skaicius ?? 0), 0),
    medianRestoreH: median(restore),
    inFez: f.filter((x) => x.geometry && booleanPointInPolygon(x, fez)).length,
    reasons: countBy(f, (x) => kvReasonEn(x.properties.pranesimo_tipas)),
  }
}

// --- importance: critical network nodes (dependency graph) ---------------------------------

export interface CriticalNode {
  id: string
  name: string
  kind: string
  summary: ImpactSummary
}

const lezIds = new Set(BUILDINGS_DATA.features.map((f) => `building/${f.properties!.OBJECTID}`))

// 110/35 kV substations and 10 kV switching stations ranked by the FEZ revenue that depends on them.
export function criticalNodes(graph: Graph): CriticalNode[] {
  return graph.file.nodes
    .filter((n) => n.impact && (n.type === 'substation_hv' || /skirstomasis punktas/i.test(n.kind ?? '')))
    .map((n) => ({
      id: n.id,
      name: n.type === 'substation_hv' ? `${n.name} ${n.voltage_kv} kV` : (n.name ?? n.id),
      kind: n.type === 'substation_hv' ? 'Substation' : 'Switching station',
      summary: impactSummary(n.impact!, (n.affects ?? []).filter((b) => lezIds.has(b))),
    }))
    .filter((n) => n.summary.lez + n.summary.other > 0)
    .sort((a, b) => b.summary.perHour - a.summary.perHour || b.summary.lez - a.summary.lez)
}
