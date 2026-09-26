import { ChevronDown, ChevronRight, ChevronUp, MessageSquare, Radio } from 'lucide-react'
import { useState } from 'react'
import type { LogEntry } from '../map/workflow'

// Communication log (bottom bar): each status change with the notifications sent at that step.
// DEMO – notifications are composed and logged, not actually sent.
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB')

interface Step {
  status: LogEntry
  notifications: LogEntry[]
}

function groupSteps(entries: LogEntry[]): Step[] {
  const steps: Step[] = []
  for (const e of entries) {
    if (e.kind === 'status') steps.push({ status: e, notifications: [] })
    else steps.at(-1)?.notifications.push(e)
  }
  return steps.reverse() // newest first
}

export default function CommLog({ entries }: { entries: LogEntry[] }) {
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const steps = groupSteps(entries)
  const total = entries.filter((e) => e.kind === 'notification').length
  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="pointer-events-auto w-full rounded-md border border-slate-700 bg-panel/95 text-sm text-slate-200 shadow-xl backdrop-blur">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-slate-700/40">
        <Radio size={15} className="text-status-critical" />
        <span className="font-medium">Communication log</span>
        <span className="truncate text-xs text-slate-400">
          {steps.length} steps · {total} notifications · demo – not sent
        </span>
        {open ? <ChevronDown size={15} className="ml-auto shrink-0" /> : <ChevronUp size={15} className="ml-auto shrink-0" />}
      </button>
      {open && (
        <ol className="max-h-40 overflow-y-auto border-t border-slate-700 px-2 py-1">
          {steps.map((step) => {
            const isOpen = expanded.has(step.status.id)
            return (
              <li key={step.status.id} className="py-0.5">
                <button
                  onClick={() => toggle(step.status.id)}
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-700/40"
                >
                  {isOpen ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
                  <span className="font-mono text-xs text-slate-500">{clock(step.status.time)}</span>
                  <span className="truncate font-medium text-amber-200">{step.status.text}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-400">{step.notifications.length} notified</span>
                </button>
                {isOpen && (
                  <ul className="ml-6 space-y-1 border-l border-slate-700 py-1 pl-3">
                    {step.notifications.map((n) => (
                      <li key={n.id} className="flex gap-2">
                        <MessageSquare size={13} className="mt-0.5 shrink-0 text-slate-400" />
                        <div className="min-w-0">
                          <div>
                            <span className="font-medium">{n.to}</span>
                            <span className="text-xs text-slate-400">
                              {' '}
                              · {n.channel} · {n.contact} ·{' '}
                              <span className="rounded bg-slate-700 px-1 text-[10px] uppercase tracking-wide text-slate-300">
                                demo – not sent
                              </span>
                            </span>
                          </div>
                          <div className="text-slate-300">{n.text}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
