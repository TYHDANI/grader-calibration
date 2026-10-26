import type { ExtractedPage } from './extract.ts'
import type { LedgerEntry } from './schema.ts'
import { bestCustomer, pickPaymentMethod, normalize } from './match.ts'
import type { QboClient, Customer, PaymentMethod, Invoice, PaymentCreate } from './qbo.ts'

export type Status = 'ready' | 'review' | 'skip'

export type Proposal = {
  id: string
  photo: string
  row: number
  entry: LedgerEntry
  status: Status
  reasons: string[]
  customer: { id: string; displayName: string; score: number } | null
  alternates: { id: string; displayName: string; score: number }[]
  paymentMethod: { id: string; name: string } | null
  applyTo: { invoiceId: string; docNumber: string; invoiceDate: string; balance: number; amount: number }[]
  unapplied: number
  possibleDuplicates: { paymentId: string; txnDate: string; amount: number; note: string }[]
  /** The exact body that `post` sends to QuickBooks. Edit it by hand if needed. */
  payment: PaymentCreate
  /** `post` only sends rows with approved: true. Ready rows start approved; review rows start false. */
  approved: boolean
  result?: { paymentId: string; postedAt: string } | { error: string; at: string }
}

export type ProposalFile = {
  createdAt: string
  env: string
  companyName: string
  pages: { photo: string; page_summary: string }[]
  proposals: Proposal[]
}

const AUTO_MATCH = 0.9
const MAYBE_MATCH = 0.65

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Prefer invoices whose memo or lines mention the trip; then oldest first. */
function rankInvoices(invoices: Invoice[], trip: string | null): Invoice[] {
  const key = trip ? normalize(trip).split(' ')[0] ?? '' : ''
  const mentions = (inv: Invoice) => {
    if (!key) return false
    const hay = [inv.CustomerMemo?.value, inv.PrivateNote, ...(inv.Line ?? []).map(l => l.Description)]
      .filter(Boolean).map(s => normalize(String(s))).join(' ')
    return hay.includes(key)
  }
  return [...invoices].sort((a, b) => {
    const ma = mentions(a) ? 0 : 1, mb = mentions(b) ? 0 : 1
    return ma - mb || a.TxnDate.localeCompare(b.TxnDate)
  })
}

export async function buildProposals(
  qbo: QboClient,
  pages: ExtractedPage[],
  opts: { customers?: Customer[]; methods?: PaymentMethod[]; depositAccountId?: string } = {},
): Promise<Proposal[]> {
  const customers = opts.customers ?? await qbo.listCustomers()
  const methods = opts.methods ?? await qbo.listPaymentMethods()
  const invoiceCache = new Map<string, Invoice[]>()
  const out: Proposal[] = []

  for (const { photo, page } of pages) {
    for (const entry of page.entries) {
      const reasons: string[] = []
      let status: Status = 'ready'
      const review = (why: string) => { reasons.push(why); if (status === 'ready') status = 'review' }

      if (!(entry.amount > 0)) { reasons.push('amount is zero or unreadable'); status = 'skip' }
      if (entry.confidence === 'low') review(`Claude marked this row low confidence${entry.notes ? `: ${entry.notes}` : ''}`)
      else if (entry.notes) reasons.push(`note: ${entry.notes}`)
      if (!entry.date) review('no date on or above this row')

      const matches = bestCustomer(entry, customers)
      const best = matches[0]
      let customer: Proposal['customer'] = null
      if (best && best.score >= MAYBE_MATCH) {
        customer = { id: best.customer.Id, displayName: best.customer.DisplayName, score: Number(best.score.toFixed(2)) }
        if (best.score < AUTO_MATCH) review(`customer match uncertain (${customer.displayName}, ${customer.score})`)
        if (matches[1] && matches[1].score >= AUTO_MATCH) review(`more than one customer matches (${matches.slice(0, 2).map(m => m.customer.DisplayName).join(' / ')})`)
      } else {
        review(`no QuickBooks customer found for "${entry.name_raw}" (create the customer, or set customer.id by hand)`)
      }
      const alternates = matches.slice(customer ? 1 : 0).map(m => ({ id: m.customer.Id, displayName: m.customer.DisplayName, score: Number(m.score.toFixed(2)) }))

      const pm = pickPaymentMethod(entry.method, methods)
      if (entry.method === 'unknown') review('payment method not written')
      else if (!pm) review(`no QuickBooks payment method named like "${entry.method}" (add one in QuickBooks or leave blank)`)

      const applyTo: Proposal['applyTo'] = []
      let remaining = entry.amount
      const possibleDuplicates: Proposal['possibleDuplicates'] = []
      if (customer) {
        let invoices = invoiceCache.get(customer.id)
        if (!invoices) { invoices = await qbo.openInvoices(customer.id); invoiceCache.set(customer.id, invoices) }
        for (const inv of rankInvoices(invoices, entry.trip)) {
          if (remaining <= 0) break
          const alreadyPlanned = out.filter(p => p.applyTo.some(a => a.invoiceId === inv.Id)).reduce((s, p) => s + p.applyTo.filter(a => a.invoiceId === inv.Id).reduce((t, a) => t + a.amount, 0), 0)
          const avail = Math.max(0, inv.Balance - alreadyPlanned)
          if (avail <= 0) continue
          const amount = Math.min(avail, remaining)
          applyTo.push({ invoiceId: inv.Id, docNumber: inv.DocNumber ?? '', invoiceDate: inv.TxnDate, balance: inv.Balance, amount })
          remaining -= amount
        }
        if (!invoices.length) reasons.push('no open invoice; payment will sit as customer credit')
        else if (remaining > 0) reasons.push(`$${remaining} more than open invoices; remainder stays as customer credit`)

        if (entry.date) {
          const dupes = await qbo.paymentsBetween(customer.id, addDays(entry.date, -7), addDays(entry.date, 7))
          for (const p of dupes) {
            if (Math.abs(p.TotalAmt - entry.amount) < 0.005) {
              possibleDuplicates.push({ paymentId: p.Id, txnDate: p.TxnDate, amount: p.TotalAmt, note: p.PrivateNote ?? '' })
            }
          }
          if (possibleDuplicates.length) review(`a payment for the same amount already exists on ${possibleDuplicates.map(d => d.txnDate).join(', ')} (possible duplicate)`)
        }
      }

      const payment: PaymentCreate = {
        CustomerRef: { value: customer?.id ?? '' },
        TotalAmt: entry.amount,
        ...(entry.date ? { TxnDate: entry.date } : {}),
        ...(pm ? { PaymentMethodRef: { value: pm.Id } } : {}),
        ...(entry.reference ? { PaymentRefNum: entry.reference } : {}),
        PrivateNote: [entry.trip, `ledger ${entry.date_raw ?? entry.date ?? ''} row ${entry.row}`].filter(Boolean).join(' - '),
        ...(opts.depositAccountId ? { DepositToAccountRef: { value: opts.depositAccountId } } : {}),
        ...(applyTo.length ? { Line: applyTo.map(a => ({ Amount: a.amount, LinkedTxn: [{ TxnId: a.invoiceId, TxnType: 'Invoice' as const }] })) } : {}),
      }

      out.push({
        id: `${photo.split('/').pop()}#${entry.row}`,
        photo, row: entry.row, entry, status, reasons,
        customer, alternates,
        paymentMethod: pm ? { id: pm.Id, name: pm.Name } : null,
        applyTo, unapplied: remaining, possibleDuplicates,
        payment, approved: status === 'ready',
      })
    }
  }
  return out
}
