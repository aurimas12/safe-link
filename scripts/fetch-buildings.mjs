// Parsiunčia LEZ teritorijos pastatus ir įrašo į src/data/lez_buildings.json:
//  - pastatų kontūrai ir atributai – oficialus GRPK (Georeferencinio pagrindo kadastras, geoportal.lt), nekeičiami;
//  - paskirties kodų pavadinimai – Registrų centro NTR paskirčių klasifikatorius (get.data.gov.lt);
//  - įmonių pavadinimai ir adresai – OpenStreetMap objektai, esantys tame pastate (GRPK įmonių neturi).
//
// Paleidimas: npm run fetch:buildings

import { booleanPointInPolygon, centroid, area, intersect, featureCollection } from '@turf/turf'
import { readFile, writeFile } from 'node:fs/promises'

const GRPK_BUILDINGS = 'https://www.geoportal.lt/mapproxy/rest/services/gisc_grpk/MapServer/22'
const NTR_PURPOSES = 'https://get.data.gov.lt/datasets/gov/rc/ntr/ntr_paskirtys/NtrPaskirtiesTipas'
const OVERPASS = 'https://overpass-api.de/api/interpreter'
const OUT = new URL('../src/data/lez_buildings.json', import.meta.url)
const UA = { 'User-Agent': 'safe-link (FEZ Resilience OS)' }

const fez = JSON.parse(await readFile(new URL('../src/data/fez_boundary.json', import.meta.url)))
const fezGeometry = fez.features[0].geometry

// --- 1. GRPK pastatai LEZ ribose ---
async function fetchGrpk() {
  const features = []
  for (let offset = 0; ; offset += 1000) {
    const body = new URLSearchParams({
      geometry: JSON.stringify({ rings: fezGeometry.coordinates, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryPolygon',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      where: '1=1',
      outFields: '*',
      outSR: '4326',
      returnGeometry: 'true',
      resultOffset: String(offset),
      resultRecordCount: '1000',
      f: 'json',
    })
    const res = await fetch(`${GRPK_BUILDINGS}/query`, { method: 'POST', body, headers: UA })
    const data = await res.json()
    if (data.error) throw new Error(`GRPK: ${JSON.stringify(data.error)}`)
    for (const f of data.features) {
      features.push({
        type: 'Feature',
        id: `grpk/${f.attributes.OBJECTID}`,
        // Visi GRPK atributai – originalūs.
        properties: { ...f.attributes },
        geometry: { type: 'Polygon', coordinates: f.geometry.rings },
      })
    }
    if (!data.exceededTransferLimit) break
  }
  return features
}

// --- 2. NTR paskirčių klasifikatorius (kodas → pavadinimas) ---
async function fetchPurposes() {
  const res = await fetch(`${NTR_PURPOSES}?limit(1000)`, { headers: UA })
  const data = await res.json()
  return {
    lt: Object.fromEntries(data._data.map((p) => [String(p.pask_tipas), p.pask_pav])),
    // Oficialus Registrų centro vertimas (pask_pav_i_en) – anglų kalbos sąsajai.
    en: Object.fromEntries(data._data.map((p) => [String(p.pask_tipas), p.pask_pav_i_en])),
  }
}

// --- 3. OSM įmonės / pavadinti objektai LEZ ribose ---
async function fetchOsm() {
  const poly = fezGeometry.coordinates[0].map(([lon, lat]) => `${lat} ${lon}`).join(' ')
  const query = `[out:json][timeout:90];
(
  nwr["name"](poly:"${poly}");
  nwr["addr:housenumber"](poly:"${poly}");
);
out geom tags;`
  // Overpass kartais grąžina klaidą ar tuščią atsakymą dėl apkrovos – bandom kelis kartus.
  let elements
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }), headers: UA })
      if (!res.ok) throw new Error(`Overpass ${res.status}`)
      ;({ elements } = await res.json())
      break
    } catch (err) {
      if (attempt >= 4) throw err
      await new Promise((r) => setTimeout(r, 3000 * attempt))
    }
  }
  // Linijos (elektros linijos, keliai, grioviai) pastatams nepriklauso.
  const skip = (t) => t.highway || t.power === 'line' || t.waterway || t.railway || t.place || t.landuse === 'industrial'
  return elements
    .filter((e) => e.tags && !skip(e.tags))
    .map((e) => {
      let geometry
      if (e.type === 'node') geometry = { type: 'Point', coordinates: [e.lon, e.lat] }
      else if (e.type === 'way' && e.geometry?.length > 3) geometry = { type: 'Polygon', coordinates: [e.geometry.map((p) => [p.lon, p.lat])] }
      else return null
      return { type: 'Feature', properties: { osm_id: `${e.type}/${e.id}`, tags: e.tags }, geometry }
    })
    .filter(Boolean)
}

// OSM objekto ir pastato sutapimas (m²): taškas pastate – 1; poligonai – persidengimo plotas,
// jei jis ≥ 30 % mažesniojo ploto; kitaip 0.
function overlapScore(building, osm) {
  if (osm.geometry.type === 'Point') return booleanPointInPolygon(osm, building) ? 1 : 0
  const overlap = intersect(featureCollection([building, osm]))
  if (!overlap) return 0
  const a = area(overlap)
  return a >= 0.3 * Math.min(area(building), area(osm)) ? a : 0
}

const [buildings, purposes, osm] = await Promise.all([fetchGrpk(), fetchPurposes(), fetchOsm()])

// OSM įmonė dažnai pažymėta kaip visa teritorija, apimanti kelis pastatus. Pavadinimas priskiriamas tik
// pagrindiniam pastatui (didžiausias persidengimas), kiti tampa „teritorijos dalimi“ – kad įmonė
// (ir jos darbuotojai, pajamos) nebūtų skaičiuojama kelis kartus.
const scores = osm.map((o) => buildings.map((b) => overlapScore(b, o)))
const primaryOf = scores.map((row) => {
  const max = Math.max(...row)
  return max > 0 ? row.indexOf(max) : -1
})

let matched = 0
buildings.forEach((b, bi) => {
  const found = osm
    .map((o, oi) => ({ o, oi }))
    .filter(({ oi }) => scores[oi][bi] > 0)
    .map(({ o, oi }) => ({ o, role: primaryOf[oi] === bi ? 'building' : 'site' }))
  if (found.length) matched++
  // Pridedam tik nuorodas į OSM objektus su jų žymomis ir vaidmeniu – GRPK atributai lieka nepakeisti.
  b.properties._osm = found.map(({ o, role }) => ({ osm_id: o.properties.osm_id, _role: role, ...o.properties.tags }))
  // Žemėlapio etiketei – plokšti laukai (MapLibre išraiškos nemoka skaityti įdėtų masyvų).
  const namesOf = (role) => [...new Set(found.filter((f) => f.role === role).map((f) => f.o.properties.tags.name).filter(Boolean))]
  const own = namesOf('building')
  const site = namesOf('site').filter((n) => !own.includes(n))
  if (own.length) b.properties._name = own.join(', ')
  if (site.length) b.properties._site = site.join(', ')
  b.properties._centroid = centroid(b).geometry.coordinates
})

await writeFile(
  OUT,
  JSON.stringify({
    type: 'FeatureCollection',
    metadata: {
      sources: {
        buildings: 'GRPK – Georeferencinio pagrindo kadastras (NŽT, geoportal.lt), sluoksnis „Pastatai“',
        purposes: 'Registrų centras, NTR paskirčių klasifikatorius (get.data.gov.lt)',
        companies: 'OpenStreetMap contributors (ODbL)',
      },
      fetched_at: new Date().toISOString(),
      ntr_purposes: purposes.lt,
      ntr_purposes_en: purposes.en,
    },
    features: buildings,
  }),
)
console.log(`GRPK pastatų: ${buildings.length}, su OSM įmone/adresu: ${matched}, OSM objektų: ${osm.length}`)
