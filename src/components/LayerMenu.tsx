import { ChevronDown, Layers } from 'lucide-react'
import { useState } from 'react'
import { ESO_GROUPS, ESO_META } from '../map/eso'
import { WATER_GROUPS, WATER_VECTOR_MIN_ZOOM } from '../map/water'
import type { LayerGroup } from '../map/layers'

interface Props {
  visible: Set<string>
  onToggle: (id: string) => void
}

const esoDate = ESO_META.fetched_at.slice(0, 10)

function Section({ title, groups, visible, onToggle }: { title: string; groups: LayerGroup[] } & Props) {
  return (
    <>
      <div className="mb-1 mt-1 text-xs uppercase tracking-wide text-slate-400">{title}</div>
      <ul className="mb-2 space-y-1">
        {groups.map((g) => (
          <li key={g.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-700/40">
              <input
                type="checkbox"
                checked={visible.has(g.id)}
                onChange={() => onToggle(g.id)}
                className="accent-status-action"
              />
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} />
              <span>{g.label}</span>
              {g.count != null && <span className="ml-auto text-xs text-slate-400">{g.count}</span>}
            </label>
          </li>
        ))}
      </ul>
    </>
  )
}

export default function LayerMenu({ visible, onToggle }: Props) {
  const [open, setOpen] = useState(true)

  return (
    <div className="max-h-[calc(100vh-5rem)] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-md border border-slate-700 bg-panel/90 text-sm text-slate-200 backdrop-blur">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-700/40">
        <Layers size={16} />
        <span className="font-medium">Infrastruktūra</span>
        <ChevronDown size={16} className={`ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-slate-700 px-3 py-2">
          <Section title="ESO – oficialus elektros tinklas" groups={ESO_GROUPS} visible={visible} onToggle={onToggle} />
          <Section title="Klaipėdos vanduo" groups={WATER_GROUPS} visible={visible} onToggle={onToggle} />
          <p className="border-t border-slate-700 pt-2 text-xs leading-snug text-slate-400">
            ESO: atviri duomenys (data.gov.lt), {esoDate}, visa Klaipėda; projektuojamas tinklas nerodomas.
            Klaipėdos vanduo: vieši duomenys realiu laiku; objektai paspaudžiami priartinus (z{WATER_VECTOR_MIN_ZOOM}+).
          </p>
        </div>
      )}
    </div>
  )
}
