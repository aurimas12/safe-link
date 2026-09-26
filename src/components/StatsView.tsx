import { ArrowDown, ArrowUp, CarFront, CircleHelp, CloudLightning, Flame, Loader2, Map as MapIcon, Search, X, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { formatEur } from '../map/buildings'
import type { Graph } from '../map/graph'
import { formatMetric, metricLabel, metricValue, zoneSwatch, type Zone, type ZoneMetric } from '../map/zones'
import {
  CATEGORIES,
  KV_FEATURES,
  categoryOf,
  causeEn,
  criticalNodes,
  kvReasonEn,
  kvStats,
  loadPagd,
  materialEn,
  pagdStats,
  placeEn,
  type Category,
  type PagdFile,
} from '../stats/model'
import CorrelationView from './CorrelationView'
import ZoneMetricSelect from './ZoneMetricSelect'

// Incident statistics view – the four questions from the brief:
// 1 most frequent problems · 2 correlation (when) · 3 recorded causes · 4 importance.
// Colours: one series colour (dark categorical slot 1) and one validated sequential blue ramp for the heatmap.

const SERIES = '#3987e5'
const MUTED = '#475569'
// Harm bars: a second, warm series colour so "how harmful" is not read as "how often".
const HARM = '#e0702f'
// Sequential ramp (dark surface, validated ordinal): low → high.
const RAMP = ['#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#b7d3f6']
const CATEGORY_ICON: Record<Category, LucideIcon> = {
  Fire: Flame,
  'Traffic accident': CarFront,
  'Natural hazard': CloudLightning,
  'Under investigation': Search,
  'Other / not specified': CircleHelp,
}
const EMPTY_CELL = '#1e293b'

interface Tip {
  x: number
  y: number
  text: string
}

const card = 'rounded-md border border-slate-700 bg-panel/80 p-3'
const h2 = 'text-sm font-semibold text-slate-100'
const sub = 'text-xs text-slate-400'

function Bars({
  rows,
  onHover,
  onClick,
  selected,
  muted = [],
  compact = false,
}: {
  compact?: boolean
  rows: [string, number][]
  onHover: (t: Tip | null) => void
  onClick?: (label: string) => void
  selected?: string | null
  muted?: string[]
}) {
  const max = Math.max(1, ...rows.map((r) => r[1]))
  return (
    <ul className="space-y-1.5">
      {rows.map(([label, n]) => (
        <li key={label}>
          <button
            type="button"
            disabled={!onClick}
            onClick={() => onClick?.(label)}
            onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY, text: `${label}: ${n}` })}
            onMouseLeave={() => onHover(null)}
            className={`grid w-full ${compact ? 'grid-cols-[minmax(0,9.5rem)_1fr_2rem]' : 'grid-cols-[minmax(0,12.5rem)_1fr_2.5rem]'} items-center gap-2 rounded px-1 py-0.5 text-left text-sm ${onClick ? 'hover:bg-slate-700/40' : 'cursor-default'} ${selected === label ? 'bg-slate-700/60' : ''}`}
          >
            <span className="truncate text-slate-200">{label}</span>
            <span className="h-3 rounded-r-[4px] bg-slate-800/60">
              <span
                className="block h-3 rounded-r-[4px]"
                style={{ width: `${(100 * n) / max}%`, background: muted.includes(label) ? MUTED : SERIES }}
              />
            </span>
            <span className="text-right tabular-nums text-slate-200">{n}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}


// --- table helpers: sortable headers and compact filters ---------------------------------

type Dir = 'asc' | 'desc'
interface SortState<K extends string> {
  key: K
  dir: Dir
}
const nextSort = <K extends string>(s: SortState<K>, key: K, first: Dir = 'desc'): SortState<K> =>
  s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: first }
const byKey = <T,>(rows: T[], value: (t: T) => number | string, dir: Dir) =>
  [...rows].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return dir === 'asc' ? c : -c
  })

function Th<K extends string>({
  k,
  sort,
  onSort,
  children,
  right,
  first,
}: {
  k: K
  sort: SortState<K>
  onSort: (s: SortState<K>) => void
  children: ReactNode
  right?: boolean
  first?: Dir
}) {
  const active = sort.key === k
  return (
    <th className={`py-1 pr-2 font-normal last:pr-0 ${right ? 'text-right' : ''}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        onClick={() => onSort(nextSort(sort, k, first))}
        className={`inline-flex items-center gap-0.5 hover:text-slate-100 ${active ? 'text-slate-100' : ''}`}
      >
        {children}
        {active && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  )
}

function Segmented<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex overflow-hidden rounded border border-slate-600 text-xs">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={value === v ? 'bg-status-action px-2 py-0.5 text-white' : 'px-2 py-0.5 text-slate-300 hover:bg-slate-700/60'}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1 text-xs text-slate-400">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[12rem] rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-100"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// '2026-03' → 'Mar' (or 'Mar 2026' with the year).
const monthName = (ym: string, year = false) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}${year ? ` ${ym.slice(0, 4)}` : ''}`

const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b))
const thead = 'sticky top-0 z-[1] bg-panel text-left text-xs text-slate-400'
const td = 'py-1 pr-2 last:pr-0'
const tdNum = 'py-1 pr-2 text-right tabular-nums last:pr-0'
const ROW_LIMIT = 100
const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Vilnius' }).slice(0, 16) : '—')

// Zone table header: sorting by a column also colours the map zones by that metric.
function ZoneTh({ m, active, onPick, children }: { m: ZoneMetric; active: ZoneMetric; onPick: (m: ZoneMetric) => void; children: ReactNode }) {
  return (
    <th className="py-1 pr-2 text-right font-normal last:pr-0" aria-sort={active === m ? 'descending' : 'none'}>
      <button
        onClick={() => onPick(m)}
        title={`Colour the map zones by: ${metricLabel(m)}`}
        className={`inline-flex items-center gap-0.5 hover:text-slate-100 ${active === m ? 'text-slate-100' : ''}`}
      >
        {children}
        {active === m && <ArrowDown size={11} />}
      </button>
    </th>
  )
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-md border border-slate-700 bg-panel/80 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {note && <div className="text-xs text-slate-400">{note}</div>}
    </div>
  )
}

type Tab = 'overview' | 'correlation' | 'causes' | 'importance' | 'zones' | 'investigation'
type NodeKey = 'name' | 'zone' | 'lez' | 'other' | 'employees' | 'perHour'
type DrillKey = 'date' | 'cause' | 'material' | 'place' | 'harm'
type WaterKey = 'date' | 'type' | 'reason' | 'place' | 'zone' | 'customers' | 'hours'

interface Props {
  graph: Graph | null
  zones: Zone[]
  zoneMetric: ZoneMetric
  onZoneMetric: (m: ZoneMetric) => void
  onShowZones: () => void
  onClose: () => void
}

export default function StatsView({ graph, zones, zoneMetric, onZoneMetric, onShowZones, onClose }: Props) {
  const [file, setFile] = useState<PagdFile | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const [axis, setAxis] = useState<'month' | 'hour'>('month')
  const [selected, setSelected] = useState<Category | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  // Table filters and sorting.
  const [nodeType, setNodeType] = useState<'all' | 'Substation' | 'Switching station'>('all')
  const [nodeZone, setNodeZone] = useState('')
  const [nodeSort, setNodeSort] = useState<SortState<NodeKey>>({ key: 'perHour', dir: 'desc' })
  const [nodesAll, setNodesAll] = useState(false)
  const [drillFilter, setDrillFilter] = useState({ month: '', cause: '', place: '', harmed: false })
  const [drillSort, setDrillSort] = useState<SortState<DrillKey>>({ key: 'date', dir: 'desc' })
  const [waterFilter, setWaterFilter] = useState({ type: '', reason: '', zone: '' })
  const [waterSort, setWaterSort] = useState<SortState<WaterKey>>({ key: 'date', dir: 'desc' })

  useEffect(() => {
    loadPagd().then(setFile)
  }, [])
  const stats = useMemo(() => (file ? pagdStats(file.records) : null), [file])
  const waterStats = useMemo(() => kvStats(), [])
  const critical = useMemo(() => (graph ? criticalNodes(graph) : null), [graph])
  // Which supply zone (110 kV substation) each node / water record belongs to.
  const zoneOfNode = useMemo(() => {
    const m = new Map<string, string>()
    if (!graph) return m
    const zoneName = new Map(zones.map((z) => [z.id, z.name]))
    for (const n of graph.file.nodes) {
      if (zoneName.has(n.id)) {
        m.set(n.id, zoneName.get(n.id)!)
        continue
      }
      const b = n.affects?.find((id) => graph.file.buildings[id]?.power)
      const root = b ? graph.file.buildings[b].power!.chain.at(-1) : undefined
      if (root && zoneName.has(root)) m.set(n.id, zoneName.get(root)!)
    }
    return m
  }, [graph, zones])
  const waterRows = useMemo(() => {
    const zoneOf = new Map<number, string>()
    for (const z of zones) for (const id of z.water.ids) if (!zoneOf.has(id)) zoneOf.set(id, z.name)
    return KV_FEATURES.map((f) => {
      const p = f.properties
      return {
        id: p.OBJECTID,
        date: p.pranesimo_datetime ?? 0,
        type: p.ivykio_tipas === 'Planinis' ? 'Planned' : p.ivykio_tipas === 'Neplaninis' ? 'Unplanned' : (p.ivykio_tipas ?? '—'),
        reason: kvReasonEn(p.pranesimo_tipas),
        place: p.miestas ?? '—',
        zone: zoneOf.get(p.OBJECTID) ?? 'Outside zones',
        customers: p.vartotoju_skaicius ?? 0,
        hours: p.likvidavimo_data && p.pranesimo_datetime ? (p.likvidavimo_data - p.pranesimo_datetime) / 3600000 : -1,
        text: p.pranesimo_turinys ?? '',
      }
    })
  }, [zones])

  if (!file || !stats) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-slate-300">
        <Loader2 size={16} className="animate-spin" /> Loading incident statistics…
      </div>
    )
  }

  const byCat = Object.fromEntries(stats.byCategory.map((c) => [c.category, c]))
  const grid = axis === 'month' ? stats.monthGrid : stats.hourGrid
  const columns = axis === 'month' ? stats.months : Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
  const gridMax = Math.max(1, ...CATEGORIES.flatMap((c) => grid[c]))
  const cellColor = (n: number) => (n === 0 ? EMPTY_CELL : RAMP[Math.min(RAMP.length - 1, Math.floor((n / gridMax) * RAMP.length))])

  // Importance: how often × how harmful, sorted by people killed or injured (then by frequency).
  const risk = stats.byCategory
    .map((c) => ({ ...c, rate: (100 * c.harmed) / Math.max(1, c.count) }))
    .sort((a, b) => b.harmed - a.harmed || b.count - a.count)
  const maxCount = Math.max(1, ...risk.map((m) => m.count))
  const maxRate = Math.max(1, ...risk.map((m) => m.rate))

  const drillAll = selected ? file.records.filter((r) => categoryOf(r) === selected) : file.records
  const drill = byKey(
    drillAll.filter(
      (r) =>
        (!drillFilter.month || r.korteles_data.startsWith(drillFilter.month)) &&
        (!drillFilter.cause || causeEn(r.ivykio_priezastis) === drillFilter.cause) &&
        (!drillFilter.place || placeEn(r.ivykio_vieta) === drillFilter.place) &&
        (!drillFilter.harmed || (r.zuvo_zmoniu ?? 0) + (r.traumuota_zmoniu ?? 0) > 0),
    ),
    (r) =>
      drillSort.key === 'date'
        ? `${r.korteles_data} ${r.iskvietimo_laikas ?? ''}`
        : drillSort.key === 'cause'
          ? causeEn(r.ivykio_priezastis)
          : drillSort.key === 'material'
            ? materialEn(r.ivykio_medziaga)
            : drillSort.key === 'place'
              ? placeEn(r.ivykio_vieta)
              : (r.zuvo_zmoniu ?? 0) * 1000 + (r.traumuota_zmoniu ?? 0),
    drillSort.dir,
  )
  const selectCategory = (c: Category) => {
    setSelected(c)
    setDrillFilter({ month: '', cause: '', place: '', harmed: false })
    setTab('investigation')
  }

  const nodes = critical
    ? byKey(
        critical.filter((n) => (nodeType === 'all' || n.kind === nodeType) && (!nodeZone || zoneOfNode.get(n.id) === nodeZone)),
        (n) =>
          nodeSort.key === 'name'
            ? n.name
            : nodeSort.key === 'zone'
              ? (zoneOfNode.get(n.id) ?? '')
              : nodeSort.key === 'lez'
                ? n.summary.lez
                : nodeSort.key === 'other'
                  ? n.summary.other
                  : nodeSort.key === 'employees'
                    ? n.summary.employees
                    : n.summary.perHour,
        nodeSort.dir,
      )
    : []

  const water = byKey(
    waterRows.filter(
      (w) =>
        (!waterFilter.type || w.type === waterFilter.type) &&
        (!waterFilter.reason || w.reason === waterFilter.reason) &&
        (!waterFilter.zone || w.zone === waterFilter.zone),
    ),
    (w) => w[waterSort.key],
    waterSort.dir,
  )

  const zoneMax = Math.max(0, ...zones.map((z) => metricValue(z, zoneMetric)))
  const zoneRows = [...zones].sort((a, b) => metricValue(b, zoneMetric) - metricValue(a, zoneMetric))

  const TABS: [Tab, string][] = [
    ['overview', 'Overview'],
    ['correlation', 'Correlation'],
    ['causes', 'Causes'],
    ['importance', 'Importance'],
    ['zones', 'Supply zones'],
    ['investigation', 'Investigation'],
  ]

  return (
    <div className="h-full overflow-y-auto px-3 pb-6 pt-16 text-slate-200">
      <div className="mx-auto max-w-6xl space-y-3">
        <header className="flex items-start gap-3">
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Incident statistics · Klaipėda city</h1>
            <p className={sub}>
              {monthName(stats.months[0], true)} – {monthName(file.metadata.data_to.slice(0, 7), true)}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-700/60 hover:text-slate-100" title="Back to map">
            <X size={18} />
          </button>
        </header>

        <nav className="flex gap-1 border-b border-slate-700">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === id ? 'border-status-action text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === 'overview' && (
          <>
        {/* Summary */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Tile label="Incidents" value={stats.total} note="12 months" />
          <Tile label="Fires" value={byCat['Fire'].count} note="recorded cause / material" />
          <Tile label="Traffic accidents" value={byCat['Traffic accident'].count} note="most harmful per call" />
          <Tile label="Natural hazards" value={byCat['Natural hazard'].count} note="flood, storm" />
          <Tile label="Killed · injured" value={`${stats.deaths} · ${stats.injured}`} note={`${stats.rescued} rescued`} />
          <Tile label="Median duration" value={stats.medianMinutes != null ? `${Math.round(stats.medianMinutes)} min` : '—'} note={`call → cleared, n = ${stats.minutesN}`} />
        </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <section className={card}>
                <h2 className={`${h2} pb-2`}>Most frequent problems</h2>
            <Bars
              rows={stats.byCategory.map((c) => [c.category, c.count])}
              muted={['Other / not specified']}
              selected={selected}
              onClick={(l) => selectCategory(l as Category)}
              onHover={setTip}
            />
              </section>
              <section className={card}>
                <div className="flex items-center gap-2 pb-2">
                  <h2 className={`${h2} flex-1`}>When they happen</h2>
              <div className="flex overflow-hidden rounded border border-slate-600 text-xs">
                {(['month', 'hour'] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => setAxis(a)}
                    className={axis === a ? 'bg-status-action px-2 py-0.5 text-white' : 'px-2 py-0.5 text-slate-300 hover:bg-slate-700/60'}
                  >
                    {a === 'month' ? 'Month' : 'Hour of day'}
                  </button>
                ))}
              </div>
                </div>
            <div className="overflow-x-auto pt-2">
              <div className="grid min-w-[28rem] gap-[2px]" style={{ gridTemplateColumns: `8.5rem repeat(${columns.length}, minmax(0, 1fr))` }}>
                {CATEGORIES.map((c) => (
                  <div key={c} className="contents">
                    <div className="truncate pr-1 text-xs text-slate-300">{c}</div>
                    {grid[c].map((n, i) => (
                      <div
                        key={i}
                        className="h-5 rounded-[2px]"
                        style={{ background: cellColor(n) }}
                        onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${c} · ${axis === 'month' ? monthName(columns[i], true) : `${columns[i]}:00`}: ${n}` })}
                        onMouseLeave={() => setTip(null)}
                      />
                    ))}
                  </div>
                ))}
                <div />
                {columns.map((col, i) => (
                  <div key={col} className="whitespace-nowrap text-center text-[10px] leading-tight text-slate-500">
                    {axis === 'month' ? (
                      <>
                        {monthName(col)}
                        {(i === 0 || col.endsWith('-01')) && <div className="text-slate-600">{col.slice(0, 4)}</div>}
                      </>
                    ) : i % 3 === 0 ? (
                      col
                    ) : (
                      ''
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 pt-2 text-[11px] text-slate-400">
              0
              <span className="inline-block h-2 w-4 rounded-sm" style={{ background: EMPTY_CELL }} />
              {RAMP.map((c) => (
                <span key={c} className="inline-block h-2 w-4 rounded-sm" style={{ background: c }} />
              ))}
              {gridMax}
            </div>
              </section>
            </div>
          </>
        )}

        {tab === 'correlation' && (
          <CorrelationView records={file.records} from={file.metadata.data_from} to={file.metadata.data_to} onHover={setTip} />
        )}

        {tab === 'causes' && (
          <div className="grid gap-3 lg:grid-cols-3">
            <section className={card}>
              <h2 className={`${h2} pb-2`}>Fires by recorded cause</h2>
              <Bars rows={stats.fireCauses.slice(0, 10)} onHover={setTip} compact />
            </section>
            <section className={card}>
              <h2 className={`${h2} pb-2`}>Fires by burning material</h2>
              <Bars rows={stats.fireMaterials.slice(0, 10)} onHover={setTip} compact />
            </section>
            <section className={card}>
              <h2 className={`${h2} pb-2`}>Water supply interruptions</h2>
              <Bars
                compact
                rows={waterStats.reasons}
                onHover={setTip}
                selected={waterFilter.reason || null}
                onClick={(l) => {
                  setWaterFilter((f) => ({ ...f, reason: l }))
                  setTab('investigation')
                }}
              />
              <div className="grid grid-cols-3 gap-2 pt-3 text-center">
                <div>
                  <div className="text-lg font-semibold tabular-nums">{waterStats.unplanned}</div>
                  <div className="text-[11px] text-slate-400">unplanned</div>
                </div>
                <div>
                  <div className="text-lg font-semibold tabular-nums">{waterStats.customers.toLocaleString('en-GB')}</div>
                  <div className="text-[11px] text-slate-400">customers</div>
                </div>
                <div>
                  <div className="text-lg font-semibold tabular-nums">{waterStats.medianRestoreH != null ? `${waterStats.medianRestoreH.toFixed(1)} h` : '—'}</div>
                  <div className="text-[11px] text-slate-400">median restore</div>
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === 'importance' && (
          <div className="grid gap-3 lg:grid-cols-2">
            <section className={card}>
              <div className="flex items-baseline gap-2 pb-3">
                <h2 className={`${h2} flex-1`}>How often × how harmful</h2>
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <span className="h-2 w-3 rounded-sm" style={{ background: SERIES }} /> incidents
                </span>
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <span className="h-2 w-3 rounded-sm" style={{ background: HARM }} /> killed or injured per 100
                </span>
              </div>
              <ul className="space-y-2">
                {risk.map((m, i) => {
                  const Icon = CATEGORY_ICON[m.category]
                  const other = m.category === 'Other / not specified'
                  return (
                    <li key={m.category}>
                      <button
                        type="button"
                        onClick={() => selectCategory(m.category)}
                        onMouseMove={(e) =>
                          setTip({ x: e.clientX, y: e.clientY, text: `${m.category}: ${m.count} incidents, ${m.deaths} killed, ${m.injured} injured` })
                        }
                        onMouseLeave={() => setTip(null)}
                        className="flex w-full items-center gap-3 rounded-md border border-slate-700/70 bg-slate-900/30 px-3 py-2 text-left hover:border-slate-500 hover:bg-slate-800/50"
                      >
                        <span className="w-4 text-xs tabular-nums text-slate-500">{i + 1}</span>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800">
                          <Icon size={16} className={other ? 'text-slate-400' : 'text-slate-200'} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="truncate text-sm text-slate-100">{m.category}</span>
                            <span className="ml-auto text-sm tabular-nums text-slate-300">{m.count}</span>
                          </span>
                          <span className="mt-1 block h-1.5 rounded-r-[4px] bg-slate-800">
                            <span
                              className="block h-1.5 rounded-r-[4px]"
                              style={{ width: `${Math.max(1, (100 * m.count) / maxCount)}%`, background: other ? MUTED : SERIES }}
                            />
                          </span>
                        </span>
                        <span className="w-28 shrink-0 pl-2">
                          <span className="flex items-baseline justify-end gap-1">
                            <span className={`text-lg font-semibold tabular-nums ${m.rate > 0 ? 'text-slate-100' : 'text-slate-500'}`}>
                              {m.rate.toFixed(1)}
                            </span>
                            <span className="text-[11px] text-slate-500">/ 100</span>
                          </span>
                          <span className="mt-1 block h-1.5 rounded-r-[4px] bg-slate-800">
                            <span className="block h-1.5 rounded-r-[4px]" style={{ width: `${(100 * m.rate) / maxRate}%`, background: HARM }} />
                          </span>
                          <span className="block pt-0.5 text-right text-[11px] tabular-nums text-slate-400">
                            {m.deaths} killed · {m.injured} injured
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
            <section className={card}>
              <div className="flex flex-wrap items-center gap-2 pb-2">
                <h2 className={`${h2} flex-1`}>Critical network nodes</h2>
                <Segmented
                  options={[
                    ['all', 'All'],
                    ['Substation', 'Substations'],
                    ['Switching station', 'Switching st.'],
                  ]}
                  value={nodeType}
                  onChange={setNodeType}
                />
                <Select label="Zone" value={nodeZone} options={uniq([...zoneOfNode.values()])} onChange={setNodeZone} />
              </div>
              {critical ? (
                <>
                  <div className={nodesAll ? 'table-scroll max-h-96' : ''}>
                    <table className="w-full table-fixed text-sm">
                      <colgroup>
                        <col />
                        <col className="w-24" />
                        <col className="w-12" />
                        <col className="w-12" />
                        <col className="w-14" />
                        <col className="w-20" />
                      </colgroup>
                      <thead className={thead}>
                        <tr>
                          <Th k="name" sort={nodeSort} onSort={setNodeSort} first="asc">Node</Th>
                          <Th k="zone" sort={nodeSort} onSort={setNodeSort} first="asc">Zone</Th>
                          <Th k="lez" sort={nodeSort} onSort={setNodeSort} right>FEZ</Th>
                          <Th k="other" sort={nodeSort} onSort={setNodeSort} right>Other</Th>
                          <Th k="employees" sort={nodeSort} onSort={setNodeSort} right>Empl.</Th>
                          <Th k="perHour" sort={nodeSort} onSort={setNodeSort} right>€ / h</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {(nodesAll ? nodes : nodes.slice(0, 10)).map((n) => (
                          <tr key={n.id} className="border-t border-slate-700/60">
                            <td className={`${td} truncate`} title={`${n.name} · ${n.kind}`}>
                              {n.name} <span className="text-xs text-slate-500">{n.kind === 'Substation' ? '110 kV' : 'SP'}</span>
                            </td>
                            <td className={`${td} truncate text-xs text-slate-400`}>{zoneOfNode.get(n.id)?.replace(' 110 kV', '') ?? '—'}</td>
                            <td className={tdNum}>{n.summary.lez}</td>
                            <td className={tdNum}>{n.summary.other}</td>
                            <td className={tdNum}>{n.summary.employees || '—'}</td>
                            <td className={tdNum}>{n.summary.perHour ? formatEur(n.summary.perHour) : '—'}</td>
                          </tr>
                        ))}
                        {!nodes.length && (
                          <tr>
                            <td colSpan={6} className="py-2 text-center text-xs text-slate-500">No nodes match the filters.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {nodes.length > 10 && (
                    <button onClick={() => setNodesAll((v) => !v)} className="pt-1.5 text-xs text-sky-400 hover:underline">
                      {nodesAll ? 'Show top 10' : `Show all ${nodes.length}`}
                    </button>
                  )}
                </>
              ) : (
                <Loader2 size={16} className="animate-spin text-slate-400" />
              )}
            </section>
          </div>
        )}

        {tab === 'zones' && (
          <section className={card}>
            <div className="flex flex-wrap items-center gap-2 pb-2">
              <h2 className={`${h2} flex-1`}>Supply zones (110 kV)</h2>
            <div className="w-72">
              <ZoneMetricSelect value={zoneMetric} onChange={onZoneMetric} />
            </div>
            <button
              onClick={onShowZones}
              className="flex items-center gap-1.5 rounded bg-status-action px-2.5 py-1 text-xs text-white hover:brightness-110"
            >
              <MapIcon size={13} /> Show on map
            </button>
            </div>
          {zones.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className={thead}>
                  <tr>
                    <th className="py-1 pr-2 font-normal">Zone</th>
                    <ZoneTh m="buildings" active={zoneMetric} onPick={onZoneMetric}>Buildings</ZoneTh>
                    <ZoneTh m="employees" active={zoneMetric} onPick={onZoneMetric}>FEZ empl.</ZoneTh>
                    <ZoneTh m="perHour" active={zoneMetric} onPick={onZoneMetric}>FEZ € / h</ZoneTh>
                    <ZoneTh m="water" active={zoneMetric} onPick={onZoneMetric}>Water int.</ZoneTh>
                    <ZoneTh m="waterUnplanned" active={zoneMetric} onPick={onZoneMetric}>Unplanned</ZoneTh>
                    <ZoneTh m="customers" active={zoneMetric} onPick={onZoneMetric}>Customers</ZoneTh>
                  </tr>
                </thead>
                <tbody>
                  {zoneRows.map((z) => (
                    <tr key={z.id} className="border-t border-slate-700/60">
                      <td className={td}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: zoneSwatch(metricValue(z, zoneMetric), zoneMax), border: `1px solid ${metricValue(z, zoneMetric) > 0 ? '#93c5fd' : '#64748b'}` }} />
                          {z.name}
                        </span>
                      </td>
                      <td className={tdNum}>
                        {z.summary.lez + z.summary.other} <span className="text-xs text-slate-500">({z.summary.lez} FEZ)</span>
                      </td>
                      <td className={tdNum}>{z.summary.employees || '—'}</td>
                      <td className={tdNum}>{formatMetric(z.summary.perHour, 'perHour', formatEur)}</td>
                      <td className={tdNum}>{z.water.total}</td>
                      <td className={tdNum}>{z.water.unplanned}</td>
                      <td className={tdNum}>{z.water.customers.toLocaleString('en-GB')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Loader2 size={16} className="animate-spin text-slate-400" />
          )}
          </section>
        )}

        {tab === 'investigation' && (
          <>
            <section className={card}>
              <div className="flex flex-wrap items-center gap-2 pb-2">
                <h2 className={`${h2} flex-1 whitespace-nowrap`}>
                  Fire &amp; rescue call-outs <span className="font-normal text-slate-400">{drill.length} of {drillAll.length}</span>
                </h2>
                <Select label="Category" value={selected ?? ''} options={[...CATEGORIES]} onChange={(c) => setSelected((c || null) as Category | null)} />
              <Select label="Month" value={drillFilter.month} options={stats.months} onChange={(month) => setDrillFilter((f) => ({ ...f, month }))} />
              <Select
                label="Cause"
                value={drillFilter.cause}
                options={uniq(drillAll.map((r) => causeEn(r.ivykio_priezastis)))}
                onChange={(cause) => setDrillFilter((f) => ({ ...f, cause }))}
              />
              <Select
                label="Place"
                value={drillFilter.place}
                options={uniq(drillAll.map((r) => placeEn(r.ivykio_vieta)))}
                onChange={(place) => setDrillFilter((f) => ({ ...f, place }))}
              />
              <label className="flex items-center gap-1 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={drillFilter.harmed}
                  onChange={(e) => setDrillFilter((f) => ({ ...f, harmed: e.target.checked }))}
                  className="accent-status-action"
                />
                With casualties
              </label>
              </div>
            <div className="table-scroll max-h-80">
              <table className="w-full min-w-[44rem] table-fixed text-sm">
                <colgroup>
                  <col className="w-36" />
                  <col />
                  <col className="w-56" />
                  <col className="w-48" />
                  <col className="w-20" />
                </colgroup>
                <thead className={thead}>
                  <tr>
                    <Th k="date" sort={drillSort} onSort={setDrillSort}>Date · call</Th>
                    <Th k="cause" sort={drillSort} onSort={setDrillSort} first="asc">Recorded cause</Th>
                    <Th k="material" sort={drillSort} onSort={setDrillSort} first="asc">Material</Th>
                    <Th k="place" sort={drillSort} onSort={setDrillSort} first="asc">Place</Th>
                    <Th k="harm" sort={drillSort} onSort={setDrillSort} right>Killed / inj.</Th>
                  </tr>
                </thead>
                <tbody>
                  {drill.slice(0, ROW_LIMIT).map((r) => (
                    <tr key={r.korteles_id} className="border-t border-slate-700/60">
                      <td className={`${td} tabular-nums`}>
                        {r.korteles_data} <span className="text-slate-400">{r.iskvietimo_laikas?.slice(11, 16) ?? ''}</span>
                      </td>
                      <td className={`${td} truncate`} title={r.ivykio_priezastis ?? ''}>{causeEn(r.ivykio_priezastis)}</td>
                      <td className={`${td} truncate`} title={r.ivykio_medziaga ?? ''}>{materialEn(r.ivykio_medziaga)}</td>
                      <td className={`${td} truncate`} title={r.ivykio_vieta ?? ''}>{placeEn(r.ivykio_vieta)}</td>
                      <td className={tdNum}>
                        {r.zuvo_zmoniu ?? 0} / {r.traumuota_zmoniu ?? 0}
                      </td>
                    </tr>
                  ))}
                  {!drill.length && (
                    <tr>
                      <td colSpan={5} className="py-2 text-center text-xs text-slate-500">No incidents match the filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            </section>
            <section className={card}>
              <div className="flex flex-wrap items-center gap-2 pb-2">
                <h2 className={`${h2} flex-1 whitespace-nowrap`}>
                  Water supply interruptions <span className="font-normal text-slate-400">{water.length} of {waterRows.length}</span>
                </h2>
            <Segmented
              options={[
                ['', 'All'],
                ['Planned', 'Planned'],
                ['Unplanned', 'Unplanned'],
              ]}
              value={waterFilter.type}
              onChange={(type) => setWaterFilter((f) => ({ ...f, type }))}
            />
            <Select label="Reason" value={waterFilter.reason} options={uniq(waterRows.map((w) => w.reason))} onChange={(reason) => setWaterFilter((f) => ({ ...f, reason }))} />
            <Select label="Zone" value={waterFilter.zone} options={uniq(waterRows.map((w) => w.zone))} onChange={(zone) => setWaterFilter((f) => ({ ...f, zone }))} />
              </div>
          <div className="table-scroll max-h-80">
            <table className="w-full min-w-[48rem] table-fixed text-sm">
              <colgroup>
                <col className="w-36" />
                <col className="w-24" />
                <col />
                <col className="w-36" />
                <col className="w-28" />
                <col className="w-20" />
                <col className="w-16" />
              </colgroup>
              <thead className={thead}>
                <tr>
                  <Th k="date" sort={waterSort} onSort={setWaterSort}>Reported</Th>
                  <Th k="type" sort={waterSort} onSort={setWaterSort} first="asc">Type</Th>
                  <Th k="reason" sort={waterSort} onSort={setWaterSort} first="asc">Reason</Th>
                  <Th k="place" sort={waterSort} onSort={setWaterSort} first="asc">Locality</Th>
                  <Th k="zone" sort={waterSort} onSort={setWaterSort} first="asc">Zone</Th>
                  <Th k="customers" sort={waterSort} onSort={setWaterSort} right>Customers</Th>
                  <Th k="hours" sort={waterSort} onSort={setWaterSort} right>Hours</Th>
                </tr>
              </thead>
              <tbody>
                {water.slice(0, ROW_LIMIT).map((w) => (
                  <tr key={w.id} className="border-t border-slate-700/60" title={w.text}>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>{fmtDate(w.date)}</td>
                    <td className={td}>{w.type}</td>
                    <td className={`${td} truncate`}>{w.reason}</td>
                    <td className={`${td} truncate`}>{w.place}</td>
                    <td className={`${td} truncate text-xs text-slate-400`}>{w.zone}</td>
                    <td className={tdNum}>{w.customers.toLocaleString('en-GB')}</td>
                    <td className={tdNum}>{w.hours >= 0 ? w.hours.toFixed(1) : '—'}</td>
                  </tr>
                ))}
                {!water.length && (
                  <tr>
                    <td colSpan={7} className="py-2 text-center text-xs text-slate-500">No interruptions match the filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
            </section>
          </>
        )}
      </div>

      {tip && (
        <div
          className="pointer-events-none fixed z-50 rounded border border-slate-600 bg-slate-900/95 px-2 py-1 text-xs text-slate-100 shadow"
          style={{ left: tip.x + 12, top: tip.y + 12 }}
        >
          {tip.text}
        </div>
      )}
    </div>
  )
}
