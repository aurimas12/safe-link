// Gelbėjimo tarnybos, priedangos ir privažiavimo laikai LEZ pastatams → src/data/lez_emergency.json.
//
// Šaltiniai: gaisrinės ir greitosios pagalbos stotys, keliai – OpenStreetMap;
// priedangos, kolektyvinės apsaugos statiniai (KAS), evakuacijos punktai – PAGD atviri duomenys (get.data.gov.lt).
//
// Važiavimo laikas – ĮVERTIS: trumpiausias laikas OSM kelių tinklu, greitis pagal `maxspeed` arba kelio tipą,
// be eismo, be pasiruošimo išvykti laiko; specialiosios tarnybos gali važiuoti prieš vienpusį eismą, todėl jis neribojamas.
//
// Paleidimas: npm run fetch:emergency

import { readFile, writeFile } from 'node:fs/promises'

const OUT = new URL('../src/data/lez_emergency.json', import.meta.url)
const OVERPASS = 'https://overpass-api.de/api/interpreter'
const PAGD = 'https://get.data.gov.lt/datasets/gov/pagd'
const UA = { 'User-Agent': 'safe-link (FEZ Resilience OS)' }
// Klaipėda su rajonu – kad būtų įtrauktos ir Gargždų, Priekulės komandos. [pietūs, vakarai, šiaurė, rytai]
const REGION = '55.52,21.00,55.82,21.45'
const MUNICIPALITIES = ['Klaipėdos m. sav.', 'Klaipėdos r. sav.']

const LAT0 = 55.69
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180)
const MY = 110574
const dist = (a, b) => Math.hypot((a[0] - b[0]) * MX, (a[1] - b[1]) * MY)

async function overpass(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }), headers: UA })
      if (!res.ok) throw new Error(`Overpass ${res.status}`)
      return (await res.json()).elements
    } catch (err) {
      if (attempt >= 4) throw err
      await new Promise((r) => setTimeout(r, 5000 * attempt))
    }
  }
}

// --- 1. Stotys (OSM) ---
const stationEls = await overpass(`[out:json][timeout:90];
(nwr["amenity"="fire_station"](${REGION});nwr["emergency"="ambulance_station"](${REGION}););
out tags center;`)
const stations = stationEls.map((e) => {
  const t = e.tags
  const c = e.center ?? { lat: e.lat, lon: e.lon }
  const address = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') || null
  const kind = t.amenity === 'fire_station' ? 'fire' : 'ambulance'
  return {
    id: `osm/${e.type}/${e.id}`,
    kind,
    name: t.name ?? (kind === 'fire' ? 'Fire station' : 'Ambulance station') + (address ? ` (${address})` : ''),
    address,
    coords: [c.lon, c.lat],
    source: 'OpenStreetMap',
  }
})
console.log(`Stotys: ${stations.filter((s) => s.kind === 'fire').length} gaisrinių, ${stations.filter((s) => s.kind === 'ambulance').length} greitosios`)

// --- 2. PAGD priedangos, KAS, evakuacijos punktai ---
async function pagd(model, kind) {
  const out = []
  for (const sav of MUNICIPALITIES) {
    const res = await fetch(`${PAGD}/${model}?savivaldybe=${encodeURIComponent(`"${sav}"`)}&limit(10000)`, { headers: UA })
    const data = await res.json()
    if (data.errors) throw new Error(`PAGD ${model}: ${data.errors[0].message}`)
    for (const x of data._data) {
      // PAGD įrašai – originalūs; koordinatės iš jų WGS laukų.
      const { _type, _revision, _base, ...props } = x
      out.push({ id: `pagd/${kind}/${x.vda_id}`, kind, coords: [x.wgs_lon_ilguma, x.wgs_lat_platuma], props })
    }
  }
  return out.filter((p) => Number.isFinite(p.coords[0]) && Number.isFinite(p.coords[1]))
}
const shelters = [
  ...(await pagd('priedangos/Priedanga', 'shelter')),
  ...(await pagd('kas/KAS', 'kas')),
  ...(await pagd('evakuacijos_punktai/EvakuacijosPunktas', 'evacuation')),
]
console.log(`PAGD: ${shelters.filter((s) => s.kind === 'shelter').length} priedangų, ${shelters.filter((s) => s.kind === 'kas').length} KAS, ${shelters.filter((s) => s.kind === 'evacuation').length} evakuacijos punktų`)

// --- 3. Kelių tinklas (OSM) ---
const HIGHWAYS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link'
const roadEls = await overpass(`[out:json][timeout:180];
way["highway"~"^(${HIGHWAYS})$"](${REGION});
(._;>;);
out body qt;`)
const DEFAULT_KMH = {
  motorway: 110, trunk: 90, primary: 50, secondary: 50, tertiary: 50, unclassified: 40, residential: 30,
  living_street: 20, service: 20, motorway_link: 60, trunk_link: 50, primary_link: 40, secondary_link: 40, tertiary_link: 40,
}
const coordOf = new Map()
for (const e of roadEls) if (e.type === 'node') coordOf.set(e.id, [e.lon, e.lat])
const adj = new Map()
const link = (a, b, sec) => {
  if (!adj.has(a)) adj.set(a, [])
  adj.get(a).push([b, sec])
}
let roadCount = 0
for (const w of roadEls) {
  if (w.type !== 'way') continue
  roadCount++
  const ms = parseFloat(w.tags.maxspeed)
  const kmh = Number.isFinite(ms) && ms > 0 ? ms : (DEFAULT_KMH[w.tags.highway] ?? 30)
  for (let i = 0; i + 1 < w.nodes.length; i++) {
    const a = w.nodes[i]
    const b = w.nodes[i + 1]
    const sec = dist(coordOf.get(a), coordOf.get(b)) / (kmh / 3.6)
    link(a, b, sec)
    link(b, a, sec)
  }
}
const roadNodes = [...adj.keys()]
console.log(`Keliai: ${roadCount} atkarpų, ${roadNodes.length} mazgų`)
// `allowed` – tik pagrindinio (sujungto) tinklo mazgai, kad pastatas nebūtų prijungtas prie atskiros kelio atkarpos.
const nearestRoad = (c, allowed = null) => {
  let best = null
  let bd = Infinity
  for (const n of roadNodes) {
    if (allowed && !allowed.has(n)) continue
    const d = dist(c, coordOf.get(n))
    if (d < bd) {
      bd = d
      best = n
    }
  }
  return { node: best, snap_m: bd }
}

function dijkstra(start) {
  const d = new Map([[start, 0]])
  const heap = [[0, start]]
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
  while (heap.length) {
    const [du, u] = pop()
    if (du > d.get(u)) continue
    for (const [v, w] of adj.get(u) ?? []) {
      const nd = du + w
      if (nd < (d.get(v) ?? Infinity)) {
        d.set(v, nd)
        push([nd, v])
      }
    }
  }
  return d
}

// --- 4. Laikai iki LEZ pastatų ---
const buildings = JSON.parse(await readFile(new URL('../src/data/lez_buildings.json', import.meta.url))).features
const stationTimes = stations.map((s) => {
  const start = nearestRoad(s.coords)
  return { station: s, snap_m: start.snap_m, times: dijkstra(start.node) }
})
// Pagrindinis tinklas – mazgai, pasiekiami iš Klaipėdos apskrities valdybos (didžiausios komandos).
const main = stationTimes.reduce((a, b) => (b.times.size > a.times.size ? b : a)).times
const buildingRoad = new Map(buildings.map((b) => [b.properties.OBJECTID, nearestRoad(b.properties._centroid, main)]))

const perBuilding = {}
for (const b of buildings) {
  const road = buildingRoad.get(b.properties.OBJECTID)
  const eta = (kind) =>
    stationTimes
      .filter((x) => x.station.kind === kind && x.times.has(road.node))
      .map((x) => ({ station: x.station.id, minutes: Math.round((x.times.get(road.node) / 60) * 10) / 10 }))
      .sort((a, z) => a.minutes - z.minutes)
      .slice(0, 3)
  const nearest = (kind) =>
    shelters
      .filter((s) => s.kind === kind)
      .map((s) => ({ id: s.id, distance_m: Math.round(dist(s.coords, b.properties._centroid)) }))
      .sort((a, z) => a.distance_m - z.distance_m)
      .slice(0, 3)
  perBuilding[`building/${b.properties.OBJECTID}`] = {
    road_snap_m: Math.round(road.snap_m),
    fire: eta('fire'),
    ambulance: eta('ambulance'),
    shelters: nearest('shelter'),
    kas: nearest('kas'),
    evacuation: nearest('evacuation'),
  }
}

await writeFile(
  OUT,
  JSON.stringify({
    metadata: {
      fetched_at: new Date().toISOString(),
      region: REGION,
      sources: {
        stations: 'OpenStreetMap (amenity=fire_station, emergency=ambulance_station)',
        roads: 'OpenStreetMap (highway)',
        shelters: `${PAGD} (priedangos, kas, evakuacijos_punktai)`,
      },
      eta_note:
        'Travel time is an estimate: OSM roads, speed from maxspeed or road type, no traffic and no turnout time.',
      default_kmh: DEFAULT_KMH,
    },
    stations,
    shelters,
    buildings: perBuilding,
  }),
)
const fireMin = Object.values(perBuilding).map((x) => x.fire[0]?.minutes).filter(Number.isFinite)
console.log(`Artimiausia gaisrinė: ${Math.min(...fireMin)}–${Math.max(...fireMin)} min (${fireMin.length} pastatų)`)
