// Tiekimo zonų segmentai žemėlapiui → src/data/supply_zones.json
//
// Zona – pastatai, kuriuos (pagal įtakos grafą) maitina ta pati 110/35 kV pastotė.
// Segmentas – tos pačios zonos pastatų Voronojaus ląstelės (plotas, kuriam artimiausias būtent tas pastatas),
// sujungtos ir apkirptos kauke: CELL_RADIUS_M aplink pastatus, suglodinta (išplėsta ir vėl sutraukta SMOOTH_M).
// Todėl zonos nepersidengia, liečiasi tik ten, kur pastatai tikrai greta, o tuščios vietos lieka tuščios.
// Pastatų koordinatės ir priskyrimas pastotei – originalūs iš lez_graph.json; skaičiuojama tik geometrija.
//
// Paleidimas: npm run build:zones  (po build:graph)

import { readFile, writeFile } from 'node:fs/promises'
import { bbox, buffer, envelope, featureCollection, intersect, multiPoint, point, simplify, union, voronoi } from '@turf/turf'

const CELL_RADIUS_M = 100
const SMOOTH_M = 80
const GRAPH = new URL('../src/data/lez_graph.json', import.meta.url)
const OUT = new URL('../src/data/supply_zones.json', import.meta.url)

const graph = JSON.parse(await readFile(GRAPH, 'utf8'))
const node = new Map(graph.nodes.map((n) => [n.id, n]))

const pts = []
for (const [building, deps] of Object.entries(graph.buildings)) {
  const root = deps.power?.chain.at(-1)
  if (!root || node.get(root)?.type !== 'substation_hv') continue
  pts.push(point(node.get(building).coords, { zone: root }))
}
const all = featureCollection(pts)
const cells = voronoi(all, { bbox: bbox(buffer(envelope(all), 0.5, { units: 'kilometers' })) })

// Kaukė: kur yra pastatų. Išplėtimas + sutraukimas užpildo tarpus tarp gretimų pastatų ir suapvalina kraštus.
const km = (m) => m / 1000
const near = buffer(multiPoint(pts.map((p) => p.geometry.coordinates)), km(CELL_RADIUS_M + SMOOTH_M), { units: 'kilometers', steps: 8 })
const mask = buffer(near, -km(SMOOTH_M), { units: 'kilometers', steps: 8 })

const byZone = new Map()
cells.features.forEach((cell, i) => {
  if (!cell) return
  const zone = pts[i].properties.zone
  if (!byZone.has(zone)) byZone.set(zone, [])
  byZone.get(zone).push(cell)
})

const features = []
for (const [zone, parts] of byZone) {
  // Gretimos ląstelės turi bendras kraštines, todėl sujungus neatsiranda siūlių.
  const merged = union(featureCollection(parts)) ?? parts[0]
  const clipped = intersect(featureCollection([merged, mask]))
  if (!clipped) continue
  features.push({ ...simplify(clipped, { tolerance: 0.00003, highQuality: true }), properties: { zone, buildings: parts.length } })
}
await writeFile(
  OUT,
  JSON.stringify({
    type: 'FeatureCollection',
    metadata: { source: 'lez_graph.json (ESO network dependency graph)', cell_radius_m: CELL_RADIUS_M, built_at: new Date().toISOString() },
    features,
  }),
)
for (const f of features) console.log(`${node.get(f.properties.zone).name}: ${f.properties.buildings} pastatų`)
