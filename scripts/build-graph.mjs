// Sudaro įtakos grafą iš tikrų duomenų ir įrašo į src/data/lez_graph.json.
//
//  Elektra (ESO):  110/35 kV pastotė → (10 kV kabeliai) → skirstomasis punktas / transformatorinė → (0,4 kV) → pastatas
//  Vanduo („Klaipėdos vanduo“): magistralė → (vamzdžiai, kritinės sklendės) → įvadas → pastatas
//
// Pastatai: LEZ (lez_buildings.json) ir aplinkiniai (area_buildings.json) – tie patys tinklai maitina abu.
// Kiekvienam tinklo mazgui apskaičiuojama įtaka: kurie pastatai nuo jo priklauso (`affects`).
//
// Ryšiai nustatomi iš geometrijos: kabelių / vamzdžių galai, sutampantys ≤ SNAP_M, laikomi sujungtais.
// Briaunos patikimumas:
//   'kabelis'   – kabelio / vamzdžio galas pasiekia pastatą ar įrenginį (geometriškai liečiasi);
//   'greta'     – transformatorinė pastate ar prie jo (≤ 5 m), bet kabelio iki pastato duomenyse nėra;
//   'numanomas' – artimiausia transformatorinė / vamzdis (atstumas nurodomas), tiesioginio ryšio duomenyse nėra.
// Tikroji jungiklių ir sklendžių būsena nežinoma – kelias skaičiuojamas trumpiausias pagal kabelių / vamzdžių ilgį.
//
// Briaunų trasos – tikri kabeliai / vamzdžiai: `segments` – unikalios atkarpos (originalios koordinatės),
// briaunos `path` – atkarpų numeriai (+1; neigiamas – atkarpa apversta). Tiesios jungtys (numanomi ryšiai,
// įrenginio taškas ↔ kabelio galas) – taip pat atkarpos, bet pažymėtos `straight`.
//
// Paleidimas: npm run build:graph  (prieš tai: fetch:eso, fetch:buildings, fetch:area-buildings, fetch:water)

import { readFile, writeFile } from 'node:fs/promises'
import { booleanPointInPolygon, pointToPolygonDistance, point } from '@turf/turf'
import { GRAPH_AREA } from './graph-area.mjs'

const read = async (name) => JSON.parse(await readFile(new URL(`../src/data/${name}`, import.meta.url)))
const OUT = new URL('../src/data/lez_graph.json', import.meta.url)

const SNAP_M = 1.5 // kabelių / vamzdžių galų sujungimo tolerancija
const DEVICE_M = 10 // transformatorinė ↔ kabelio galas
const SP_M = 20 // skirstomasis punktas – didesnis pastatas, kabeliai baigiasi 11–17 m nuo jo taško
const HV_M = 30 // 110/35 kV pastotė ↔ kabelio galas (pastotės teritorija didelė)
const BUILDING_M = 5 // kabelio / vamzdžio galas ↔ pastato kontūras
const INFERRED_POWER_M = 150 // numanoma artimiausia transformatorinė
const INFERRED_WATER_M = 50 // numanomas artimiausias vamzdis
const HYDRANT_M = 150 // hidrantai aplink pastatą (tiesiu atstumu)

// --- geometrija metrais (lokali projekcija – Klaipėdos platumoje paklaida < 0,1 %) ---
const LAT0 = 55.69
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180)
const MY = 110574
const dist = (a, b) => Math.hypot((a[0] - b[0]) * MX, (a[1] - b[1]) * MY)
const lineLength = (coords) => coords.slice(1).reduce((s, c, i) => s + dist(coords[i], c), 0)
const parts = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [])
const pointsOf = (g) => (g.type === 'Point' ? [g.coordinates] : g.type === 'MultiPoint' ? g.coordinates : [])
const inArea = (c) => c[0] >= GRAPH_AREA[0] && c[0] <= GRAPH_AREA[2] && c[1] >= GRAPH_AREA[1] && c[1] <= GRAPH_AREA[3]

// Tinklelis greitai paieškai „kas yra arti taško“.
class Grid {
  constructor(cellM) {
    this.cell = cellM
    this.map = new Map()
  }
  key(c) {
    return [Math.floor((c[0] * MX) / this.cell), Math.floor((c[1] * MY) / this.cell)]
  }
  add(c, item) {
    const [x, y] = this.key(c)
    const k = `${x}:${y}`
    if (!this.map.has(k)) this.map.set(k, [])
    this.map.get(k).push({ c, item })
  }
  near(c, radius) {
    const [x, y] = this.key(c)
    const r = Math.ceil(radius / this.cell)
    const out = []
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (const e of this.map.get(`${x + dx}:${y + dy}`) ?? []) {
          const d = dist(c, e.c)
          if (d <= radius) out.push({ ...e, d })
        }
    return out.sort((a, b) => a.d - b.d)
  }
}

// Unikalios trasų atkarpos: tikrų kabelių / vamzdžių dalys (originalios koordinatės) ir tiesios jungtys.
const segments = []
const segmentIndex = new Map()
function segment(coords, key, straight = false) {
  if (!segmentIndex.has(key)) {
    segmentIndex.set(key, segments.length)
    segments.push(straight ? { coords, straight: true } : { coords })
  }
  return segmentIndex.get(key)
}

// Tinklas: mazgai – sujungti linijų galai; briaunos – linijos (kabeliai / vamzdžiai).
class Network {
  constructor(name) {
    this.name = name
    this.grid = new Grid(SNAP_M * 2)
    this.coords = []
    this.adj = []
  }
  node(c) {
    const hit = this.grid.near(c, SNAP_M)[0]
    if (hit) return hit.item
    const id = this.coords.length
    this.coords.push(c)
    this.adj.push([])
    this.grid.add(c, id)
    return id
  }
  virtual(c) {
    const id = this.coords.length
    this.coords.push(c)
    this.adj.push([])
    return id
  }
  // ref – { id: šaltinio objekto ID, seg: atkarpos numeris }
  link(a, b, w, ref) {
    if (a === b) return
    this.adj[a].push({ to: b, w, ref })
    this.adj[b].push({ to: a, w, ref })
  }
  addLine(coords, id, partIndex) {
    const seg = segment(coords, `${this.name}:${id}:${partIndex}`)
    this.link(this.node(coords[0]), this.node(coords.at(-1)), lineLength(coords), { id, seg })
  }
  // Įrenginio taškas ↔ kabelio galas: tiesi jungtis.
  linkStraight(a, b) {
    const seg = segment([this.coords[a], this.coords[b]], `${this.name}:v:${a}:${b}`, true)
    this.link(a, b, dist(this.coords[a], this.coords[b]), { id: null, seg })
  }
  // Kelių šaltinių Dijkstra: kiekvienam mazgui – atstumas iki artimiausio šaltinio ir ankstesnis mazgas.
  dijkstra(sources) {
    const n = this.coords.length
    const d = new Float64Array(n).fill(Infinity)
    const prev = new Int32Array(n).fill(-1)
    const via = new Array(n).fill(null)
    const heap = []
    const push = (x) => {
      heap.push(x)
      let i = heap.length - 1
      while (i > 0) {
        const p = (i - 1) >> 1
        if (heap[p][0] <= heap[i][0]) break
        ;[heap[p], heap[i]] = [heap[i], heap[p]]
        i = p
      }
    }
    const pop = () => {
      const top = heap[0]
      const last = heap.pop()
      if (heap.length) {
        heap[0] = last
        let i = 0
        for (;;) {
          const l = 2 * i + 1
          const r = l + 1
          let m = i
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r
          if (m === i) break
          ;[heap[m], heap[i]] = [heap[i], heap[m]]
          i = m
        }
      }
      return top
    }
    for (const s of sources) {
      d[s] = 0
      push([0, s])
    }
    while (heap.length) {
      const [du, u] = pop()
      if (du > d[u]) continue
      for (const { to, w, ref } of this.adj[u]) {
        if (du + w < d[to]) {
          d[to] = du + w
          prev[to] = u
          via[to] = ref
          push([d[to], to])
        }
      }
    }
    return { d, prev, via }
  }
  // Ar iš `start` galima pasiekti bent vieną tikslą, neinant per `blocked` mazgą (BFS).
  reaches(start, targets, blocked) {
    const seen = new Set([start])
    const queue = [start]
    while (queue.length) {
      const u = queue.pop()
      if (targets.has(u)) return true
      for (const { to } of this.adj[u]) {
        if (seen.has(to) || to === blocked) continue
        seen.add(to)
        queue.push(to)
      }
    }
    return false
  }
}

// Kelias medžiu nuo mazgo `u` link šaltinio: atkarpų numeriai su kryptimi (+/-, numeris + 1).
function stepSegment(net, tree, u) {
  const ref = tree.via[u]
  const seg = segments[ref.seg]
  // Atkarpa orientuojama nuo u link prev[u]; briaunų trasos saugomos šaltinio → vartotojo kryptimi (apverčiama vėliau).
  const forward = dist(seg.coords[0], net.coords[u]) <= dist(seg.coords.at(-1), net.coords[u])
  return forward ? ref.seg + 1 : -(ref.seg + 1)
}
// Iš vartotojo → šaltinio sekos padarom šaltinio → vartotojo trasą.
const reversePath = (path) => path.map((s) => -s).reverse()

// ---------------------------------------------------------------------------------------------
const [lezFc, areaFc, eso, water] = await Promise.all([
  read('lez_buildings.json'),
  read('area_buildings.json'),
  read('eso_grid.json'),
  read('lez_water.json'),
])
const buildings = [
  ...lezFc.features.map((b) => ({ b, lez: true })),
  ...areaFc.features.map((b) => ({ b, lez: false })),
]
const bid = (b) => `building/${b.properties.OBJECTID}`
const distToBuilding = (c, b) => (booleanPointInPolygon(c, b) ? 0 : pointToPolygonDistance(point(c), b, { units: 'meters' }))
// Pastato „spindulys“ nuo centro – kad paieška aplink jį neimtų tūkstančių nereikalingų taškų.
const radiusOf = (b) => Math.max(...b.geometry.coordinates[0].map((c) => dist(c, b.properties._centroid)))

const nodes = new Map()
const edges = new Map()
const addNode = (id, n) => {
  if (!nodes.has(id)) nodes.set(id, { id, ...n })
}
const addEdge = (from, to, e) => {
  const key = `${from}>${to}`
  if (!edges.has(key)) edges.set(key, { from, to, ...e })
}
for (const { b, lez } of buildings) {
  addNode(bid(b), {
    type: 'building',
    lez,
    name: b.properties._name ?? null,
    purpose: b.properties.PASK ?? null,
    coords: b.properties._centroid,
    source: 'GRPK',
    ref: b.id,
  })
}

// ================================ ELEKTRA ================================
const inAreaFeature = (f) => parts(f.geometry).some((p) => inArea(p[0]) || inArea(p.at(-1))) || pointsOf(f.geometry).some(inArea)
const esoIn = eso.features.filter(inAreaFeature)
const devices = esoIn.filter((f) => f.properties.layer === 'substation')
const hvDevices = eso.features.filter((f) => f.properties.layer === 'substation_hv' || f.properties.layer === 'substation_important')
const esoNodeId = (f) => `eso/${f.id}`
const deviceNode = (f) => ({
  type: f.properties.layer === 'substation' ? 'substation' : 'substation_hv',
  name: f.properties.PAVADINIMAS,
  kind: f.properties.RUSIS,
  voltage_kv: f.properties.ITAMPA,
  // ESO padalinys, atsakingas už objektą (pvz. „Klaipėdos regiono tinklas“).
  unit: f.properties.Padalinys ?? null,
  coords: f.geometry.coordinates,
  source: 'ESO',
  ref: f.id,
})

// 10 (6) / 35 kV tinklas
const mv = new Network('mv')
for (const f of esoIn)
  if (/^(cable|overhead)_(10|35)$/.test(f.properties.layer)) parts(f.geometry).forEach((p, i) => mv.addLine(p, f.id, i))
const mvDevice = new Map() // grafo mazgas → ESO įrenginys
function attachDevice(net, f, radius, map) {
  const c = f.geometry.coordinates
  const v = net.virtual(c)
  map.set(v, f)
  let n = 0
  for (const { item } of net.grid.near(c, radius)) {
    net.linkStraight(v, item)
    n++
  }
  return n ? v : null
}
const hvNodes = new Set()
for (const f of hvDevices) {
  const v = attachDevice(mv, f, HV_M, mvDevice)
  if (v != null) hvNodes.add(v)
}
const deviceRadius = (f) => (/skirstomasis punktas/i.test(f.properties.RUSIS ?? '') ? SP_M : DEVICE_M)
const deviceMvNode = new Map()
for (const f of devices) {
  const v = attachDevice(mv, f, deviceRadius(f), mvDevice)
  if (v != null) deviceMvNode.set(f.id, v)
}
const mvTree = mv.dijkstra([...hvNodes])

// Nuo mazgo link pastotės: įrenginių grandinė ir trasos tarp jų.
function mvWalk(start) {
  const chain = []
  const legs = [] // legs[i] – trasa nuo chain[i] iki chain[i+1] (vartotojo → šaltinio kryptimi)
  let leg = []
  let u = start
  let guard = 0
  const firstDevice = mvDevice.get(start)
  if (firstDevice) chain.push(firstDevice)
  while (mvTree.prev[u] !== -1 && guard++ < 100000) {
    leg.push(stepSegment(mv, mvTree, u))
    u = mvTree.prev[u]
    if (mvDevice.has(u)) {
      if (chain.length) legs.push(leg)
      chain.push(mvDevice.get(u))
      leg = []
    }
  }
  return { chain, legs, lead: chain.length && !firstDevice ? legs.shift() : null }
}

const deviceChains = new Map()
for (const f of devices) {
  const v = deviceMvNode.get(f.id)
  if (v == null || !Number.isFinite(mvTree.d[v])) continue
  const { chain, legs } = mvWalk(v)
  deviceChains.set(f.id, chain)
  for (const dev of chain) addNode(esoNodeId(dev), deviceNode(dev))
  for (let i = 0; i + 1 < chain.length; i++) {
    addEdge(esoNodeId(chain[i + 1]), esoNodeId(chain[i]), {
      kind: 'power',
      confidence: 'kabelis',
      evidence: '10 kV cables (shortest route; switch states unknown)',
      path: reversePath(legs[i]),
    })
  }
}

// 0,4 kV tinklas: transformatorinė → pastatas
const lv = new Network('lv')
for (const f of esoIn)
  if (/^(cable|overhead)_04$/.test(f.properties.layer)) parts(f.geometry).forEach((p, i) => lv.addLine(p, f.id, i))
const lvDevice = new Map()
const lvSources = []
for (const f of devices) {
  const v = attachDevice(lv, f, DEVICE_M, lvDevice)
  if (v != null) lvSources.push(v)
}
const lvTree = lv.dijkstra(lvSources)
function lvWalk(start) {
  const path = []
  let u = start
  let guard = 0
  while (lvTree.prev[u] !== -1 && guard++ < 100000) {
    path.push(stepSegment(lv, lvTree, u))
    u = lvTree.prev[u]
  }
  return { device: lvDevice.get(u), path }
}

const deviceGrid = new Grid(50)
for (const f of devices) deviceGrid.add(f.geometry.coordinates, f)
const straightPath = (a, b, key) => [segment([a, b], key, true) + 1]

function powerFor(b) {
  const c = b.properties._centroid
  const r = radiusOf(b) + BUILDING_M
  // 1) 0,4 kV kabelio galas pasiekia pastatą
  let best = null
  for (const { item, c: nc } of lv.grid.near(c, r)) {
    if (!Number.isFinite(lvTree.d[item]) || distToBuilding(nc, b) > BUILDING_M) continue
    if (!best || lvTree.d[item] < best.len) best = { node: item, len: lvTree.d[item] }
  }
  if (best) {
    const { device, path } = lvWalk(best.node)
    return { device, confidence: 'kabelis', evidence: `0.4 kV cables, ${Math.round(best.len)} m`, path: reversePath(path) }
  }
  // 2) 10 kV kabelio galas pasiekia pastatą (vartotojas su savo transformatoriumi)
  let mvBest = null
  for (const { item, c: nc } of mv.grid.near(c, r)) {
    if (!Number.isFinite(mvTree.d[item]) || mvDevice.has(item) || distToBuilding(nc, b) > BUILDING_M) continue
    if (mvBest == null || mvTree.d[item] < mvTree.d[mvBest]) mvBest = item
  }
  if (mvBest != null) {
    const path = []
    let u = mvBest
    let guard = 0
    while (u !== -1 && !mvDevice.has(u) && guard++ < 100000) {
      if (mvTree.prev[u] !== -1) path.push(stepSegment(mv, mvTree, u))
      u = mvTree.prev[u]
    }
    if (u !== -1) return { device: mvDevice.get(u), confidence: 'kabelis', evidence: '10 kV cable to the building', path: reversePath(path) }
  }
  // 3) transformatorinė pastate ar prie jo
  const onSite = deviceGrid.near(c, r).find(({ item }) => distToBuilding(item.geometry.coordinates, b) <= BUILDING_M)
  if (onSite) {
    const d = onSite.item
    return {
      device: d,
      confidence: 'greta',
      evidence: 'transformer in / next to the building (≤ 5 m)',
      path: straightPath(d.geometry.coordinates, c, `p:${d.id}:${bid(b)}`),
    }
  }
  // 4) artimiausia transformatorinė
  const near = deviceGrid.near(c, INFERRED_POWER_M)[0]
  if (near) {
    return {
      device: near.item,
      confidence: 'numanomas',
      evidence: `nearest transformer, ${Math.round(near.d)} m`,
      path: straightPath(near.item.geometry.coordinates, c, `p:${near.item.id}:${bid(b)}`),
    }
  }
  return null
}

// ================================ VANDUO ================================
const pipes = water.features.filter((f) => f.properties.layer === 'pipe')
const valves = water.features.filter((f) => f.properties.layer === 'valve')
const hydrants = water.features.filter((f) => f.properties.layer === 'hydrant')
const pipeById = new Map(pipes.map((p) => [p.id, p]))
const wn = new Network('water')
for (const p of pipes) parts(p.geometry).forEach((part, i) => wn.addLine(part, p.id, i))
const isMain = (p) => String(p.properties.Class ?? '').startsWith('V Mag.')
const isInlet = (p) => String(p?.properties.Class ?? '').startsWith('V Įvadai')
const mainNodes = new Set()
for (const p of pipes)
  if (isMain(p))
    for (const part of parts(p.geometry)) {
      mainNodes.add(wn.node(part[0]))
      mainNodes.add(wn.node(part.at(-1)))
    }
// Sklendė – vamzdžių mazge (≤ 2 m); kitaip jos vietos tinkle nežinome.
const valveAt = new Map()
let valvesUnplaced = 0
for (const v of valves)
  for (const c of pointsOf(v.geometry)) {
    const hit = wn.grid.near(c, 2)[0]
    if (hit) valveAt.set(hit.item, v)
    else valvesUnplaced++
  }
const wTree = wn.dijkstra([...mainNodes])
const hydrantGrid = new Grid(100)
for (const h of hydrants) for (const c of pointsOf(h.geometry)) hydrantGrid.add(c, h)
// Kritinė sklendė: ją uždarius mazgas nebepasiekia jokios magistralės. Rezultatas bendras visiems pastatams.
const criticalCache = new Map()
const isCritical = (start, valveNode) => {
  const key = `${start}:${valveNode}`
  if (!criticalCache.has(key)) criticalCache.set(key, !wn.reaches(start, mainNodes, valveNode))
  return criticalCache.get(key)
}

function waterFor(b) {
  const c = b.properties._centroid
  const r = radiusOf(b) + BUILDING_M
  let best = null
  let bestInlet = false
  for (const { item, c: nc } of wn.grid.near(c, r)) {
    if (!Number.isFinite(wTree.d[item]) || distToBuilding(nc, b) > BUILDING_M) continue
    const inlet = wn.adj[item].some((e) => isInlet(pipeById.get(e.ref?.id)))
    if (best == null || (inlet && !bestInlet) || (inlet === bestInlet && wTree.d[item] < wTree.d[best])) {
      best = item
      bestInlet = inlet
    }
  }
  let confidence = 'kabelis'
  let evidence = bestInlet ? 'service pipe to the building' : 'pipe to the building'
  let lead = []
  if (best == null) {
    const near = wn.grid
      .near(c, r + INFERRED_WATER_M)
      .find((e) => Number.isFinite(wTree.d[e.item]) && distToBuilding(e.c, b) <= INFERRED_WATER_M)
    if (!near) return null
    best = near.item
    confidence = 'numanomas'
    evidence = `nearest pipe, ${Math.round(distToBuilding(near.c, b))} m`
    lead = straightPath(wn.coords[best], c, `w:${best}:${bid(b)}`)
  }
  // Kelias iki magistralės; dalijamas ties kritinėmis sklendėmis.
  const legs = [[]]
  const stops = [] // kritinės sklendės nuo pastato link magistralės
  const pathPipes = []
  const pathValves = []
  let u = best
  let guard = 0
  while (guard++ < 100000) {
    if (valveAt.has(u)) {
      pathValves.push(valveAt.get(u).id)
      if (u !== best && isCritical(best, u)) {
        stops.push(valveAt.get(u))
        legs.push([])
      }
    }
    if (mainNodes.has(u) || wTree.prev[u] === -1) break
    pathPipes.push(wTree.via[u].id)
    legs.at(-1).push(stepSegment(wn, wTree, u))
    u = wTree.prev[u]
  }
  const mainPipe = wn.adj[u].map((e) => pipeById.get(e.ref?.id)).find((p) => p && isMain(p)) ?? null
  const diameters = pathPipes.map((id) => Number(pipeById.get(id)?.properties.Diameter)).filter(Number.isFinite)
  const hyd = [...new Map(hydrantGrid.near(c, r + HYDRANT_M).map((h) => [h.item.id, { h: h.item, d: distToBuilding(h.c, b) }])).values()]
    .filter((x) => x.d <= HYDRANT_M)
    .sort((a, z) => a.d - z.d)
  return {
    confidence,
    evidence,
    path_length_m: Math.round(wTree.d[best]),
    min_diameter_mm: diameters.length ? Math.min(...diameters) : null,
    main_pipe: mainPipe?.id ?? null,
    valves_on_path: pathValves,
    critical_valves: stops.map((v) => v.id),
    hydrants_150m: hyd.length,
    nearest_hydrant: hyd[0] ? { id: hyd[0].h.id, distance_m: Math.round(hyd[0].d) } : null,
    // trasos: legs[0] – pastatas → pirma kritinė sklendė (ar magistralė), ...; + tiesi jungtis numanomam ryšiui
    _legs: legs,
    _lead: lead,
    _stops: stops,
    _mainPipe: mainPipe,
  }
}

// ================================ PASTATAI ================================
const perBuilding = {}
const affects = new Map() // mazgas → pastatai, kurie nuo jo priklauso
const affect = (nodeId, buildingId) => {
  if (!affects.has(nodeId)) affects.set(nodeId, new Set())
  affects.get(nodeId).add(buildingId)
}
const stat = () => ({ kabelis: 0, greta: 0, numanomas: 0, none: 0 })
const stats = {
  buildings: { lez: 0, other: 0 },
  power: { lez: stat(), other: stat() },
  water: { lez: stat(), other: stat() },
}

let done = 0
for (const { b, lez } of buildings) {
  const id = bid(b)
  const group = lez ? 'lez' : 'other'
  stats.buildings[group]++

  const power = powerFor(b)
  let powerInfo = null
  if (power) {
    const dev = power.device
    addNode(esoNodeId(dev), deviceNode(dev))
    addEdge(esoNodeId(dev), id, { kind: 'power', confidence: power.confidence, evidence: power.evidence, path: power.path })
    const upstream = deviceChains.get(dev.id)
    const chain = upstream ? upstream.map(esoNodeId) : [esoNodeId(dev)]
    if (chain[0] !== esoNodeId(dev)) chain.unshift(esoNodeId(dev))
    for (const n of chain) affect(n, id)
    powerInfo = {
      confidence: power.confidence,
      evidence: power.evidence,
      device: esoNodeId(dev),
      chain,
      reaches_hv: Boolean(upstream) || hvDevices.includes(dev),
    }
    stats.power[group][power.confidence]++
  } else stats.power[group].none++

  const w = waterFor(b)
  if (w) {
    let upstreamId = null
    if (w._mainPipe) {
      upstreamId = `water/${w._mainPipe.id}`
      addNode(upstreamId, {
        type: 'water_main',
        name: `Water main Ø${w._mainPipe.properties.Diameter ?? '?'} mm`,
        coords: parts(w._mainPipe.geometry)[0][0],
        source: 'Klaipėdos vanduo',
        ref: w._mainPipe.id,
      })
      affect(upstreamId, id)
    }
    // Nuo magistralės link pastato: magistralė → sklendė → ... → pastatas.
    const stops = [...w._stops].reverse()
    const legs = [...w._legs].reverse()
    for (let i = 0; i < stops.length; i++) {
      const v = stops[i]
      const nid = `water/${v.id}`
      addNode(nid, {
        type: 'water_valve',
        name: `Valve ${v.properties.Label ?? ''}`.trim(),
        coords: pointsOf(v.geometry)[0],
        source: 'Klaipėdos vanduo',
        ref: v.id,
      })
      affect(nid, id)
      if (upstreamId) {
        addEdge(upstreamId, nid, {
          kind: 'water',
          confidence: 'kabelis',
          evidence: 'pipes (the only route goes through this valve)',
          path: reversePath(legs[i]),
        })
      }
      upstreamId = nid
    }
    if (upstreamId) {
      addEdge(upstreamId, id, {
        kind: 'water',
        confidence: w.confidence,
        evidence: w.evidence,
        path: [...reversePath(legs.at(-1)), ...w._lead],
      })
    }
    const { _legs, _lead, _stops, _mainPipe, ...info } = w
    perBuilding[id] = { power: powerInfo, water: info }
    stats.water[group][w.confidence]++
  } else {
    perBuilding[id] = { power: powerInfo, water: null }
    stats.water[group].none++
  }
  if (++done % 500 === 0) console.log(`  ${done}/${buildings.length} pastatų`)
}

// Įtaka: kiek pastatų (LEZ / aplinkinių pagal paskirtį) priklauso nuo kiekvieno tinklo mazgo.
for (const [nodeId, set] of affects) {
  const node = nodes.get(nodeId)
  if (!node) continue
  const list = [...set]
  const lez = list.filter((b) => nodes.get(b).lez)
  const byPurpose = {}
  for (const b of list) {
    if (nodes.get(b).lez) continue
    const p = nodes.get(b).purpose ?? 'nežinoma'
    byPurpose[p] = (byPurpose[p] ?? 0) + 1
  }
  node.affects = list
  node.impact = { lez: lez.length, other: list.length - lez.length, other_by_purpose: byPurpose }
}

const hvImpact = [...nodes.values()]
  .filter((n) => n.type === 'substation_hv' && n.impact)
  .map((n) => `${n.name} ${n.voltage_kv} kV: ${n.impact.lez} LEZ + ${n.impact.other} kitų`)

await writeFile(
  OUT,
  JSON.stringify({
    metadata: {
      built_at: new Date().toISOString(),
      area: GRAPH_AREA,
      method: {
        snap_m: SNAP_M,
        device_m: DEVICE_M,
        sp_m: SP_M,
        hv_m: HV_M,
        building_m: BUILDING_M,
        inferred_power_m: INFERRED_POWER_M,
        inferred_water_m: INFERRED_WATER_M,
        hydrant_m: HYDRANT_M,
        note: 'Links derived from ESO and Klaipėdos vanduo network geometry; switch and valve states are unknown.',
      },
      valves_unplaced: valvesUnplaced,
      stats,
    },
    segments,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    buildings: perBuilding,
  }),
)
console.log(JSON.stringify(stats))
console.log(hvImpact.join('\n'))
console.log(`Mazgų: ${nodes.size}, briaunų: ${edges.size}, atkarpų: ${segments.length}`)
