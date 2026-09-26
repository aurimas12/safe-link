// Orų stebėjimai koreliacijai su incidentais → src/data/weather_klaipeda.json
//
// Šaltinis: LHMT (meteo.lt) API, Klaipėdos AMS stotis, valandiniai stebėjimai.
// Laikotarpis – toks pat kaip PAGD įvykių (incidents_pagd.json), todėl paleisti po fetch:incidents.
// Reikšmės išsaugomos originalios (tik atrinkti reikalingi laukai); dienos suvestinės skaičiuojamos programoje.
// API riba – 180 užklausų per minutę, todėl siunčiama ne greičiau kaip 2 per sekundę.
//
// Paleidimas: npm run fetch:weather

import { readFile, writeFile } from 'node:fs/promises'

const STATION = 'klaipedos-ams'
const API = `https://api.meteo.lt/v1/stations/${STATION}/observations`
const PAGD = new URL('../src/data/incidents_pagd.json', import.meta.url)
const OUT = new URL('../src/data/weather_klaipeda.json', import.meta.url)
const FIELDS = ['observationTimeUtc', 'airTemperature', 'windSpeed', 'windGust', 'precipitation', 'relativeHumidity', 'snowDepth']
const UA = { 'User-Agent': 'safe-link (FEZ Resilience OS)' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { metadata } = JSON.parse(await readFile(PAGD, 'utf8'))
// Viena diena atsargos iš abiejų pusių: stebėjimai UTC, įvykiai – Lietuvos laiku.
const from = new Date(`${metadata.data_from}T00:00:00Z`)
from.setUTCDate(from.getUTCDate() - 1)
const to = new Date(`${metadata.data_to}T00:00:00Z`)
to.setUTCDate(to.getUTCDate() + 1)

const observations = []
const missing = []
for (const d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
  const day = d.toISOString().slice(0, 10)
  // Tinklo klaidos ir 429 (per daug užklausų) – kartojama; nepavykus diena pažymima kaip trūkstama.
  let json = null
  for (let attempt = 0; attempt < 4 && !json; attempt++) {
    try {
      const res = await fetch(`${API}/${day}`, { headers: UA, signal: AbortSignal.timeout(20000) })
      if (res.status === 429) await sleep(30000)
      else if (res.ok) json = await res.json()
      else break
    } catch (err) {
      console.warn(`\n${day}: ${err.message} – kartojama`)
      await sleep(3000 * (attempt + 1))
    }
  }
  if (!json) missing.push(day)
  else for (const o of json.observations ?? []) observations.push(Object.fromEntries(FIELDS.map((f) => [f, o[f] ?? null])))
  process.stdout.write(`\r${day} (${observations.length} stebėjimų)`)
  await sleep(500)
}

await writeFile(
  OUT,
  JSON.stringify({
    metadata: {
      source: 'LHMT, api.meteo.lt – hourly observations',
      station: STATION,
      station_name: 'Klaipėdos AMS',
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      fetched_at: new Date().toISOString(),
      missing_days: missing,
      units: { airTemperature: '°C', windSpeed: 'm/s', windGust: 'm/s', precipitation: 'mm', relativeHumidity: '%', snowDepth: 'cm' },
    },
    observations,
  }),
)
console.log(`\nIšsaugota: ${observations.length} valandinių stebėjimų, trūksta dienų: ${missing.length}`)
