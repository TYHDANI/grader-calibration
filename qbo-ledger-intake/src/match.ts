import type { LedgerEntry } from './schema.ts'

export const normalize = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

export const tokens = (s: string) => normalize(s).split(' ').filter(Boolean)

const bigrams = (s: string) => {
  const out = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const b = s.slice(i, i + 2)
    out.set(b, (out.get(b) ?? 0) + 1)
  }
  return out
}

/** Sørensen–Dice similarity on character bigrams, 0..1. */
export function dice(a: string, b: string): number {
  const x = normalize(a), y = normalize(b)
  if (!x.length || !y.length) return 0
  if (x === y) return 1
  const bx = bigrams(x), by = bigrams(y)
  let overlap = 0
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) ?? 0)
  return (2 * overlap) / ((x.length - 1) + (y.length - 1))
}

export type Customer = { Id: string; DisplayName: string; GivenName?: string; FamilyName?: string }

/**
 * Score how well a ledger name matches a QuickBooks customer. QuickBooks display
 * names are usually "Last, First" while the ledger writes "First Last".
 */
export function nameScore(first: string, last: string, c: Customer): number {
  const f = normalize(first), l = normalize(last)
  const display = tokens(c.DisplayName)
  const given = normalize(c.GivenName ?? ''), family = normalize(c.FamilyName ?? '')

  if (f && l && given === f && family === l) return 1
  if (f && l && display.includes(f) && display.includes(l)) return 1

  const lastOk = (family && family === l) || display.includes(l)
  if (lastOk && f && (given.startsWith(f[0]!) || display.some(t => t.startsWith(f[0]!)))) {
    // same last name, first initial matches: handles "Fran" vs "Francine"
    const bestFirst = Math.max(dice(f, given), ...display.map(t => dice(f, t)))
    return 0.75 + 0.2 * bestFirst
  }
  if (lastOk) return 0.6

  // Fall back to fuzzy on both orderings, for misspellings like "Gittens" vs "Gittins".
  const ledger = `${f} ${l}`
  const asDisplay = `${l} ${f}`
  return Math.max(dice(ledger, c.DisplayName), dice(asDisplay, c.DisplayName)) * 0.95
}

export type Match = { customer: Customer; score: number }

export function bestCustomer(entry: Pick<LedgerEntry, 'first_name' | 'last_name'>, customers: Customer[], top = 3): Match[] {
  return customers
    .map(customer => ({ customer, score: nameScore(entry.first_name, entry.last_name, customer) }))
    .filter(m => m.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, top)
}

export type QboPaymentMethod = { Id: string; Name: string; Type?: string }

const METHOD_SYNONYMS: Record<LedgerEntry['method'], string[]> = {
  zelle: ['zelle'],
  cash: ['cash'],
  check: ['check', 'cheque', 'ck'],
  credit_card: ['credit card', 'visa', 'mastercard', 'amex', 'discover', 'card', 'cc'],
  paypal: ['paypal', 'pay pal'],
  money_order: ['money order', 'm.o.', 'mo'],
  unknown: [],
}

export function pickPaymentMethod(method: LedgerEntry['method'], methods: QboPaymentMethod[]): QboPaymentMethod | null {
  const wanted = METHOD_SYNONYMS[method]
  if (!wanted.length) return null
  for (const w of wanted) {
    const exact = methods.find(m => normalize(m.Name) === normalize(w))
    if (exact) return exact
  }
  let best: { m: QboPaymentMethod; s: number } | null = null
  for (const m of methods) for (const w of wanted) {
    const s = dice(m.Name, w)
    if (s > 0.6 && (!best || s > best.s)) best = { m, s }
  }
  return best?.m ?? null
}
