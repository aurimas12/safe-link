import responsibility from '../data/responsibility.json'

// Responsible teams and contacts per incident sector (src/data/responsibility.json).
// Only contacts verified on official websites are filled in; company contacts are added by the FEZ / companies.

export interface Contact {
  name: string
  phone: string | null
  phone_alt?: string | null
  email: string | null
  hours?: string | null
  web: string | null
  source: string
  address?: string
}

export type Sector = 'power' | 'gas' | 'water' | 'sewer' | 'storm' | 'fire'

const data = responsibility as unknown as {
  sectors: Record<Sector, { label: string; types: string[]; team: Contact }>
  coordination: Contact
  companies: Record<string, Partial<Contact>>
  metadata: { verified_at: string }
}

export const SECTORS = (Object.keys(data.sectors) as Sector[]).map((id) => ({ id, ...data.sectors[id] }))
export const sector = (id: Sector) => data.sectors[id]
export const COORDINATION = data.coordination
export const CONTACTS_VERIFIED_AT = data.metadata.verified_at
export const companyContact = (name: string): Partial<Contact> | null => data.companies[name] ?? null

// Short "how to reach" text for the log and the panel.
export function contactLine(c: Partial<Contact> | null): string {
  if (!c) return 'contact not provided'
  const parts = [c.phone, c.email].filter(Boolean)
  return parts.length ? parts.join(', ') : 'contact not provided'
}
