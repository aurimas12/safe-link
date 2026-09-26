import type { LayerSpecification } from 'maplibre-gl'
import lezEmergency from '../data/lez_emergency.json'
import type { LayerGroup } from './layers'

// Gelbėjimo tarnybos (OSM), PAGD priedangos / KAS / evakuacijos punktai ir važiavimo laikų įverčiai (npm run fetch:emergency).

interface Station {
  id: string
  kind: 'fire' | 'ambulance'
  name: string
  address: string | null
  coords: [number, number]
}
interface Shelter {
  id: string
  kind: 'shelter' | 'kas' | 'evacuation'
  coords: [number, number]
  props: Record<string, unknown>
}
interface Eta {
  station: string
  minutes: number
}
interface Nearby {
  id: string
  distance_m: number
}
interface BuildingEmergency {
  fire: Eta[]
  ambulance: Eta[]
  shelters: Nearby[]
  kas: Nearby[]
  evacuation: Nearby[]
}

const data = lezEmergency as unknown as {
  stations: Station[]
  shelters: Shelter[]
  buildings: Record<string, BuildingEmergency>
  metadata: { eta_note: string }
}
const stationById = new Map(data.stations.map((s) => [s.id, s]))
const shelterById = new Map(data.shelters.map((s) => [s.id, s]))

export const STATIONS_SOURCE = 'emergency-stations'
export const SHELTERS_SOURCE = 'emergency-shelters'
export const ETA_NOTE = data.metadata.eta_note

export const STATIONS_DATA: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: data.stations.map((s) => ({
    type: 'Feature',
    properties: { id: s.id, kind: s.kind, name: s.name },
    geometry: { type: 'Point', coordinates: s.coords },
  })),
}
export const SHELTERS_DATA: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: data.shelters.map((s) => ({
    type: 'Feature',
    properties: { id: s.id, kind: s.kind, name: String(s.props.pavadinimas ?? '') },
    geometry: { type: 'Point', coordinates: s.coords },
  })),
}

// Gelbėjimui – violetinė šeima (ESO rožinė, vanduo žydras, rizika – žalia/raudona/oranžinė/geltona/mėlyna).
const STATION_COLOR = '#a855f7'
const SHELTER_COLORS = { shelter: '#c4b5fd', kas: '#a78bfa', evacuation: '#ede9fe' }
const LABEL_PAINT = { 'text-color': '#ffffff', 'text-halo-color': '#0f172a', 'text-halo-width': 1.6 }

export const STATIONS_GROUP: LayerGroup = {
  id: 'emergency_stations',
  label: 'Fire and ambulance stations',
  color: STATION_COLOR,
  count: data.stations.length,
  layers: [
    {
      id: 'emergency-stations',
      type: 'circle',
      source: STATIONS_SOURCE,
      paint: {
        'circle-color': STATION_COLOR,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 16, 11],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.5,
      },
    },
    {
      id: 'emergency-stations-label',
      type: 'symbol',
      source: STATIONS_SOURCE,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-offset': [0, 1.3],
        'text-anchor': 'top',
        'text-max-width': 12,
      },
      paint: LABEL_PAINT,
    },
  ] as LayerSpecification[],
}

export const SHELTERS_GROUP: LayerGroup = {
  id: 'emergency_shelters',
  label: 'Shelters and evacuation points',
  color: SHELTER_COLORS.shelter,
  count: data.shelters.length,
  layers: [
    {
      id: 'emergency-shelters',
      type: 'circle',
      source: SHELTERS_SOURCE,
      paint: {
        'circle-color': ['match', ['get', 'kind'], 'kas', SHELTER_COLORS.kas, 'evacuation', SHELTER_COLORS.evacuation, SHELTER_COLORS.shelter],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 7],
        'circle-stroke-color': '#4c1d95',
        'circle-stroke-width': 1.5,
      },
    },
    {
      id: 'emergency-shelters-label',
      type: 'symbol',
      source: SHELTERS_SOURCE,
      minzoom: 15,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 10, 'text-offset': [0, 1], 'text-anchor': 'top', 'text-max-width': 12 },
      paint: LABEL_PAINT,
    },
  ] as LayerSpecification[],
}

const KIND_LABEL = { shelter: 'Shelter', kas: 'Collective protection facility', evacuation: 'Evacuation point' }
const yes = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : null)

export function describeStation(p: Record<string, unknown>): { title: string; rows: [string, string][] } {
  const s = stationById.get(String(p.id))!
  const rows: [string, string][] = [['Type', s.kind === 'fire' ? 'Fire and rescue station' : 'Ambulance station']]
  if (s.address) rows.push(['Address', s.address])
  return { title: s.name, rows }
}

// PAGD įrašo laukai – originalios reikšmės, tik su lietuviškais pavadinimais.
export function describeShelter(p: Record<string, unknown>): { title: string; rows: [string, string][] } {
  const s = shelterById.get(String(p.id))!
  const x = s.props
  const rows: [string, string][] = [['Type', KIND_LABEL[s.kind]]]
  const address = [x.gatve, x.namo_numeris].filter(Boolean).join(' ')
  if (address) rows.push(['Address', `${address}${x.gyvenviete ? `, ${x.gyvenviete}` : ''}`])
  if (x.evakavimo_punkto_tipas) rows.push(['Point type', String(x.evakavimo_punkto_tipas)])
  if (x.valdytojas) rows.push(['Managed by', String(x.valdytojas)])
  if (x.gyventoju_skaicius != null) rows.push(['Capacity', `${x.gyventoju_skaicius} people`])
  if (x.plotas != null) rows.push(['Area', `${x.plotas} m²`])
  const allDay = yes(x.patekimas_visa_para)
  if (allDay) rows.push(['Open 24/7', allDay])
  const disabled = yes(x.pritaikyta_asmenims_su_negalia)
  if (disabled) rows.push(['Accessible', disabled])
  if (x.atnaujinimo_data) rows.push(['Updated', String(x.atnaujinimo_data)])
  return { title: String(x.pavadinimas ?? KIND_LABEL[s.kind]), rows }
}

// Fastest fire service arrival to a FEZ building (road network estimate).
export function fireEta(buildingId: string): { station: string; minutes: number } | null {
  const first = data.buildings[buildingId]?.fire[0]
  return first ? { station: stationById.get(first.station)!.name, minutes: first.minutes } : null
}

// Pastato eilutės: kiek laiko važiuoja tarnybos, kur artimiausia priedanga.
export function describeBuildingEmergency(buildingId: string): [string, string][] {
  const e = data.buildings[buildingId]
  if (!e) return []
  const rows: [string, string][] = []
  const eta = (list: Eta[]) => list.map((x) => `${stationById.get(x.station)!.name} ~${x.minutes} min`).join('; ')
  if (e.fire.length) rows.push(['Fire service (drive)', eta(e.fire.slice(0, 2))])
  if (e.ambulance.length) rows.push(['Ambulance (drive)', eta(e.ambulance.slice(0, 1))])
  const near = (list: Nearby[]) => {
    const n = list[0]
    if (!n) return null
    const s = shelterById.get(n.id)!.props
    return `${s.pavadinimas}${s.gyventoju_skaicius != null ? `, ${s.gyventoju_skaicius} people` : ''} – ${n.distance_m} m`
  }
  const shelter = near(e.shelters)
  if (shelter) rows.push(['Nearest shelter', shelter])
  const evac = near(e.evacuation)
  if (evac) rows.push(['Evacuation point', evac])
  return rows
}
