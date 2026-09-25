import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl'
import infrastructure from '../data/infrastructure.json'

// Tikri OSM duomenys – atnaujinami su `npm run fetch:infra`.
export const INFRA_DATA = infrastructure as unknown as GeoJSON.FeatureCollection & {
  metadata: { source: string; osm_timestamp: string | null; fetched_at: string }
}
export const INFRA_SOURCE = 'infra'

export type InfraKind = 'power_line' | 'substation' | 'transformer' | 'power_plant' | 'pipeline' | 'water_facility'

export interface InfraGroup {
  id: string
  label: string
  color: string
  count: number
  layers: LayerSpecification[]
}

// Infrastruktūrai naudojami violetiniai / žydri / rožiniai atspalviai, kad nesimaišytų su rizikos būsenų spalvomis
// (žalia, raudona, oranžinė, geltona, mėlyna).
const COLORS = {
  line330: '#c026d3',
  line110: '#9333ea',
  lineOther: '#a78bfa',
  substation: '#7c3aed',
  transformer: '#a78bfa',
  plant: '#e879f9',
  heat: '#fb7185',
  gas: '#a3e635',
  pipeUnknown: '#94a3b8',
  water: '#22d3ee',
}

const kind = (k: InfraKind): ExpressionSpecification => ['==', ['get', 'kind'], k]
const isPolygon: ExpressionSpecification = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]]
const isPoint: ExpressionSpecification = ['==', ['geometry-type'], 'Point']
const LABEL_FONT = ['Noto Sans Regular']

const count = (k: InfraKind) => INFRA_DATA.features.filter((f) => f.properties?.kind === k).length

export const INFRA_GROUPS: (InfraGroup & { id: InfraKind })[] = [
  {
    id: 'power_line',
    label: 'Elektros linijos',
    color: COLORS.line110,
    count: count('power_line'),
    layers: [
      {
        id: 'infra-power-line',
        type: 'line',
        source: INFRA_SOURCE,
        filter: kind('power_line'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'step',
            ['coalesce', ['get', 'voltage_kv'], 0],
            COLORS.lineOther,
            110,
            COLORS.line110,
            300,
            COLORS.line330,
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, ['step', ['coalesce', ['get', 'voltage_kv'], 0], 2, 110, 3, 300, 4.5]],
        },
      },
    ],
  },
  {
    id: 'substation',
    label: 'Pagrindinės pastotės (35–330 kV)',
    color: COLORS.substation,
    count: count('substation'),
    layers: [
      {
        id: 'infra-substation',
        type: 'circle',
        source: INFRA_SOURCE,
        filter: kind('substation'),
        paint: {
          'circle-color': COLORS.substation,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 10],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      },
      {
        id: 'infra-substation-label',
        type: 'symbol',
        source: INFRA_SOURCE,
        filter: kind('substation'),
        layout: {
          'text-field': ['concat', ['coalesce', ['get', 'name'], 'Pastotė'], '\n', ['to-string', ['get', 'voltage_kv']], ' kV'],
          'text-font': LABEL_FONT,
          'text-size': 11,
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#3b0764', 'text-halo-width': 1.5 },
      },
    ],
  },
  {
    id: 'transformer',
    label: 'Transformatorinės',
    color: COLORS.transformer,
    count: count('transformer'),
    layers: [
      {
        id: 'infra-transformer',
        type: 'circle',
        source: INFRA_SOURCE,
        filter: kind('transformer'),
        minzoom: 12,
        paint: {
          'circle-color': COLORS.transformer,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2, 17, 6],
          'circle-stroke-color': '#1e1b4b',
          'circle-stroke-width': 1,
        },
      },
    ],
  },
  {
    id: 'power_plant',
    label: 'Elektrinės ir katilinės',
    color: COLORS.plant,
    count: count('power_plant'),
    layers: [
      {
        id: 'infra-power-plant-fill',
        type: 'fill',
        source: INFRA_SOURCE,
        filter: ['all', kind('power_plant'), isPolygon],
        paint: { 'fill-color': COLORS.plant, 'fill-opacity': 0.25 },
      },
      {
        id: 'infra-power-plant-line',
        type: 'line',
        source: INFRA_SOURCE,
        filter: ['all', kind('power_plant'), isPolygon],
        paint: { 'line-color': COLORS.plant, 'line-width': 1.5 },
      },
    ],
  },
  {
    id: 'pipeline',
    label: 'Vamzdynai (šiluma, dujos)',
    color: COLORS.heat,
    count: count('pipeline'),
    layers: [
      {
        id: 'infra-pipeline',
        type: 'line',
        source: INFRA_SOURCE,
        filter: kind('pipeline'),
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': ['match', ['get', 'substance'], 'hot_water', COLORS.heat, 'gas', COLORS.gas, COLORS.pipeUnknown],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 16, 4],
          'line-dasharray': [2, 1],
        },
      },
    ],
  },
  {
    id: 'water_facility',
    label: 'Vandentvarka (bokštai, valyklos)',
    color: COLORS.water,
    count: count('water_facility'),
    layers: [
      {
        id: 'infra-water-fill',
        type: 'fill',
        source: INFRA_SOURCE,
        filter: ['all', kind('water_facility'), isPolygon],
        paint: { 'fill-color': COLORS.water, 'fill-opacity': 0.25 },
      },
      {
        id: 'infra-water-line',
        type: 'line',
        source: INFRA_SOURCE,
        filter: ['all', kind('water_facility'), isPolygon],
        paint: { 'line-color': COLORS.water, 'line-width': 1.5 },
      },
      {
        id: 'infra-water-point',
        type: 'circle',
        source: INFRA_SOURCE,
        filter: ['all', kind('water_facility'), isPoint],
        paint: {
          'circle-color': COLORS.water,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 8],
          'circle-stroke-color': '#083344',
          'circle-stroke-width': 1.5,
        },
      },
    ],
  },
]

export const DEFAULT_VISIBLE_INFRA: InfraKind[] = ['power_line', 'substation']

const KIND_LABELS: Record<InfraKind, string> = {
  power_line: 'Elektros linija',
  substation: 'Pastotė',
  transformer: 'Transformatorinė',
  power_plant: 'Elektrinė / katilinė',
  pipeline: 'Vamzdynas',
  water_facility: 'Vandentvarkos objektas',
}

const VALUE_LABELS: Record<string, string> = {
  hot_water: 'karštas vanduo (šiluma)',
  gas: 'dujos',
  solar: 'saulės',
  'biofuel;gas': 'biokuras, dujos',
  water_tower: 'vandens bokštas',
  wastewater_plant: 'nuotekų valykla',
  water_works: 'vandenvietė',
  pumping_station: 'siurblinė',
  underground: 'požeminis',
  overground: 'antžeminis',
  overhead: 'virš žemės',
}

// Popup'o eilutės iš OSM žymų; nežinomos reikšmės rodomos kaip „nenurodyta OSM“.
export function describeFeature(p: Record<string, unknown>): { title: string; rows: [string, string][]; osmUrl: string } {
  const k = p.kind as InfraKind
  const v = (x: unknown) => (x == null ? null : (VALUE_LABELS[String(x)] ?? String(x)))
  const rows: [string, string][] = [['Tipas', KIND_LABELS[k]]]
  if (k === 'power_line' || k === 'substation') rows.push(['Įtampa', p.voltage_kv != null ? `${p.voltage_kv} kV` : 'nenurodyta OSM'])
  if (k === 'pipeline') rows.push(['Medžiaga', v(p.substance) ?? 'nenurodyta OSM'])
  if (k === 'pipeline' && p.location) rows.push(['Vieta', v(p.location)!])
  if (k === 'power_plant' && p.plant_source) rows.push(['Šaltinis', v(p.plant_source)!])
  if (k === 'water_facility') rows.push(['Objektas', v(p.facility)!])
  if (p.operator) rows.push(['Operatorius', String(p.operator)])
  const [type, id] = String(p.osm_id).split('/')
  return {
    title: (p.name as string | null) ?? KIND_LABELS[k],
    rows,
    osmUrl: `https://www.openstreetmap.org/${type}/${id}`,
  }
}
