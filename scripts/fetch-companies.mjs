// LEZ įmonių darbuotojai ir finansai: OSM pavadinimas → Sodros draudėjas (įmonės kodas) → JAR pelno ataskaita.
// Įrašo į src/data/lez_companies.json.
//
// Šaltiniai (atviri): „Sodra“ atvira.sodra.lt (mėnesiniai draudėjų duomenys),
// Registrų centras get.data.gov.lt (Juridinių asmenų registras, pelno (nuostolių) ataskaitos).
//
// Pavadinimai OSM ir registruose skiriasi, o tas pats vardas gali priklausyti kitai įmonei
// (pvz. UAB „REHAU“ – Vilniaus didmeninė prekyba, ne LEZ gamykla). Todėl kiekvienas susiejimas turi patikimumą:
//   'tikslus'   – vienintelė Klaipėdos įmonė tuo pačiu pavadinimu;
//   'tikėtinas' – vienintelė Klaipėdos įmonė, kurios pavadinime yra visi OSM pavadinimo žodžiai;
//   'kitur'     – Klaipėdoje tokios įmonės nėra, bet yra vienintelė registruota kitur (LEZ – tik padalinys):
//                 skaičiai rodomi kaip visos įmonės, ne LEZ padalinio;
//   'neaiškus'  – kelios ar nė vienos įmonės – skaičiai nepriskiriami, rodomi kandidatai.
//
// Paleidimas: npm run fetch:companies  (reikia `unzip`)

import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = new URL('../src/data/lez_companies.json', import.meta.url)
const SPINTA = 'https://get.data.gov.lt'
const UA = { 'User-Agent': 'safe-link (FEZ Resilience OS)' }

// --- Sodra: naujausias kiekvieno draudėjo mėnuo ---
async function loadSodra() {
  const year = new Date().getFullYear()
  const dir = await mkdtemp(join(tmpdir(), 'sodra-'))
  for (const y of [year, year - 1]) {
    const url = `https://atvira.sodra.lt/imones/downloads/${y}/monthly-${y}.csv.zip`
    const res = await fetch(url, { headers: UA })
    if (!res.ok) continue
    const zip = join(dir, `monthly-${y}.csv.zip`)
    await writeFile(zip, Buffer.from(await res.arrayBuffer()))
    const csv = execFileSync('unzip', ['-p', zip], { maxBuffer: 1 << 30 }).toString('utf8').replace(/^﻿/, '')
    const [header, ...lines] = csv.split(/\r?\n/)
    const cols = header.split(';').map((h) => h.match(/\((\w+)\)\s*$/)?.[1] ?? h)
    const latest = new Map()
    for (const line of lines) {
      if (!line) continue
      // Laukai atskirti „;“, tekstas kabutėse (be „;“ viduje).
      const v = line.split(';').map((x) => x.replace(/^"|"$/g, '').replaceAll('""', '"'))
      const row = Object.fromEntries(cols.map((c, i) => [c, v[i]]))
      if (!row.jarCode) continue
      const prev = latest.get(row.jarCode)
      if (!prev || row.month > prev.month) latest.set(row.jarCode, row)
    }
    return { rows: [...latest.values()], source: url }
  }
  throw new Error('Sodros duomenų nepavyko atsisiųsti')
}

const LEGAL_FORMS = [
  'UŽDAROJI AKCINĖ BENDROVĖ',
  'AKCINĖ BENDROVĖ',
  'MAŽOJI BENDRIJA',
  'VIEŠOJI ĮSTAIGA',
  'IND. ĮMONĖ',
  'UAB',
  'AB',
  'MB',
  'VŠĮ',
]
function normalize(name) {
  let s = ` ${String(name).toUpperCase()} `
  for (const f of LEGAL_FORMS) s = s.replaceAll(` ${f} `, ' ')
  return s
    .replace(/[„“"'”«».,()\-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const isKlaipeda = (row) => /klaipėd/i.test(row.municipality ?? '')

function match(osmName, rows) {
  const m = matchName(osmName, rows)
  if (m.candidates.length || !/ - |klaipėd/i.test(osmName)) return m
  // „Raben Lietuva - Klaipėda“ – registre vietovės pavadinime nėra; bandom be jos.
  const base = osmName.split(' - ')[0].replace(/\bklaipėd\p{L}*/giu, '').trim()
  return base && base !== osmName ? matchName(base, rows) : m
}

function matchName(osmName, rows) {
  const n = normalize(osmName)
  const words = n.split(' ').filter((w) => w.length > 1)
  const exact = rows.filter((r) => normalize(r.name) === n)
  const contains = rows.filter((r) => {
    const rn = ` ${normalize(r.name)} `
    return words.every((w) => rn.includes(` ${w} `))
  })
  const kExact = exact.filter(isKlaipeda)
  const kContains = contains.filter(isKlaipeda)
  if (kExact.length === 1) return { confidence: 'tikslus', row: kExact[0], candidates: contains }
  if (kContains.length === 1) return { confidence: 'tikėtinas', row: kContains[0], candidates: contains }
  if (!kContains.length && contains.length === 1) return { confidence: 'kitur', row: contains[0], candidates: contains }
  return { confidence: 'neaiškus', row: null, candidates: contains }
}

// --- JAR: naujausios metinės pardavimo pajamos ---
async function spinta(path, params) {
  const url = `${SPINTA}/${path}?${params}`
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: UA })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json())._data
    } catch (err) {
      if (attempt >= 3) throw err
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
}
async function revenue(code) {
  const [ja] = await spinta('datasets/gov/rc/jar/iregistruoti/JuridinisAsmuo', `ja_kodas=${code}`)
  if (!ja) return null
  const rows = await spinta(
    'datasets/gov/rc/jar/pelno_ataskaitos/PelnoAtaskaita',
    `juridinis_asmuo._id=${encodeURIComponent(`"${ja._id}"`)}&line_name=${encodeURIComponent('"PARDAVIMO PAJAMOS"')}`,
  )
  const latest = rows.sort((a, b) => b.laikotarpis_iki.localeCompare(a.laikotarpis_iki))[0]
  if (!latest) return null
  return {
    revenue_eur: latest.reiksme,
    period_from: latest.laikotarpis_nuo,
    period_to: latest.laikotarpis_iki,
    statement: latest.standard_name,
    registered: latest.reg_date,
  }
}

// ---------------------------------------------------------------------------------------------
const buildings = JSON.parse(await readFile(new URL('../src/data/lez_buildings.json', import.meta.url)))
// Tik įmonės: bankomatai, pastotės ir pan. – ne darbdaviai.
const isCompany = (o) => o.name && !o.power && o.amenity !== 'atm'
const names = [...new Set(buildings.features.flatMap((f) => f.properties._osm.filter(isCompany).map((o) => o.name)))].sort()
const sodra = await loadSodra()
console.log(`Sodra: ${sodra.rows.length} draudėjų (${sodra.source})`)

const companies = {}
const pick = (r) => ({
  code: r.jarCode,
  name: r.name,
  municipality: r.municipality,
  evrk: r.ecoActCodeStr || null,
  activity: r.ecoActName || null,
  month: r.month,
  employees: r.numInsured === '' ? null : Number(r.numInsured),
  avg_wage_eur: r.avgWage === '' ? null : Number(r.avgWage),
})
for (const name of names) {
  const m = match(name, sodra.rows)
  const entry = {
    confidence: m.confidence,
    sodra: m.row ? pick(m.row) : null,
    finance: null,
    candidates: m.candidates.slice(0, 5).map(pick),
  }
  if (m.row) entry.finance = await revenue(m.row.jarCode)
  companies[name] = entry
  const s = entry.sodra
  console.log(
    `${m.confidence.padEnd(9)} ${name} → ${s ? `${s.name} (${s.code}, ${s.municipality}) ${s.employees} darb.` : `${m.candidates.length} kandidatų`}` +
      (entry.finance ? `, pajamos ${entry.finance.period_to.slice(0, 4)}: ${entry.finance.revenue_eur} €` : ''),
  )
}

await writeFile(
  OUT,
  JSON.stringify(
    {
      metadata: {
        fetched_at: new Date().toISOString(),
        sources: {
          employees: sodra.source,
          registry: `${SPINTA}/datasets/gov/rc/jar/iregistruoti/JuridinisAsmuo`,
          finance: `${SPINTA}/datasets/gov/rc/jar/pelno_ataskaitos/PelnoAtaskaita`,
        },
        note: 'Figures are for the whole company (not only its FEZ site). Matched by name and Klaipėda municipality.',
      },
      companies,
    },
    null,
    1,
  ),
)
