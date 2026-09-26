import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ROWS, WEATHER_VARS, binned, buildDays, correlation, loadWeather, type Row, type WeatherFile, type WeatherVar } from '../stats/correlation'
import type { PagdRecord } from '../stats/model'

// Correlation: daily incidents vs daily weather. Diverging colour – blue negative, orange positive,
// grey midpoint; cells that are not significant (p ≥ 0.05) stay neutral.

const NEG = [57, 135, 229] // #3987e5
const POS = [224, 112, 47] // #e0702f
const MID = [51, 65, 85] // #334155
const NONE = '#1e293b'
const SERIES = '#3987e5'
// |r| at which the colour is fully saturated.
const R_FULL = 0.4

const mix = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(', ')})`
const cellColor = (r: number, significant: boolean) => (significant ? mix(MID, r < 0 ? NEG : POS, Math.min(1, Math.abs(r) / R_FULL)) : NONE)
const fmtR = (r: number) => (Math.abs(r) < 0.005 ? '0.00' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}`)

const card = 'rounded-md border border-slate-700 bg-panel/80 p-3'
const h2 = 'text-sm font-semibold text-slate-100'

interface Props {
  records: PagdRecord[]
  from: string
  to: string
  onHover: (t: { x: number; y: number; text: string } | null) => void
}

export default function CorrelationView({ records, from, to, onHover }: Props) {
  const [weather, setWeather] = useState<WeatherFile | null | undefined>(undefined)
  const [pick, setPick] = useState<{ row: Row; v: WeatherVar } | null>(null)

  useEffect(() => {
    loadWeather().then(setWeather)
  }, [])
  const days = useMemo(() => (weather ? buildDays(weather, records, from, to) : []), [weather, records, from, to])
  const cells = useMemo(
    () => Object.fromEntries(ROWS.map((row) => [row, Object.fromEntries(WEATHER_VARS.map((w) => [w.id, correlation(days, row, w.id)]))])),
    [days],
  ) as Record<Row, Record<WeatherVar, ReturnType<typeof correlation>>>

  if (weather === null) {
    return (
      <div className="rounded-md border border-slate-700 bg-panel/80 p-4 text-sm text-slate-400">
        No weather data yet – run <code className="text-slate-300">npm run fetch:weather</code>.
      </div>
    )
  }
  if (!weather) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-slate-400">
        <Loader2 size={16} className="animate-spin" /> Loading weather observations…
      </div>
    )
  }

  // Default: the strongest significant relationship for a specific category.
  const strongest = ROWS.filter((r) => r !== 'All incidents')
    .flatMap((row) => WEATHER_VARS.map((w) => ({ row, v: w.id, c: cells[row][w.id] })))
    .filter((x) => x.c.significant)
    .sort((a, b) => Math.abs(b.c.r) - Math.abs(a.c.r))[0]
  const sel = pick ?? (strongest ? { row: strongest.row, v: strongest.v } : { row: 'All incidents' as Row, v: 'gustMax' as WeatherVar })
  const selVar = WEATHER_VARS.find((w) => w.id === sel.v)!
  const selCell = cells[sel.row][sel.v]
  const bins = binned(days, sel.row, sel.v)
  const binMax = Math.max(0.01, ...bins.map((b) => b.perDay))

  return (
    <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
      <section className={card}>
        <div className="flex items-baseline gap-2 pb-3">
          <h2 className={`${h2} flex-1`}>Incidents × weather</h2>
          <span className="text-[11px] text-slate-400">
            Pearson r · {days.length} days · {weather.metadata.station_name}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-separate border-spacing-[3px] text-sm">
            <thead>
              <tr>
                <th />
                {WEATHER_VARS.map((w) => (
                  <th key={w.id} className="px-1 pb-1 text-center text-xs font-normal leading-tight text-slate-400">
                    {w.label}
                    <div className="text-[10px] text-slate-500">{w.unit}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row}>
                  <td className={`whitespace-nowrap pr-2 text-xs ${row === 'All incidents' ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>{row}</td>
                  {WEATHER_VARS.map((w) => {
                    const c = cells[row][w.id]
                    const active = sel.row === row && sel.v === w.id
                    return (
                      <td key={w.id} className="p-0">
                        <button
                          onClick={() => setPick({ row, v: w.id })}
                          onMouseMove={(e) =>
                            onHover({
                              x: e.clientX,
                              y: e.clientY,
                              text: `${row} × ${w.label}: r = ${fmtR(c.r)}${c.significant ? '' : ' (not significant)'}, ${c.n} days`,
                            })
                          }
                          onMouseLeave={() => onHover(null)}
                          className={`h-9 w-full rounded text-xs tabular-nums ${active ? 'ring-2 ring-slate-100' : 'hover:ring-1 hover:ring-slate-400'} ${c.significant ? 'text-white' : 'text-slate-500'}`}
                          style={{ background: cellColor(c.r, c.significant) }}
                        >
                          {fmtR(c.r)}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            −{R_FULL}
            <span className="h-2 w-24 rounded-sm" style={{ background: `linear-gradient(90deg, ${mix(MID, NEG, 1)}, ${mix(MID, MID, 0)}, ${mix(MID, POS, 1)})` }} />+{R_FULL}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm border border-slate-600" style={{ background: NONE }} /> not significant (p ≥ 0.05)
          </span>
          <span>association, not cause</span>
        </div>
      </section>

      <section className={card}>
        <div className="pb-3">
          <h2 className={h2}>
            {sel.row} × {selVar.label}
          </h2>
          <div className="text-[11px] text-slate-400">
            Incidents per day by {selVar.label.toLowerCase()} ({selVar.unit}) · r = {fmtR(selCell.r)}
            {selCell.significant ? '' : ' · not significant'} · grey bar = under 10 days
          </div>
        </div>
        <div className="flex h-48 items-end gap-2">
          {bins.map((b) => (
            <div
              key={b.label}
              className="flex h-full flex-1 flex-col items-center justify-end"
              onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY, text: `${selVar.label} ${b.label} ${selVar.unit}: ${b.perDay.toFixed(2)} per day over ${b.days} days` })}
              onMouseLeave={() => onHover(null)}
            >
              <span className="pb-1 text-xs tabular-nums text-slate-200">{b.days ? b.perDay.toFixed(2) : '—'}</span>
              <span
                className="w-full max-w-14 rounded-t-[4px]"
                style={{ height: `${(100 * b.perDay) / binMax}%`, minHeight: b.days ? 2 : 0, background: b.days < 10 ? '#475569' : SERIES }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-2 border-t border-slate-600 pt-1">
          {bins.map((b) => (
            <div key={b.label} className="flex-1 text-center leading-tight">
              <div className="text-[11px] text-slate-300">{b.label}</div>
              <div className="text-[10px] text-slate-500">{b.days} d</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
