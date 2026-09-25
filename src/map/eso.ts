import type { ExpressionSpecification, LayerSpecification, SymbolLayerSpecification } from 'maplibre-gl'
import esoGridUrl from '../data/eso_grid.json?url'
import esoMeta from '../data/eso_grid.meta.json'

// Oficialus AB „Energijos skirstymo operatorius“ elektros tinklas visai Klaipėdai (atviri duomenys, data.gov.lt #3455).
// Parsiunčiamas su `npm run fetch:eso`; ~14 MB failas kraunamas atskirai, ne per JS paketą.
export const ESO_SOURCE = 'eso'
export const ESO_DATA_URL = esoGridUrl
export const ESO_META = esoMeta

// Meniu punktas: vienas jungiklis gali valdyti kelis žemėlapio sluoksnius (pvz. taškai + etiketės).
export interface LayerGroup {
  id: string
  label: string
  color: string
  count: number
  layers: LayerSpecification[]
}

// ESO tinklas – rožinių atspalvių šeima, kad nesimaišytų su rizikos būsenų spalvomis.
const COLORS = {
  hv: '#be185d',
  substation: '#ec4899',
  kv10: '#f472b6',
  kv04: '#f9a8d4',
}

const layerIn = (...keys: string[]): ExpressionSpecification => ['in', ['get', 'layer'], ['literal', keys]]
const count = (...keys: (keyof typeof esoMeta.counts)[]) => keys.reduce((n, k) => n + esoMeta.counts[k], 0)

// Ryškios etiketės be fono: balta paryškinta raidė su tamsiu kontūru – skaitosi ant bet kokio pagrindo.
const LABEL_LAYOUT: SymbolLayerSpecification['layout'] = {
  'text-field': ['get', 'PAVADINIMAS'],
  'text-font': ['Noto Sans Bold'],
  'text-offset': [0, 0.9],
  'text-anchor': 'top',
  'text-optional': true,
}
const LABEL_PAINT: SymbolLayerSpecification['paint'] = { 'text-color': '#ffffff', 'text-halo-color': '#0f172a', 'text-halo-width': 1.6 }

export const ESO_GROUPS: LayerGroup[] = [
  {
    id: 'eso_hv',
    label: 'Pastotės 110/35 kV',
    color: COLORS.hv,
    count: count('substation_hv', 'substation_important'),
    layers: [
      {
        id: 'eso-hv',
        type: 'circle',
        source: ESO_SOURCE,
        filter: layerIn('substation_hv', 'substation_important'),
        paint: {
          'circle-color': COLORS.hv,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 10],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      },
      {
        id: 'eso-hv-label',
        type: 'symbol',
        source: ESO_SOURCE,
        filter: layerIn('substation_hv', 'substation_important'),
        layout: {
          ...LABEL_LAYOUT,
          'text-field': ['concat', ['get', 'PAVADINIMAS'], ' ', ['get', 'ITAMPA'], ' kV'],
          'text-size': 12,
          'text-offset': [0, 1.2],
        },
        paint: LABEL_PAINT,
      },
    ],
  },
  {
    id: 'eso_substation',
    label: 'Transformatorinės ir skirstomieji punktai',
    color: COLORS.substation,
    count: count('substation'),
    layers: [
      {
        id: 'eso-substation',
        type: 'circle',
        source: ESO_SOURCE,
        filter: layerIn('substation'),
        paint: {
          'circle-color': COLORS.substation,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 3.5, 17, 7],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 15, 1.5],
        },
      },
      {
        id: 'eso-substation-label',
        type: 'symbol',
        source: ESO_SOURCE,
        filter: layerIn('substation'),
        // Iš toli 264 pavadinimai užklotų visą žemėlapį – rodom priartinus.
        minzoom: 15,
        layout: { ...LABEL_LAYOUT, 'text-size': 11 },
        paint: LABEL_PAINT,
      },
    ],
  },
  {
    id: 'eso_10',
    label: '10 kV kabeliai ir oro linijos',
    color: COLORS.kv10,
    count: count('cable_10', 'overhead_10', 'cable_35', 'overhead_35'),
    layers: [
      {
        id: 'eso-10',
        type: 'line',
        source: ESO_SOURCE,
        filter: layerIn('cable_10', 'cable_35'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COLORS.kv10,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 14, 1.2, 17, 2.5],
          'line-opacity': 0.9,
        },
      },
      {
        id: 'eso-10-overhead',
        type: 'line',
        source: ESO_SOURCE,
        filter: layerIn('overhead_10', 'overhead_35'),
        paint: {
          'line-color': COLORS.kv10,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 17, 2.5],
          'line-dasharray': [3, 2],
        },
      },
    ],
  },
  {
    id: 'eso_04',
    label: '0,4 kV kabeliai ir oro linijos',
    color: COLORS.kv04,
    count: count('cable_04', 'overhead_04'),
    layers: [
      {
        id: 'eso-04',
        type: 'line',
        source: ESO_SOURCE,
        filter: layerIn('cable_04'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COLORS.kv04,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 14, 0.8, 17, 1.6],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 15, 0.9],
        },
      },
      {
        id: 'eso-04-overhead',
        type: 'line',
        source: ESO_SOURCE,
        filter: layerIn('overhead_04'),
        paint: {
          'line-color': COLORS.kv04,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 17, 1.6],
          'line-dasharray': [3, 2],
        },
      },
    ],
  },
]

export const DEFAULT_VISIBLE_ESO = ESO_GROUPS.map((g) => g.id)

// Popup'e rodomi visi ESO atributai originaliomis reikšmėmis; techninius laukus praleidžiam.
const HIDDEN_ATTRS = new Set(['layer', 'layer_name', 'Shape'])
const ATTR_LABELS: Record<string, string> = {
  OBJECTID: 'ESO ID',
  PAVADINIMAS: 'Pavadinimas',
  RUSIS: 'Rūšis',
  ITAMPA: 'Įtampa, kV',
  Padalinys: 'Padalinys',
  Subtype: 'Potipis',
  Shape_Length: 'Ilgis, m',
  'FAZIU SKAICIUS': 'Fazių skaičius',
}

export function describeEsoFeature(p: Record<string, unknown>): { title: string; rows: [string, string][] } {
  const rows: [string, string][] = [['Sluoksnis', String(p.layer_name)]]
  for (const [k, v] of Object.entries(p)) {
    if (HIDDEN_ATTRS.has(k) || v == null || v === '') continue
    rows.push([ATTR_LABELS[k] ?? k, String(v)])
  }
  return { title: (p.PAVADINIMAS as string | undefined) ?? String(p.layer_name), rows }
}
