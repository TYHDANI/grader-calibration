import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProposals } from '../src/propose.ts'
import type { QboClient, Customer, PaymentMethod, Invoice, Payment } from '../src/qbo.ts'
import type { ExtractedPage } from '../src/extract.ts'
import type { LedgerEntry } from '../src/schema.ts'

// A stub standing in for QuickBooks: customers, methods, open invoices and existing payments.
const customers: Customer[] = [
  { Id: '1439', DisplayName: 'Mitchell, Francine', GivenName: 'Francine', FamilyName: 'Mitchell' },
  { Id: '77', DisplayName: 'Gordon, Connie', GivenName: 'Connie', FamilyName: 'Gordon' },
  { Id: '78', DisplayName: 'Powell, Dorothy', GivenName: 'Dorothy', FamilyName: 'Powell' },
]
const methods: PaymentMethod[] = [{ Id: 'm1', Name: 'Zelle' }, { Id: 'm2', Name: 'Check' }, { Id: 'm3', Name: 'Cash' }]
const invoices: Record<string, Invoice[]> = {
  '1439': [{ Id: 'i1', DocNumber: '6912', TxnDate: '2026-06-01', TotalAmt: 570, Balance: 570, CustomerMemo: { value: 'Lobster fest' } }],
  '77': [
    { Id: 'i2', DocNumber: '7001', TxnDate: '2026-05-01', TotalAmt: 300, Balance: 100, CustomerMemo: { value: 'Europe' } },
    { Id: 'i3', DocNumber: '7002', TxnDate: '2026-07-01', TotalAmt: 165, Balance: 165, CustomerMemo: { value: 'Lobsterfeast' } },
  ],
  '78': [],
}
const payments: Record<string, Payment[]> = {
  '1439': [{ Id: 'p1', TxnDate: '2026-09-28', TotalAmt: 405, CustomerRef: { value: '1439' }, PrivateNote: 'Lobster Fest' }],
}
const stub = {
  listCustomers: async () => customers,
  listPaymentMethods: async () => methods,
  openInvoices: async (id: string) => invoices[id] ?? [],
  paymentsBetween: async (id: string, from: string, to: string) => (payments[id] ?? []).filter(p => p.TxnDate >= from && p.TxnDate <= to),
} as unknown as QboClient

const row = (o: Partial<LedgerEntry> & Pick<LedgerEntry, 'row' | 'name_raw' | 'first_name' | 'last_name' | 'amount'>): LedgerEntry => ({
  date_raw: '9/28', date: '2026-09-28', date_inherited: false, trip: null, method: 'zelle', method_inherited: false,
  reference: null, confidence: 'high', notes: null, ...o,
})

const pages: ExtractedPage[] = [{
  photo: 'ledger.jpg',
  usage: { input: 0, output: 0, cacheRead: 0 },
  page: {
    page_summary: 'Payments 9/23 to 9/30',
    entries: [
      row({ row: 1, name_raw: 'FRANCINE MITCHELL', first_name: 'Francine', last_name: 'Mitchell', trip: 'Lobsterfest', amount: 405 }),
      row({ row: 2, name_raw: 'Connie Gordon', first_name: 'Connie', last_name: 'Gordon', trip: 'Lobsterfeast', amount: 165, date_raw: '9/29', date: '2026-09-29', method_inherited: true }),
      row({ row: 3, name_raw: 'Dorothy Powell', first_name: 'Dorothy', last_name: 'Powell', trip: 'Europe', amount: 300, date_raw: '9/30', date: '2026-09-30', method: 'unknown' }),
      row({ row: 4, name_raw: 'Juanita Morgan', first_name: 'Juanita', last_name: 'Morgan', trip: 'Obama', amount: 100, method: 'check', reference: '2583' }),
      row({ row: 5, name_raw: 'Connie Gordon', first_name: 'Connie', last_name: 'Gordon', trip: 'Europe', amount: 250, method: 'cash', confidence: 'low', notes: 'amount could be 250 or 280' }),
    ],
  },
}]

test('proposals: duplicate, invoice application, missing method, unknown customer, low confidence', async () => {
  const p = await buildProposals(stub, pages)
  assert.equal(p.length, 5)

  // Row 1: exact customer, Zelle, applies to the lobster invoice, but a 9/28 $405 payment already exists.
  assert.equal(p[0]!.customer?.id, '1439')
  assert.equal(p[0]!.paymentMethod?.name, 'Zelle')
  assert.deepEqual(p[0]!.applyTo.map(a => [a.docNumber, a.amount]), [['6912', 405]])
  assert.equal(p[0]!.status, 'review')
  assert.match(p[0]!.reasons.join(' '), /possible duplicate/)
  assert.equal(p[0]!.approved, false)
  assert.equal(p[0]!.payment.Line?.[0]?.LinkedTxn[0]?.TxnId, 'i1')

  // Row 2: ready; the trip name picks invoice 7002 over the older 7001.
  assert.equal(p[1]!.status, 'ready', p[1]!.reasons.join('; '))
  assert.equal(p[1]!.approved, true)
  assert.deepEqual(p[1]!.applyTo.map(a => a.docNumber), ['7002'])
  assert.equal(p[1]!.payment.TxnDate, '2026-09-29')
  assert.equal(p[1]!.payment.PaymentMethodRef?.value, 'm1')

  // Row 3: method not written -> review; no invoices -> customer credit, no Line.
  assert.equal(p[2]!.status, 'review')
  assert.match(p[2]!.reasons.join(' '), /payment method not written/)
  assert.equal(p[2]!.payment.Line, undefined)
  assert.equal(p[2]!.unapplied, 300)

  // Row 4: nobody named Morgan in QuickBooks -> review with an empty CustomerRef the user must fill.
  assert.equal(p[3]!.customer, null)
  assert.equal(p[3]!.status, 'review')
  assert.equal(p[3]!.payment.CustomerRef.value, '')
  assert.equal(p[3]!.payment.PaymentRefNum, '2583')

  // Row 5: low confidence -> review; invoice 7001 still has $100 left, remainder $150 stays as credit.
  assert.equal(p[4]!.status, 'review')
  assert.match(p[4]!.reasons.join(' '), /low confidence.*250 or 280/)
  assert.deepEqual(p[4]!.applyTo.map(a => [a.docNumber, a.amount]), [['7001', 100]])
  assert.equal(p[4]!.unapplied, 150)
  assert.equal(p[4]!.payment.PrivateNote, 'Europe - ledger 9/28 row 5')
})
