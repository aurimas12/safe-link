// Parsiunčia oficialų AB „Energijos skirstymo operatorius“ elektros tinklą (atviri duomenys,
// data.gov.lt #3455) ir įrašo į src/data/eso_grid.json kaip GeoJSON.
//
// ESO paslauga neleidžia `query`, bet leidžia `identify` su plotu (envelope) ir geometrija.
// Vienas atsakymas grąžina ne daugiau 1000 objektų, todėl kiekvieną sluoksnį klausiam atskirai,
// o pasiekus ribą – plotą daliname į 4 dalis.
//
// Paleidimas: npm run fetch:eso

import { writeFile } from 'node:fs/promises'

const MAPSERVER = 'https://www.geoportal.lt/mapproxy/rest/services/ESO_DB_Public/MapServer'
const OUT = new URL('../src/data/eso_grid.json', import.meta.url)
// Mažas suvestinės failas meniu skaičiams – kad didelio GeoJSON nereikėtų dėti į JS paketą.
const META_OUT = new URL('../src/data/eso_grid.meta.json', import.meta.url)
const LIMIT = 1000

// Klaipėdos miestas su LEZ: [vakarai, pietūs, rytai, šiaurė]
const AREA = [21.08, 55.62, 21.3, 55.76]

// Esamas tinklas; projektuojamas (0–5) ir ryšių (15–16) sluoksniai neimami.
const LAYERS = [
  { id: 6, key: 'substation' },
  { id: 7, key: 'substation_important' },
  { id: 8, key: 'substation_hv' },
  { id: 9, key: 'cable_10' },
  { id: 10, key: 'cable_35' },
  { id: 11, key: 'cable_04' },
  { id: 12, key: 'overhead_35' },
  { id: 13, key: 'overhead_10' },
  { id: 14, key: 'overhead_04' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let requests = 0

async function identify(layerId, [w, s, e, n]) {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryEnvelope',
    sr: '4326',
    mapExtent: [w, s, e, n].join(','),
    // Didelis „ekranas“ = mažas mastelis, kad ESO grąžintų ir tik priartinus matomus sluoksnius.
    imageDisplay: '8000,8000,96',
    tolerance: '0',
    layers: `all:${layerId}`,
    returnGeometry: 'true',
    f: 'json',
  })
  for (let attempt = 1; ; attempt++) {
    requests++
    try {
      const res = await fetch(`${MAPSERVER}/identify?${params}`, { headers: { 'User-Agent': 'safe-link (FEZ Resilience OS)' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(JSON.stringify(data.error))
      return data.results ?? []
    } catch (err) {
      if (attempt >= 4) throw err
      await sleep(1000 * attempt)
    }
  }
}

async function fetchLayer(layerId, bbox, out) {
  const results = await identify(layerId, bbox)
  await sleep(150) // nekrauti ESO serverio
  if (results.length < LIMIT) {
    for (const r of results) out.set(r.attributes.OBJECTID, r)
    return
  }
  const [w, s, e, n] = bbox
  const mx = (w + e) / 2
  const my = (s + n) / 2
  for (const q of [
    [w, s, mx, my],
    [mx, s, e, my],
    [w, my, mx, n],
    [mx, my, e, n],
  ]) {
    await fetchLayer(layerId, q, out)
  }
}

function toGeometry(r) {
  const g = r.geometry
  // Koordinatės – tokios, kokias grąžina ESO, be apvalinimo.
  if (r.geometryType === 'esriGeometryPoint') return { type: 'Point', coordinates: [g.x, g.y] }
  if (r.geometryType === 'esriGeometryPolyline') {
    const paths = g.paths
    return paths.length === 1 ? { type: 'LineString', coordinates: paths[0] } : { type: 'MultiLineString', coordinates: paths }
  }
  return null
}

const features = []
const samples = {}
for (const layer of LAYERS) {
  const found = new Map()
  await fetchLayer(layer.id, AREA, found)
  for (const r of found.values()) {
    const geometry = toGeometry(r)
    if (!geometry) continue
    const a = r.attributes
    samples[layer.key] ??= a
    // Visi ESO atributai – originaliais pavadinimais ir reikšmėmis, nieko nekeičiant.
    // Pridedam tik mūsų sluoksnio raktą ir ESO sluoksnio pavadinimą.
    const properties = { layer: layer.key, layer_name: r.layerName, ...a }
    features.push({ type: 'Feature', id: `${layer.id}/${a.OBJECTID}`, properties, geometry })
  }
  console.log(`${layer.key}: ${found.size}`)
}

const metadata = {
  source: 'AB „Energijos skirstymo operatorius“, VšĮ SSVA (geoportal.lt), atviri duomenys data.gov.lt #3455',
  bbox: AREA,
  fetched_at: new Date().toISOString(),
  counts: Object.fromEntries(LAYERS.map((l) => [l.key, features.filter((f) => f.properties.layer === l.key).length])),
}
await writeFile(OUT, JSON.stringify({ type: 'FeatureCollection', metadata, features }))
await writeFile(META_OUT, JSON.stringify(metadata, null, 2) + '\n')
console.log(`Iš viso ${features.length} objektų, ${requests} užklausų.`)
console.log('Atributų pavyzdžiai:', JSON.stringify(samples, null, 1))
