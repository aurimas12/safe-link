// Parsiunčia tikrą Klaipėdos inžinerinę infrastruktūrą iš OpenStreetMap (Overpass API)
// ir įrašo ją į src/data/infrastructure.json kaip GeoJSON.
//
// Paleidimas: npm run fetch:infra

import { centroid } from '@turf/turf'
import { writeFile } from 'node:fs/promises'

// Klaipėdos miestas su LEZ: pietus, vakarai, šiaurė, rytai.
const BBOX = '55.62,21.08,55.76,21.30'
const OUT = new URL('../src/data/infrastructure.json', import.meta.url)

const QUERY = `
[out:json][timeout:120];
(
  nwr["power"~"^(line|minor_line|cable|substation|transformer|plant)$"](${BBOX});
  nwr["man_made"~"^(pipeline|water_tower|water_works|pumping_station|wastewater_plant)$"](${BBOX});
);
out geom;
`

const toCoords = (geometry) => geometry.map((p) => [p.lon, p.lat])
const isClosed = (c) => c.length > 3 && c[0][0] === c.at(-1)[0] && c[0][1] === c.at(-1)[1]

// Sujungia multipoligono 'outer' narius į uždarus žiedus (OSM žiedai dažnai suskaidyti į kelis way).
function joinRings(segments) {
  const open = segments.map((s) => [...s])
  const rings = []
  while (open.length) {
    let ring = open.shift()
    let extended = true
    while (!isClosed(ring) && extended) {
      extended = false
      const end = ring.at(-1)
      for (let i = 0; i < open.length; i++) {
        const s = open[i]
        const same = (a, b) => a[0] === b[0] && a[1] === b[1]
        if (same(s[0], end)) ring = ring.concat(s.slice(1))
        else if (same(s.at(-1), end)) ring = ring.concat([...s].reverse().slice(1))
        else continue
        open.splice(i, 1)
        extended = true
        break
      }
    }
    if (isClosed(ring)) rings.push(ring)
  }
  return rings
}

function geometryOf(el) {
  if (el.type === 'node') return { type: 'Point', coordinates: [el.lon, el.lat] }
  if (el.type === 'way') {
    const c = toCoords(el.geometry)
    const linear = ['line', 'minor_line', 'cable'].includes(el.tags.power) || el.tags.man_made === 'pipeline'
    return !linear && isClosed(c) ? { type: 'Polygon', coordinates: [c] } : { type: 'LineString', coordinates: c }
  }
  const outers = el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => toCoords(m.geometry))
  const rings = joinRings(outers)
  return rings.length ? { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) } : null
}

const maxVoltage = (v) => (v ? Math.max(...v.split(';').map(Number).filter(Number.isFinite)) : null)

function classify(t) {
  const kv = maxVoltage(t.voltage)
  if (['line', 'minor_line', 'cable'].includes(t.power)) return 'power_line'
  if (t.power === 'substation') {
    const major = ['transmission', 'distribution', 'converter'].includes(t.substation) || (kv ?? 0) >= 35000
    return major ? 'substation' : 'transformer'
  }
  if (t.power === 'transformer') return 'transformer'
  if (t.power === 'plant') return 'power_plant'
  if (t.man_made === 'pipeline') return 'pipeline'
  return 'water_facility'
}

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'safe-link (FEZ Resilience OS)' },
  body: new URLSearchParams({ data: QUERY }),
})
if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`)
const { elements, osm3s } = await res.json()

const features = []
for (const el of elements) {
  const t = el.tags ?? {}
  const kind = classify(t)
  let geometry = geometryOf(el)
  if (!geometry) continue
  // Pastotės ir transformatorinės rodomos kaip taškai – aiškiau žemėlapyje ir lengviau paspausti.
  if ((kind === 'substation' || kind === 'transformer') && geometry.type !== 'Point') {
    geometry = centroid({ type: 'Feature', properties: {}, geometry }).geometry
  }
  features.push({
    type: 'Feature',
    id: `${el.type}/${el.id}`,
    properties: {
      kind,
      osm_id: `${el.type}/${el.id}`,
      name: t.name ?? null,
      operator: t.operator ?? null,
      voltage_kv: maxVoltage(t.voltage) ? maxVoltage(t.voltage) / 1000 : null,
      substance: t.substance ?? null,
      plant_source: t['plant:source'] ?? null,
      facility: t.man_made ?? null,
      location: t.location ?? null,
    },
    geometry,
  })
}

const collection = {
  type: 'FeatureCollection',
  metadata: {
    source: 'OpenStreetMap contributors (ODbL), Overpass API',
    bbox: BBOX,
    osm_timestamp: osm3s?.timestamp_osm_base ?? null,
    fetched_at: new Date().toISOString(),
  },
  features,
}
await writeFile(OUT, JSON.stringify(collection))

const counts = Object.groupBy(features, (f) => f.properties.kind)
console.log(Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.length])))
