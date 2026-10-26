import { z } from 'zod'

export const PaymentMethod = z.enum([
  'zelle', 'cash', 'check', 'credit_card', 'paypal', 'money_order', 'unknown',
])

export const LedgerEntry = z.object({
  row: z.number().int().describe('1-based row number on this page, counted top to bottom'),
  date_raw: z.string().nullable().describe('The date exactly as written on this row, e.g. "9/28". Null if this row has no date written on it.'),
  date: z.string().nullable().describe('ISO date YYYY-MM-DD. Use the assumed year from the message when the ledger omits the year. If the row has no date, carry down the nearest date written above it. Null only if no date exists above either.'),
  date_inherited: z.boolean().describe('True when the date was carried down from an earlier row'),
  name_raw: z.string().describe('Customer name exactly as written'),
  first_name: z.string(),
  last_name: z.string(),
  trip: z.string().nullable().describe('The trip or event the money is for, as written: "Lobsterfest", "Europe", "Obama", "Diana Ross", "Panama". Null if blank.'),
  amount: z.number().describe('Dollar amount as a number'),
  method: PaymentMethod,
  method_inherited: z.boolean().describe('True when the method came from a ditto mark meaning "same as the row above"'),
  reference: z.string().nullable().describe('Check number for checks ("CK 2583" -> "2583"), card digits for cards ("CC 4976" -> "4976"), otherwise null. A reference never carries down with a ditto mark.'),
  confidence: z.enum(['high', 'medium', 'low']).describe('low when any of the name, amount, date or method had to be guessed'),
  notes: z.string().nullable().describe('Anything a bookkeeper should know: crossed out, two names on one row, two trips on one row, digit unreadable, row cut off by the photo edge'),
})

export const LedgerPage = z.object({
  page_summary: z.string().describe('One line: what this page is and the date range it covers'),
  entries: z.array(LedgerEntry),
})

export type LedgerEntry = z.infer<typeof LedgerEntry>
export type LedgerPage = z.infer<typeof LedgerPage>
