// Parsiunčia AB „Klaipėdos vanduo“ vandentiekio tinklą LEZ zonai ir įrašo į src/data/lez_water.json.
// Žemėlapis vandens tinklus rodo realiu laiku; ši kopija reikalinga grafui (pastatas ↔ įvadas ↔ magistralė).
// Atributai ir koordinatės – tokie, kokius grąžina paslauga.
//
// Paleidimas: npm run fetch:water

import { writeFile } from 'node:fs/promises'
import { GRAPH_AREA } from './graph-area.mjs'

const SERVICES = 'https://maps.vanduo.lt/arcgis/rest/services'
const OUT = new URL('../src/data/lez_water.json', import.meta.url)
const PAGE = 2000

const LAYERS = [
  { key: 'pipe', service: 'V_sistema_ViesamNaudojimui', layerId: 5 },
  { key: 'valve', service: 'V_sistema_ViesamNaudojimui', layerId: 3 },
  { key: 'hydrant', service: 'Hidrantai_ViesamNaudojimui', layerId: 0 },
]

async function fetchLayer({ key, service, layerId }) {
  const features = []
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({
      where: '1=1',
      geometry: GRAPH_AREA.join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      outSR: '4326',
      orderByFields: 'OBJECTID',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: 'geojson',
    })
    const res = await fetch(`${SERVICES}/${service}/MapServer/${layerId}/query?${params}`)
    if (!res.ok) throw new Error(`${service}/${layerId}: HTTP ${res.status}`)
    const data = await res.json()
    for (const f of data.features) {
      features.push({ ...f, id: `${key}/${f.properties.OBJECTID}`, properties: { layer: key, ...f.properties } })
    }
    const more = data.exceededTransferLimit || data.properties?.exceededTransferLimit
    if (!more) break
  }
  console.log(`${key}: ${features.length}`)
  return features
}

const features = []
for (const layer of LAYERS) features.push(...(await fetchLayer(layer)))

await writeFile(
  OUT,
  JSON.stringify({
    type: 'FeatureCollection',
    metadata: {
      source: 'AB „Klaipėdos vanduo“, maps.vanduo.lt (ViesamNaudojimui paslaugos)',
      bbox: GRAPH_AREA,
      fetched_at: new Date().toISOString(),
    },
    features,
  }),
)
console.log(`Iš viso ${features.length} objektų.`)
