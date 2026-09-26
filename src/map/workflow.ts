import type { IncidentAnalysis, Recipient } from './incident'
import { contactLine, sector, type Contact, type Sector } from './responsibility'

// Incident report, its status workflow and the notifications sent at each step.
// Notifications are DEMO: they are composed and logged, but not actually sent (no backend yet).

export type Status = 'draft' | 'registered' | 'dispatched' | 'on_site' | 'contained' | 'closed'

export const STATUS_LABEL: Record<Status, string> = {
  draft: 'Draft – not registered',
  registered: 'Registered',
  dispatched: 'Team dispatched',
  on_site: 'Team on site',
  contained: 'Contained',
  closed: 'Closed',
}
// The next step and its button text.
export const NEXT: Partial<Record<Status, { to: Status; action: string }>> = {
  draft: { to: 'registered', action: 'Register incident' },
  registered: { to: 'dispatched', action: 'Dispatch response team' },
  dispatched: { to: 'on_site', action: 'Team on site' },
  on_site: { to: 'contained', action: 'Mark contained' },
  contained: { to: 'closed', action: 'Close incident' },
}

export interface Report {
  sector: Sector
  type: string
  description: string
  address: string | null
  addressEdited: boolean
  status: Status
}

export interface LogEntry {
  id: number
  time: string
  kind: 'status' | 'notification'
  to?: string
  role?: Recipient['role'] | 'team'
  channel?: string
  contact?: string
  text: string
}

export function newReport(): Report {
  return { sector: 'power', type: sector('power').types[0], description: '', address: null, addressEdited: false, status: 'draft' }
}

const channelOf = (c: Partial<Contact> | null) => (c?.email ? 'e-mail' : c?.phone ? 'SMS / call' : 'no contact')

let nextId = 1

// Log entries for a status change: the status itself + one notification per recipient.
export function statusChange(report: Report, to: Status, analysis: IncidentAnalysis | null, radiusM: number): LogEntry[] {
  const time = new Date().toISOString()
  const where = report.address ?? 'the marked location'
  const what = `${report.type} (${sector(report.sector).label})`
  const team = sector(report.sector).team
  const entries: LogEntry[] = [{ id: nextId++, time, kind: 'status', text: `Status: ${STATUS_LABEL[to]} – ${what}, ${where}` }]

  const message = (reason: string) => {
    switch (to) {
      case 'registered':
        return `Incident registered: ${what} at ${where}, danger radius ${radiusM} m.${report.description ? ` ${report.description}.` : ''} You are informed because: ${reason}. Responsible: ${team.name}.`
      case 'dispatched':
        return `Update: response team dispatched to ${where} (${what}).`
      case 'on_site':
        return `Update: response team on site at ${where}.`
      case 'contained':
        return `Update: incident at ${where} is contained. Follow-up information will be sent.`
      case 'closed':
        return `Incident at ${where} is closed.`
      default:
        return ''
    }
  }

  // The responsible team: a dispatch request on registration, then status updates.
  entries.push({
    id: nextId++,
    time,
    kind: 'notification',
    to: team.name,
    role: 'team',
    channel: channelOf(team),
    contact: contactLine(team),
    text: to === 'registered' ? `Dispatch request: ${message('you are the responsible team')}` : message('responsible team'),
  })
  for (const r of analysis?.recipients ?? []) {
    entries.push({
      id: nextId++,
      time,
      kind: 'notification',
      to: r.name,
      role: r.role,
      channel: channelOf(r.contact),
      contact: contactLine(r.contact),
      text: message(r.reason),
    })
  }
  return entries
}
