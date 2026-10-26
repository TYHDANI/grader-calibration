import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { LedgerPage } from './schema.ts'

export const DEFAULT_MODEL = 'claude-opus-5-5'

const MEDIA: Record<string, 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
}

export const SYSTEM_RULES = `You are a bookkeeper's assistant for a small tour company. You read a photo of a handwritten payments ledger and transcribe every row exactly as a bookkeeper would, so the rows can be entered into QuickBooks.

Ledger layout, left to right: date (usually "m/d" with no year, and often written only on the first row of a day), customer name (first name then last name), the trip or event the money is for, the dollar amount, the payment method.

Payment method conventions:
- "Zelle" -> zelle. "cash" -> cash. "PayPal" -> paypal. "M.O." -> money_order.
- "CK 2583", "ck 103", "CR 5545" -> check, reference "2583" / "103" / "5545".
- "CC 4976", "cc 0485" -> credit_card, reference "4976" / "0485".
- A ditto mark in the method column (", 〃, a tick, a short vertical stroke, or a single slanted stroke) means the same method as the row directly above. Carry it down and set method_inherited true. The reference number does NOT carry down.
- A blank method column with no mark at all -> unknown.

Rules:
- One entry per ledger row, in order, top to bottom. Include rows partly cut off by the photo edge and say so in notes. Never invent rows and never merge two rows.
- Highlighter colour (pink, green, yellow) is not data. Ignore it.
- Amounts are whole dollars unless cents are clearly written.
- Dates: use the assumed year from the message when the year is not written. A row with no date inherits the nearest date above it (date_inherited true).
- Names: split into first_name and last_name as written. A row with two names stacked on it: name_raw holds both, first_name/last_name hold the first person, notes explains.
- If a known-customer list is provided, prefer that spelling when the handwriting plausibly matches a listed name; otherwise transcribe what is written.
- Set confidence low for anything you had to guess: an ambiguous digit, a name you could not read, a mark that could be either a ditto or something else.`

export type ExtractOptions = {
  year: number
  model?: string
  /** Display names already in QuickBooks, used as a spelling hint. */
  knownCustomers?: string[]
  client?: Anthropic
}

export type ExtractedPage = { photo: string; page: LedgerPage; usage: { input: number; output: number; cacheRead: number } }

export async function extractLedgerPage(photoPath: string, opts: ExtractOptions): Promise<ExtractedPage> {
  const client = opts.client ?? new Anthropic()
  const mediaType = MEDIA[extname(photoPath).toLowerCase()]
  if (!mediaType) throw new Error(`Unsupported image type: ${photoPath} (use jpg, png, webp or gif)`)
  const data = readFileSync(photoPath).toString('base64')

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: SYSTEM_RULES, cache_control: { type: 'ephemeral' } },
  ]
  if (opts.knownCustomers?.length) {
    system.push({
      type: 'text',
      text: `Known customers in QuickBooks (one per line, "Last, First" or "First Last"):\n${opts.knownCustomers.join('\n')}`,
      cache_control: { type: 'ephemeral' },
    })
  }

  const response = await client.beta.messages.parse({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'high', format: betaZodOutputFormat(LedgerPage) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: `Assumed year for dates with no year: ${opts.year}. Transcribe every row on this page.` },
      ],
    }],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude declined to read ${photoPath}: ${response.stop_details?.explanation ?? 'no explanation'}`)
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Output cut off reading ${photoPath}; the page may have too many rows for one call`)
  }
  if (!response.parsed_output) {
    throw new Error(`Could not parse Claude's output for ${photoPath}`)
  }
  return {
    photo: photoPath,
    page: response.parsed_output,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
    },
  }
}

export async function extractLedger(photoPaths: string[], opts: ExtractOptions): Promise<ExtractedPage[]> {
  const client = opts.client ?? new Anthropic()
  const pages: ExtractedPage[] = []
  for (const photo of photoPaths) pages.push(await extractLedgerPage(photo, { ...opts, client }))
  return pages
}
