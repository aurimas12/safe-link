import { CATEGORIES, categoryOf, type Category, type PagdRecord } from './model'

// Correlation between daily incident counts (PAGD, Klaipėda city) and daily weather (LHMT, Klaipėdos AMS).
// Hourly observations are original; daily values are computed here per Lithuanian calendar day.
// Correlation shows association only – not a cause.

interface Observation {
  observationTimeUtc: string
  airTemperature: number | null
  windSpeed: number | null
  windGust: number | null
  precipitation: number | null
  relativeHumidity: number | null
  snowDepth: number | null
}
export interface WeatherFile {
  metadata: { station_name: string; from: string; to: string; fetched_at: string; missing_days: string[] }
  observations: Observation[]
}

// Optional file (npm run fetch:weather): glob resolves to nothing if it does not exist yet, so the app still builds.
const weatherFiles = import.meta.glob<string>('../data/weather_klaipeda.json', { query: '?url', import: 'default' })
let weatherPromise: Promise<WeatherFile | null> | null = null
export const loadWeather = () =>
  (weatherPromise ??= (async () => {
    const load = Object.values(weatherFiles)[0]
    if (!load) return null
    return (await fetch(await load())).json() as Promise<WeatherFile>
  })())

export type WeatherVar = 'gustMax' | 'precip' | 'tMean' | 'tMin' | 'humidity'
export const WEATHER_VARS: { id: WeatherVar; label: string; unit: string; bins: number[] }[] = [
  { id: 'gustMax', label: 'Max wind gust', unit: 'm/s', bins: [5, 10, 15, 20] },
  { id: 'precip', label: 'Precipitation', unit: 'mm', bins: [0.1, 1, 5, 10] },
  { id: 'tMean', label: 'Mean temperature', unit: '°C', bins: [0, 5, 10, 15, 20] },
  { id: 'tMin', label: 'Min temperature', unit: '°C', bins: [-5, 0, 5, 10] },
  { id: 'humidity', label: 'Mean humidity', unit: '%', bins: [70, 80, 90] },
]
export type Row = Category | 'All incidents'
export const ROWS: Row[] = ['All incidents', ...CATEGORIES]

export interface Day {
  date: string
  weather: Record<WeatherVar, number>
  counts: Record<Row, number>
}

// A day needs most of its hourly observations to be summarised honestly.
const MIN_HOURS = 20
const localDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' })

const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length

export function buildDays(weather: WeatherFile, records: PagdRecord[], from: string, to: string): Day[] {
  const hours = new Map<string, Observation[]>()
  for (const o of weather.observations) {
    const d = localDay.format(new Date(`${o.observationTimeUtc.replace(' ', 'T')}Z`))
    if (!hours.has(d)) hours.set(d, [])
    hours.get(d)!.push(o)
  }
  const counts = new Map<string, Record<Row, number>>()
  for (const r of records) {
    const d = r.korteles_data
    if (!counts.has(d)) counts.set(d, Object.fromEntries(ROWS.map((row) => [row, 0])) as Record<Row, number>)
    const c = counts.get(d)!
    c['All incidents']++
    c[categoryOf(r)]++
  }
  const days: Day[] = []
  for (const [date, obs] of hours) {
    if (date < from || date > to || obs.length < MIN_HOURS) continue
    const vals = (k: keyof Observation) => obs.map((o) => o[k]).filter((v): v is number => typeof v === 'number')
    const t = vals('airTemperature')
    const g = vals('windGust')
    const p = vals('precipitation')
    const h = vals('relativeHumidity')
    if (!t.length || !g.length || !p.length || !h.length) continue
    days.push({
      date,
      weather: { gustMax: Math.max(...g), precip: p.reduce((a, x) => a + x, 0), tMean: mean(t), tMin: Math.min(...t), humidity: mean(h) },
      counts: counts.get(date) ?? (Object.fromEntries(ROWS.map((row) => [row, 0])) as Record<Row, number>),
    })
  }
  return days.sort((a, b) => a.date.localeCompare(b.date))
}

export interface Cell {
  r: number
  n: number
  significant: boolean
}

// Pearson r with a two-sided test at p < 0.05 (t distribution; n is large, so the critical t ≈ 1.97).
export function correlation(days: Day[], row: Row, v: WeatherVar): Cell {
  const x = days.map((d) => d.weather[v])
  const y = days.map((d) => d.counts[row])
  const n = x.length
  const mx = mean(x)
  const my = mean(y)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0
  const t = Math.abs(r) < 1 ? r * Math.sqrt((n - 2) / (1 - r * r)) : Infinity
  return { r, n, significant: n > 10 && Math.abs(t) > 1.97 }
}

export interface Bin {
  label: string
  days: number
  perDay: number
}

// Average incidents per day in weather bands – the readable form of a correlation.
export function binned(days: Day[], row: Row, v: WeatherVar): Bin[] {
  const def = WEATHER_VARS.find((w) => w.id === v)!
  const edges = def.bins
  const fmt = (x: number) => String(x)
  const labels = [
    `< ${fmt(edges[0])}`,
    ...edges.slice(1).map((e, i) => `${fmt(edges[i])}–${fmt(e)}`),
    `≥ ${fmt(edges.at(-1)!)}`,
  ]
  const groups = labels.map(() => [] as number[])
  for (const d of days) {
    const val = d.weather[v]
    let i = edges.findIndex((e) => val < e)
    if (i === -1) i = edges.length
    groups[i].push(d.counts[row])
  }
  return labels.map((label, i) => ({ label, days: groups[i].length, perDay: groups[i].length ? mean(groups[i]) : 0 }))
}
