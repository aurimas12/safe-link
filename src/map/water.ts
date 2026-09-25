import type {
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  LayerSpecification,
  RasterSourceSpecification,
} from 'maplibre-gl'
import type { LayerGroup } from './layers'

// AB „Klaipėdos vanduo“ viešos (ViesamNaudojimui) ArcGIS paslaugos: vandentiekis, nuotekos, hidrantai.
// Visa Klaipėda – ~270 000 objektų (~100 MB), todėl duomenys nesaugomi projekte:
//  - iš toli (< WATER_VECTOR_MIN_ZOOM) serveris piešia vaizdą mūsų spalvomis (export + dynamicLayers);
//  - priartinus kraunami tikri objektai tik matomai žemėlapio daliai (query → GeoJSON), originaliais atributais.
const SERVICES = 'https://maps.vanduo.lt/arcgis/rest/services'

const ATTRIBUTION = '© AB „Klaipėdos vanduo“'

export const WATER_VECTOR_MIN_ZOOM = 16
// Kaip ir ESO: 2x didesnis paveikslėlis 512 px tile'ui – ryškus retina ekranuose.
const IMAGE_SIZE = 1024

interface ServiceLayer {
  service: string
  layerId: number
}

interface WaterGroupDef {
  id: string
  label: string
  color: string
  kind: 'line' | 'point'
  // Pagalbinės linijos (slėginiai vamzdynai) rodomos punktyru.
  dashedLayerIds?: number[]
  sources: ServiceLayer[]
}

const V = 'V_sistema_ViesamNaudojimui'
const FK = 'FK_sistema_ViesamNaudojimui'
const LK = 'LK_sistema_ViesamNaudojimui'
const H = 'Hidrantai_ViesamNaudojimui'

// Vandens tinklams – žydri/rudi/žalsvai mėlyni atspalviai, kad nesimaišytų su ESO (rožiniai) ir rizikos spalvomis.
const DEFS: WaterGroupDef[] = [
  { id: 'water_supply', label: 'Vandentiekis', color: '#38bdf8', kind: 'line', sources: [{ service: V, layerId: 5 }] },
  {
    id: 'water_sewer',
    label: 'Buitinės nuotekos',
    color: '#d6a77a',
    kind: 'line',
    dashedLayerIds: [6],
    sources: [
      { service: FK, layerId: 5 },
      { service: FK, layerId: 6 },
    ],
  },
  {
    id: 'water_storm',
    label: 'Lietaus nuotekos',
    color: '#2dd4bf',
    kind: 'line',
    dashedLayerIds: [5],
    sources: [
      { service: LK, layerId: 4 },
      { service: LK, layerId: 5 },
    ],
  },
  { id: 'water_hydrants', label: 'Hidrantai', color: '#f0f9ff', kind: 'point', sources: [{ service: H, layerId: 0 }] },
  { id: 'water_valves', label: 'Sklendės', color: '#7dd3fc', kind: 'point', sources: [{ service: V, layerId: 3 }] },
]

const rgba = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255)

// Serveris piešia mūsų spalva ir be savo mastelio ribų (minScale 0), kad tinklas matytųsi iš toli.
function dynamicLayers(def: WaterGroupDef, service: string) {
  return def.sources
    .filter((s) => s.service === service)
    .map((s) => ({
      id: s.layerId,
      source: { type: 'mapLayer', mapLayerId: s.layerId },
      minScale: 0,
      maxScale: 0,
      drawingInfo: {
        renderer: {
          type: 'simple',
          symbol:
            def.kind === 'line'
              ? {
                  type: 'esriSLS',
                  style: def.dashedLayerIds?.includes(s.layerId) ? 'esriSLSDash' : 'esriSLSSolid',
                  color: rgba(def.color),
                  width: 1.5,
                }
              : { type: 'esriSMS', style: 'esriSMSCircle', color: rgba(def.color), size: 4, outline: null },
        },
      },
    }))
}

function rasterSource(def: WaterGroupDef, service: string): RasterSourceSpecification {
  const params = new URLSearchParams({
    bboxSR: '3857',
    imageSR: '3857',
    size: `${IMAGE_SIZE},${IMAGE_SIZE}`,
    format: 'png32',
    transparent: 'true',
    dynamicLayers: JSON.stringify(dynamicLayers(def, service)),
    f: 'image',
  })
  return {
    type: 'raster',
    // {bbox-epsg-3857} MapLibre įrašo pats; URLSearchParams jo neužkoduoja, nes pridedam atskirai.
    tiles: [`${SERVICES}/${service}/MapServer/export?bbox={bbox-epsg-3857}&${params}`],
    tileSize: 512,
    maxzoom: WATER_VECTOR_MIN_ZOOM,
    attribution: ATTRIBUTION,
  }
}

const rasterSourceId = (def: WaterGroupDef, service: string) => `${def.id}-raster-${service}`
export const vectorSourceId = (groupId: string) => `${groupId}-vector`

// Visi šaltiniai, kuriuos reikia pridėti po kiekvieno stiliaus užkrovimo.
export const WATER_SOURCES: [string, RasterSourceSpecification | GeoJSONSourceSpecification][] =
  DEFS.flatMap((def) => [
    ...[...new Set(def.sources.map((s) => s.service))].map(
      (service) => [rasterSourceId(def, service), rasterSource(def, service)] as [string, RasterSourceSpecification],
    ),
    [
      vectorSourceId(def.id),
      { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: ATTRIBUTION },
    ] as [string, GeoJSONSourceSpecification],
  ])

function vectorLayers(def: WaterGroupDef): LayerSpecification[] {
  const source = vectorSourceId(def.id)
  if (def.kind === 'point') {
    return [
      {
        id: `${def.id}-vector`,
        type: 'circle',
        source,
        minzoom: WATER_VECTOR_MIN_ZOOM,
        paint: {
          'circle-color': def.color,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 3.5, 19, 7],
          'circle-stroke-color': '#0c4a6e',
          'circle-stroke-width': 1.5,
        },
      },
    ]
  }
  const dashed = def.dashedLayerIds ?? []
  const isDashed: ExpressionSpecification = ['in', ['get', '_layerId'], ['literal', dashed]]
  const width: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 16, 1.5, 19, 4]
  return [
    {
      id: `${def.id}-vector`,
      type: 'line',
      source,
      minzoom: WATER_VECTOR_MIN_ZOOM,
      filter: ['!', isDashed],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': def.color, 'line-width': width },
    },
    {
      id: `${def.id}-vector-dashed`,
      type: 'line',
      source,
      minzoom: WATER_VECTOR_MIN_ZOOM,
      filter: isDashed,
      paint: { 'line-color': def.color, 'line-width': width, 'line-dasharray': [2, 1.5] },
    },
  ]
}

export const WATER_GROUPS: LayerGroup[] = DEFS.map((def) => ({
  id: def.id,
  label: def.label,
  color: def.color,
  count: null,
  layers: [
    ...[...new Set(def.sources.map((s) => s.service))].map(
      (service): LayerSpecification => ({
        id: rasterSourceId(def, service),
        type: 'raster',
        source: rasterSourceId(def, service),
        maxzoom: WATER_VECTOR_MIN_ZOOM,
      }),
    ),
    ...vectorLayers(def),
  ],
}))

export const WATER_VECTOR_SOURCES = new Set(DEFS.map((d) => vectorSourceId(d.id)))
export const WATER_GROUP_IDS = DEFS.map((d) => d.id)
// Tankūs sluoksniai (nuotekos, sklendės) įsijungia vartotojas pats.
export const DEFAULT_VISIBLE_WATER = ['water_supply', 'water_hydrants']

// Serveris grąžina ne daugiau 2000 objektų per užklausą – puslapiuojam. Riba apsaugo nuo per didelių užklausų.
const PAGE_SIZE = 2000
const MAX_PAGES = 10

async function queryLayer(
  s: ServiceLayer,
  bbox: [number, number, number, number],
  signal: AbortSignal,
): Promise<GeoJSON.Feature[]> {
  const features: GeoJSON.Feature[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      where: '1=1',
      geometry: bbox.join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      outSR: '4326',
      resultOffset: String(page * PAGE_SIZE),
      resultRecordCount: String(PAGE_SIZE),
      f: 'geojson',
    })
    const res = await fetch(`${SERVICES}/${s.service}/MapServer/${s.layerId}/query?${params}`, { signal })
    if (!res.ok) throw new Error(`Klaipėdos vanduo ${s.service}/${s.layerId}: HTTP ${res.status}`)
    const data = (await res.json()) as GeoJSON.FeatureCollection & { exceededTransferLimit?: boolean }
    // Atributai – originalūs; pridedam tik iš kurio sluoksnio objektas (reikia stiliui ir popup'ui).
    for (const f of data.features) features.push({ ...f, properties: { ...f.properties, _service: s.service, _layerId: s.layerId } })
    if (!data.exceededTransferLimit && !(data as { properties?: { exceededTransferLimit?: boolean } }).properties?.exceededTransferLimit) break
  }
  return features
}

export async function loadWaterGroup(
  groupId: string,
  bbox: [number, number, number, number],
  signal: AbortSignal,
): Promise<GeoJSON.FeatureCollection> {
  const def = DEFS.find((d) => d.id === groupId)!
  const parts = await Promise.all(def.sources.map((s) => queryLayer(s, bbox, signal)))
  return { type: 'FeatureCollection', features: parts.flat() }
}

const SUBLAYER_LABELS: Record<string, string> = {
  [`${V}/5`]: 'Vandentiekio vamzdynas',
  [`${V}/3`]: 'Sklendė',
  [`${H}/0`]: 'Hidrantas',
  [`${FK}/5`]: 'Buitinių nuotekų vamzdynas',
  [`${FK}/6`]: 'Slėginis buitinių nuotekų vamzdynas',
  [`${LK}/4`]: 'Lietaus nuotekų vamzdynas',
  [`${LK}/5`]: 'Slėginis lietaus nuotekų vamzdynas',
}

// Lauko vardas → „Klaipėdos vanduo“ paslaugoje nurodytas pavadinimas (alias).
const FIELD_LABELS: Record<string, string> = {
  OBJECTID: 'ID',
  Diameter: 'Diametras, mm',
  MaterialType: 'Medžiaga',
  Owner: 'Savininkas',
  AssemblerId: 'Eksploatuoja',
  Class: 'Klasė',
  Kategorijos: 'Kategorija',
  Label: 'Numeris',
  ID_Kameros: 'Nr. kameros',
  'geom.STLength()': 'Ilgis, m',
}

export function describeWaterFeature(p: Record<string, unknown>): { title: string; rows: [string, string][] } {
  const title = SUBLAYER_LABELS[`${p._service}/${p._layerId}`] ?? 'Klaipėdos vanduo'
  const rows: [string, string][] = []
  for (const [k, v] of Object.entries(p)) {
    if (k.startsWith('_') || v == null || v === '') continue
    rows.push([FIELD_LABELS[k] ?? k, String(v)])
  }
  return { title, rows }
}
