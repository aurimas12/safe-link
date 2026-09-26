import { ChevronDown, Droplets, ExternalLink, Loader2, MapPin, Minus, Trash2, TriangleAlert, Zap } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { formatEur, type ImpactSummary } from '../map/buildings'
import {
  RADIUS_RANGE_M,
  ownerLabel,
  type AssetGroup,
  type Incident,
  type IncidentAnalysis,
  type IncidentSummary,
  type Recipient,
} from '../map/incident'
import { CONTACTS_VERIFIED_AT, SECTORS, contactLine, sector, type Contact, type Sector } from '../map/responsibility'
import { NEXT, STATUS_LABEL, type Report } from '../map/workflow'

interface Props {
  incident: Incident
  info: IncidentAnalysis | null
  report: Report
  collapsed: boolean
  onToggleCollapsed: () => void
  onReport: (patch: Partial<Report>) => void
  onRadius: (radiusM: number) => void
  onAdvance: () => void
  onRemove: () => void
}

const field = 'w-full rounded border border-slate-600 bg-slate-900/60 px-2 py-1 text-sm text-slate-100 disabled:opacity-60'
const heading = 'px-3 pt-3 text-xs font-medium uppercase tracking-wide text-slate-400'
const subheading = 'flex items-center gap-1.5 px-3 pt-3 text-xs font-medium uppercase tracking-wide text-slate-300'

export default function IncidentPanel({
  incident,
  info,
  report,
  collapsed,
  onToggleCollapsed,
  onReport,
  onRadius,
  onAdvance,
  onRemove,
}: Props) {
  const team = sector(report.sector).team
  const next = NEXT[report.status]
  const draft = report.status === 'draft'

  return (
    <section className="overflow-y-auto rounded-md border border-red-500/70 bg-panel/95 text-sm text-slate-200 shadow-xl backdrop-blur">
      <div className={`flex items-center gap-2 bg-red-500/15 px-3 py-2 ${collapsed ? '' : 'border-b border-red-500/40'}`}>
        <TriangleAlert size={16} className="shrink-0 text-status-critical" />
        <button onClick={onToggleCollapsed} className="min-w-0 flex-1 truncate text-left font-semibold" title="Show / hide details">
          Incident {draft ? 'detected' : `· ${STATUS_LABEL[report.status]}`}
          {collapsed && <span className="font-normal text-slate-300"> · {incident.radiusM} m</span>}
        </button>
        <button
          onClick={onToggleCollapsed}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200"
          title={collapsed ? 'Show details' : 'Hide details (the incident stays on the map)'}
        >
          {collapsed ? <ChevronDown size={16} /> : <Minus size={16} />}
        </button>
        <button onClick={onRemove} className="rounded p-0.5 text-slate-400 hover:bg-red-500/30 hover:text-red-200" title="Remove incident">
          <Trash2 size={16} />
        </button>
      </div>

      {!collapsed && (
        <>
          {/* 1. Report */}
          <div className={heading}>Report</div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 px-3 pt-1.5">
            <label className="text-slate-400" htmlFor="inc-sector">Sector</label>
            <select
              id="inc-sector"
              className={field}
              value={report.sector}
              disabled={!draft}
              onChange={(e) => {
                const s = e.target.value as Sector
                onReport({ sector: s, type: sector(s).types[0] })
              }}
            >
              {SECTORS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <label className="text-slate-400" htmlFor="inc-type">Problem</label>
            <select id="inc-type" className={field} value={report.type} disabled={!draft} onChange={(e) => onReport({ type: e.target.value })}>
              {sector(report.sector).types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <label className="text-slate-400" htmlFor="inc-address">Address</label>
            <input
              id="inc-address"
              className={field}
              value={report.address ?? ''}
              placeholder="Detecting the address…"
              disabled={!draft}
              onChange={(e) => onReport({ address: e.target.value, addressEdited: true })}
            />
            <label className="self-start pt-1 text-slate-400" htmlFor="inc-desc">Details</label>
            <textarea
              id="inc-desc"
              className={field}
              rows={2}
              placeholder="What was observed (optional)"
              value={report.description}
              disabled={!draft}
              onChange={(e) => onReport({ description: e.target.value })}
            />
          </div>
          <p className="px-3 pt-1 text-xs text-slate-500">Address: official Klaipėda address locator (nearest address point).</p>

          {/* 2. Responsible team */}
          <div className={heading}>Responsible team</div>
          <div className="px-3 pt-1.5">
            <div className="font-medium">{team.name}</div>
            <div className="text-slate-300">
              {[team.phone, team.phone_alt, team.email].filter(Boolean).join(' · ')}
              {team.hours ? ` · ${team.hours}` : ''}
            </div>
            <a href={team.source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline">
              official source (checked {CONTACTS_VERIFIED_AT}) <ExternalLink size={11} />
            </a>
          </div>

          {/* 3. Status */}
          <div className={heading}>Status</div>
          <div className="flex items-center gap-2 px-3 pt-1.5">
            <span className="rounded-full border border-slate-600 px-2 py-0.5 text-xs">{STATUS_LABEL[report.status]}</span>
            {next && (
              <button
                onClick={onAdvance}
                disabled={!info}
                className="ml-auto rounded-md bg-status-critical px-3 py-1 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
                title={info ? undefined : 'Waiting for the zone analysis'}
              >
                {next.action}
              </button>
            )}
          </div>
          {next && (
            <p className="px-3 pt-1 text-xs text-slate-500">
              Each step notifies the responsible team and everyone below (demo – messages are logged, not sent).
            </p>
          )}

          {/* 4. Zone and impact */}
          <div className={heading}>Zone and impact</div>
          <label className="flex items-center gap-2 px-3 pt-1.5 text-xs text-slate-400">
            Radius
            <input
              type="range"
              min={RADIUS_RANGE_M[0]}
              max={RADIUS_RANGE_M[1]}
              step={50}
              value={incident.radiusM}
              onChange={(e) => onRadius(Number(e.target.value))}
              className="flex-1 accent-red-500"
            />
            <span className="w-14 text-right text-slate-200">{incident.radiusM} m</span>
          </label>
          <p className="flex items-center gap-1 px-3 pt-1 text-xs text-slate-500">
            <MapPin size={12} /> {incident.center[1].toFixed(5)}, {incident.center[0].toFixed(5)}
          </p>
          {info ? <Impact summary={info.summary} /> : (
            <p className="flex items-center gap-2 px-3 py-2 text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Analysing the zone…
            </p>
          )}

          {/* 5. Who is informed */}
          {info && <Recipients team={team} recipients={info.recipients} />}
          <p className="border-t border-slate-700 px-3 py-2 text-xs text-slate-400">
            Red – buildings in the zone; orange – outside the zone but fed by a network node inside it. Drag the marker to move
            the incident.
          </p>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------

const Chip = ({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'power' | 'outline' }) => (
  <span
    className={
      'inline-block rounded-full px-2 py-0.5 text-xs ' +
      (tone === 'power'
        ? 'bg-pink-600/30 text-pink-100'
        : tone === 'outline'
          ? 'border border-slate-600 text-slate-300'
          : 'bg-slate-700/80 text-slate-100')
    }
  >
    {children}
  </span>
)

const Tile = ({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => (
  <div className="rounded-md border border-slate-700 bg-slate-900/40 px-2.5 py-1.5">
    <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
    <div className="text-lg font-semibold leading-tight">{value}</div>
    {sub && <div className="text-xs text-slate-400">{sub}</div>}
  </div>
)

const Chips = ({ items, tone }: { items: string[]; tone?: 'default' | 'power' | 'outline' }) => (
  <div className="flex flex-wrap gap-1">
    {items.map((c) => (
      <Chip key={c} tone={tone}>
        {c}
      </Chip>
    ))}
  </div>
)

const purposesLine = (s: ImpactSummary) =>
  s.purposes
    .slice(0, 4)
    .map(([l, n]) => `${l} ${n}`)
    .join(' · ')

// Cascade block: buildings losing a service outside the zone.
function Cascade({ title, s }: { title: string; s: ImpactSummary }) {
  return (
    <div className="mx-3 mt-2 rounded-md border-l-4 border-status-risk bg-orange-500/10 px-2.5 py-2">
      <div className="text-xs font-medium uppercase tracking-wide text-orange-200">{title}</div>
      <div className="mt-0.5">
        <span className="font-semibold">{s.lez}</span> FEZ buildings · <span className="font-semibold">{s.other}</span> outside
      </div>
      {s.other > 0 && <div className="text-xs text-slate-400">{purposesLine(s)}</div>}
      {(s.employees > 0 || s.perHour > 0) && (
        <div className="text-xs text-slate-300">
          {s.employees > 0 && `${s.employees} employees`}
          {s.employees > 0 && s.perHour > 0 && ' · '}
          {s.perHour > 0 && `≈ ${formatEur(s.perHour)} / h at risk`}
        </div>
      )}
      {s.companies.length > 0 && (
        <div className="mt-1">
          <Chips items={s.companies} />
        </div>
      )}
    </div>
  )
}

// Operator colours for the water / sewage bars.
const OPERATOR_COLOR = (op: string) =>
  op.includes('Klaipedos vanduo') ? (op.startsWith('Apžiuri') ? '#7dd3fc' : '#38bdf8') : op === 'Nežinoma' ? '#475569' : '#94a3b8'

function WaterTable({ groups }: { groups: AssetGroup[] }) {
  const rows = groups.filter((g) => g.count > 0)
  if (!rows.length) return <p className="px-3 pt-1 text-xs text-slate-400">No water or sewage objects in the zone.</p>
  return (
    <div className="space-y-2 px-3 pt-1.5">
      {rows.map((g) => {
        const ops = Object.entries(g.operators)
          .map(([op, owners]) => [op, Object.values(owners).reduce((a, b) => a + b, 0)] as const)
          .sort((a, b) => b[1] - a[1])
        return (
          <div key={g.key}>
            <div className="flex justify-between">
              <span>{g.label}</span>
              <span className="font-semibold">{g.count}</span>
            </div>
            <div className="mt-0.5 flex h-1.5 overflow-hidden rounded-full bg-slate-800">
              {ops.map(([op, n]) => (
                <div key={op} style={{ width: `${(100 * n) / g.count}%`, background: OPERATOR_COLOR(op) }} title={`${ownerLabel(op)}: ${n}`} />
              ))}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-400">
              {ops.map(([op, n]) => (
                <span key={op} className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: OPERATOR_COLOR(op) }} />
                  {ownerLabel(op)} {n}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Impact({ summary }: { summary: IncidentSummary }) {
  const z = summary.zone
  return (
    <div className="pb-2">
      <div className="grid grid-cols-2 gap-2 px-3 pt-2">
        <Tile label="Buildings in zone" value={z.lez + z.other} sub={`${z.lez} FEZ · ${z.other} outside`} />
        <Tile label="Employees" value={z.employees || '—'} sub="matched FEZ companies" />
        <Tile label="Revenue at risk" value={z.perHour ? formatEur(z.perHour) : '—'} sub="per hour" />
        <Tile
          label="Fire service"
          value={summary.fire ? (summary.fire.minutes < 1 ? '< 1 min' : `~${summary.fire.minutes} min`) : '—'}
          sub={summary.fire?.station}
        />
      </div>
      {z.companies.length > 0 && (
        <div className="px-3 pt-2">
          <div className="pb-1 text-xs text-slate-400">FEZ companies in the zone</div>
          <Chips items={z.companies} />
        </div>
      )}
      {z.other > 0 && <p className="px-3 pt-1.5 text-xs text-slate-400">Outside the FEZ: {purposesLine(z)}</p>}

      <div className={subheading}>
        <Zap size={13} /> Power
      </div>
      {summary.power ? (
        <div className="space-y-1 px-3 pt-1">
          {summary.power.hv.length > 0 && <Chips items={summary.power.hv} tone="power" />}
          <div>
            {summary.power.transformers
              ? `${summary.power.transformers} transformers / switching stations`
              : summary.power.hv.length
                ? null
                : 'No power assets in the zone'}
          </div>
          {summary.power.units.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs text-slate-400">
              ESO units: <Chips items={summary.power.units} tone="outline" />
            </div>
          )}
        </div>
      ) : (
        <p className="px-3 pt-1 text-xs text-slate-400">Loading the dependency graph…</p>
      )}
      {summary.cascade.power && <Cascade title="Cascade · lose power outside the zone" s={summary.cascade.power} />}
      {summary.cascade.water && <Cascade title="Cascade · lose water outside the zone" s={summary.cascade.water} />}
      {summary.cascade.note && <p className="px-3 pt-1.5 text-xs italic text-slate-500">{summary.cascade.note}</p>}

      <div className={subheading}>
        <Droplets size={13} /> Water and sewage
      </div>
      {summary.water ? (
        <WaterTable groups={summary.water} />
      ) : (
        <p className="px-3 pt-1 text-xs text-slate-400">Could not load Klaipėdos vanduo data.</p>
      )}
    </div>
  )
}

const Person = ({ name, detail }: { name: string; detail: string }) => (
  <li>
    <div className="font-medium leading-snug">{name}</div>
    <div className="text-xs text-slate-400">{detail}</div>
  </li>
)

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="pt-2">
    <div className="pb-1 text-xs text-slate-400">{title}</div>
    <ul className="space-y-1.5">{children}</ul>
  </div>
)

function Recipients({ team, recipients }: { team: Contact; recipients: Recipient[] }) {
  const [showAll, setShowAll] = useState(false)
  const operators = recipients.filter((r) => r.role === 'operator')
  const coordination = recipients.filter((r) => r.role === 'coordination')
  const companies = recipients.filter((r) => r.role === 'company')
  const shownCompanies = showAll ? companies : companies.slice(0, 4)
  return (
    <>
      <div className={heading}>To be informed ({recipients.length + 1})</div>
      <div className="px-3 pb-2">
        <Group title="Responsible team">
          <Person name={team.name} detail={contactLine(team)} />
        </Group>
        {coordination.length > 0 && (
          <Group title="Coordination">
            {coordination.map((r) => (
              <Person key={r.name} name={r.name} detail={contactLine(r.contact)} />
            ))}
          </Group>
        )}
        {operators.length > 0 && (
          <Group title={`Network operators (${operators.length})`}>
            {operators.map((r) => (
              <Person key={r.name} name={r.name} detail={`${r.reason} · ${contactLine(r.contact)}`} />
            ))}
          </Group>
        )}
        {companies.length > 0 && (
          <Group title={`Companies (${companies.length})`}>
            {shownCompanies.map((r) => (
              <Person key={r.name} name={r.name} detail={`${r.reason} · ${contactLine(r.contact)}`} />
            ))}
            {companies.length > 4 && (
              <li>
                <button onClick={() => setShowAll((v) => !v)} className="text-xs text-sky-400 hover:underline">
                  {showAll ? 'Show fewer' : `Show all ${companies.length}`}
                </button>
              </li>
            )}
          </Group>
        )}
      </div>
    </>
  )
}
