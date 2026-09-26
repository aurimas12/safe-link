// Aplinkiniai pastatai (GRPK) grafo zonoje, išskyrus LEZ pastatus → src/data/area_buildings.json.
// Jie reikalingi įtakai: tie patys tinklai maitina ir LEZ, ir aplinkinius namus.
// Atributai – originalūs GRPK; pridedamas tik `_centroid`.
//
// Paleidimas: npm run fetch:area-buildings  (po fetch:buildings)

import { centroid } from '@turf/turf'
import { readFile, writeFile } from 'node:fs/promises'
import { GRAPH_AREA } from './graph-area.mjs'

const GRPK_BUILDINGS = 'https://www.geoportal.lt/mapproxy/rest/services/gisc_grpk/MapServer/22'
const OUT = new URL('../src/data/area_buildings.json', import.meta.url)
const UA = { 'User-Agent': 'safe-link (FEZ Resilience OS)' }

const lez = JSON.parse(await readFile(new URL('../src/data/lez_buildings.json', import.meta.url)))
const lezIds = new Set(lez.features.map((f) => f.properties.OBJECTID))

const features = []
for (let offset = 0; ; offset += 1000) {
  const params = new URLSearchParams({
    geometry: GRAPH_AREA.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: '*',
    outSR: '4326',
    orderByFields: 'OBJECTID',
    resultOffset: String(offset),
    resultRecordCount: '1000',
    f: 'json',
  })
  const res = await fetch(`${GRPK_BUILDINGS}/query?${params}`, { headers: UA })
  const data = await res.json()
  if (data.error) throw new Error(`GRPK: ${JSON.stringify(data.error)}`)
  for (const f of data.features) {
    if (lezIds.has(f.attributes.OBJECTID)) continue
    const feature = {
      type: 'Feature',
      id: `grpk/${f.attributes.OBJECTID}`,
      properties: { ...f.attributes },
      geometry: { type: 'Polygon', coordinates: f.geometry.rings },
    }
    feature.properties._centroid = centroid(feature).geometry.coordinates
    features.push(feature)
  }
  if (!data.exceededTransferLimit) break
}

await writeFile(
  OUT,
  JSON.stringify({
    type: 'FeatureCollection',
    metadata: {
      source: 'GRPK – Georeferencinio pagrindo kadastras (NŽT, geoportal.lt), sluoksnis „Pastatai“',
      bbox: GRAPH_AREA,
      fetched_at: new Date().toISOString(),
      excludes: 'LEZ pastatai (jie – lez_buildings.json)',
    },
    features,
  }),
)
console.log(`Aplinkinių pastatų: ${features.length}`)
