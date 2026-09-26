// Incidentų statistikos duomenys:
//  - PAGD įvykių ir išvykčių suvestinė (data.gov.lt) – Klaipėdos m. sav., paskutiniai 12 mėn. → src/data/incidents_pagd.json
//  - AB „Klaipėdos vanduo“ „Avarijos, skundai ir sutrikimai“ (vieša paslauga saugo tik ~2 savaites) →
//    src/data/incidents_kv.json – KAUPIAMA: kiekvienas paleidimas prideda naujus įrašus prie ankstesnių.
// Įrašai – originalūs; pridedamas tik `_first_seen` (kada įrašas pirmą kartą parsiųstas).
//
// Paleidimas: npm run fetch:incidents  (kaupimui – paleisti reguliariai, pvz. kas dieną)

import { readFile, writeFile } from 'node:fs/promises'

const PAGD = 'https://get.data.gov.lt/datasets/gov/pagd/ivykiu_suvestine/Ivykis'
const KV = 'https://services3.arcgis.com/M4io14RNoaeb2ldw/arcgis/rest/services/Avarijos_layer_rodinys/FeatureServer/0'
const MUNICIPALITY = 'Klaipėdos m. sav.'
const OUT_PAGD = new URL('../src/data/incidents_pagd.json', import.meta.url)
const OUT_KV = new URL('../src/data/incidents_kv.json', import.meta.url)
const UA = { 'User-Agent': 'safe-link (FEZ Resilience OS)' }

const now = new Date()
const from = new Date(now)
from.setFullYear(now.getFullYear() - 1)
const fromDay = from.toISOString().slice(0, 10)

// --- PAGD ---
const params = new URLSearchParams()
params.append('administracinis_vienetas', `"${MUNICIPALITY}"`)
params.append('korteles_data>', `"${fromDay}"`)
const pagdUrl = `${PAGD}?${[...params].map(([k, v]) => (k.endsWith('>') ? `${k.slice(0, -1)}>=${encodeURIComponent(v)}` : `${k}=${encodeURIComponent(v)}`)).join('&')}&limit(100000)`
const pagdRes = await fetch(pagdUrl, { headers: UA })
const pagd = await pagdRes.json()
if (pagd.errors) throw new Error(`PAGD: ${JSON.stringify(pagd.errors)}`)
const records = pagd._data.map(({ _type, _revision, _base, ...r }) => r)
const dates = records.map((r) => r.korteles_data).sort()
await writeFile(
  OUT_PAGD,
  JSON.stringify({
    metadata: {
      source: 'PAGD įvykių ir išvykčių suvestinė, data.gov.lt (datasets/gov/pagd/ivykiu_suvestine)',
      municipality: MUNICIPALITY,
      requested_from: fromDay,
      data_from: dates[0] ?? null,
      data_to: dates.at(-1) ?? null,
      fetched_at: now.toISOString(),
      note: 'Event location and description are censored in the open data – only the municipality is known.',
    },
    records,
  }),
)
console.log(`PAGD: ${records.length} įvykių (${dates[0]} – ${dates.at(-1)})`)

// --- Klaipėdos vanduo (kaupiama) ---
let history = { metadata: {}, features: [] }
try {
  history = JSON.parse(await readFile(OUT_KV, 'utf8'))
} catch {
  // pirmas paleidimas
}
const known = new Map(history.features.map((f) => [f.properties.OBJECTID, f]))
const kvRes = await fetch(`${KV}/query?${new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', f: 'geojson' })}`, { headers: UA })
const kv = await kvRes.json()
let added = 0
for (const f of kv.features) {
  const prev = known.get(f.properties.OBJECTID)
  // Naujausia įrašo versija (būsena gali pasikeisti), bet pirmo pastebėjimo laikas išlieka.
  known.set(f.properties.OBJECTID, { ...f, properties: { ...f.properties, _first_seen: prev?.properties._first_seen ?? now.toISOString() } })
  if (!prev) added++
}
const features = [...known.values()].sort((a, b) => (a.properties.pranesimo_datetime ?? 0) - (b.properties.pranesimo_datetime ?? 0))
const kvDates = features.map((f) => f.properties.pranesimo_datetime).filter(Boolean)
await writeFile(
  OUT_KV,
  JSON.stringify({
    type: 'FeatureCollection',
    metadata: {
      source: 'AB „Klaipėdos vanduo“ – Avarijos, skundai ir sutrikimai (public ArcGIS layer)',
      note: 'The public layer keeps only ~2 weeks; this file accumulates records across runs.',
      collecting_since: history.metadata.collecting_since ?? now.toISOString(),
      last_run: now.toISOString(),
      data_from: kvDates.length ? new Date(Math.min(...kvDates)).toISOString() : null,
      data_to: kvDates.length ? new Date(Math.max(...kvDates)).toISOString() : null,
    },
    features,
  }),
)
console.log(`Klaipėdos vanduo: ${kv.features.length} dabar, ${added} naujų, istorijoje ${features.length}`)
