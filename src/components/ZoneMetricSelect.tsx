import { ZONE_METRICS, type ZoneMetric } from '../map/zones'

// Filter that decides what the supply zones on the map are coloured by (shared by the layer menu and statistics).
export default function ZoneMetricSelect({ value, onChange }: { value: ZoneMetric; onChange: (m: ZoneMetric) => void }) {
  const groups = [...new Set(ZONE_METRICS.map((m) => m.group))]
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-400">
      Colour by
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ZoneMetric)}
        className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-800 px-1.5 py-1 text-xs text-slate-100"
      >
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {ZONE_METRICS.filter((m) => m.group === g).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}
