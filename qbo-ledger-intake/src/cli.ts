import { parseArgs } from 'node:util'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { extractLedger, type ExtractedPage } from './extract.ts'
import { QboClient, configFromEnv } from './qbo.ts'
import { connect } from './auth.ts'
import { buildProposals, type Proposal, type ProposalFile } from './propose.ts'

const USAGE = `qbo-ledger-intake

  node src/cli.ts auth                      connect to a QuickBooks company (one time)
  node src/cli.ts review <photo...>         read the photo(s) with Claude, match against QuickBooks,
                                            write out/proposal-<time>.json and print the table
  node src/cli.ts post <proposal.json>      send every approved row to QuickBooks as a Payment
  node src/cli.ts extract <photo...>        Claude only (no QuickBooks): write the raw rows as JSON
  node src/cli.ts propose <extract.json>    QuickBooks only: build a proposal from an extract file

Options:
  --year 2026        year to assume for dates written without one (default: LEDGER_YEAR or this year)
  --out <file>       where to write the JSON
  --dry-run          with post: print what would be sent, send nothing
  --model <id>       Claude model (default claude-opus-5-5)
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    year: { type: 'string' }, out: { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
    model: { type: 'string' }, help: { type: 'boolean', short: 'h', default: false },
  },
})
const [cmd, ...args] = positionals
const year = Number(values.year ?? process.env.LEDGER_YEAR ?? new Date().getFullYear())
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const money = (n: number) => `$${n.toFixed(2)}`
const pad = (s: unknown, n: number) => String(s ?? '').slice(0, n).padEnd(n)

function printTable(proposals: Proposal[]) {
  console.log()
  console.log(pad('ROW', 5) + pad('STATUS', 8) + pad('DATE', 11) + pad('LEDGER NAME', 22) + pad('QBO CUSTOMER', 24) + pad('AMOUNT', 10) + pad('METHOD', 12) + 'APPLY TO')
  console.log('-'.repeat(118))
  for (const p of proposals) {
    const apply = p.applyTo.length ? p.applyTo.map(a => `#${a.docNumber || a.invoiceId} ${money(a.amount)}`).join(', ') : 'credit'
    const method = p.paymentMethod ? p.paymentMethod.name + (p.entry.reference ? ` ${p.entry.reference}` : '') : p.entry.method
    console.log(
      pad(p.row, 5) + pad(p.status.toUpperCase(), 8) + pad(p.entry.date ?? '?', 11) + pad(p.entry.name_raw, 22)
      + pad(p.customer ? `${p.customer.displayName} (${p.customer.score})` : '-- none --', 24)
      + pad(money(p.entry.amount), 10) + pad(method, 12) + apply,
    )
    for (const r of p.reasons) console.log(`${' '.repeat(5)}  ! ${r}`)
  }
  const n = (s: Proposal['status']) => proposals.filter(p => p.status === s).length
  console.log(`\n${proposals.length} rows: ${n('ready')} ready, ${n('review')} need review, ${n('skip')} skipped`)
}

async function qboClient() {
  const qbo = new QboClient(configFromEnv())
  return qbo
}

async function doReview(photos: string[], pages?: ExtractedPage[]) {
  const qbo = await qboClient()
  const [info, customers, methods] = await Promise.all([qbo.companyInfo(), qbo.listCustomers(), qbo.listPaymentMethods()])
  console.error(`Connected to ${info.CompanyInfo.CompanyName} (${qbo.cfg.env}): ${customers.length} customers, ${methods.length} payment methods`)
  if (!pages) {
    console.error(`Reading ${photos.length} photo(s) with Claude...`)
    pages = await extractLedger(photos, { year, model: values.model, knownCustomers: customers.map(c => c.DisplayName) })
    for (const p of pages) console.error(`  ${p.photo}: ${p.page.entries.length} rows (${p.usage.input} in / ${p.usage.output} out tokens, ${p.usage.cacheRead} cached)`)
  }
  const proposals = await buildProposals(qbo, pages, { customers, methods, depositAccountId: qbo.cfg.depositAccountId })
  const file: ProposalFile = {
    createdAt: new Date().toISOString(), env: qbo.cfg.env, companyName: info.CompanyInfo.CompanyName,
    pages: pages.map(p => ({ photo: p.photo, page_summary: p.page.page_summary })),
    proposals,
  }
  mkdirSync('out', { recursive: true })
  const outPath = values.out ?? `out/proposal-${stamp()}.json`
  writeFileSync(outPath, JSON.stringify(file, null, 2) + '\n')
  printTable(proposals)
  console.log(`\nWrote ${outPath}`)
  console.log(`Check the REVIEW rows, fix customer.id / payment fields in the JSON and set "approved": true for the ones to post, then:\n  node src/cli.ts post ${outPath}`)
}

async function doPost(path: string) {
  const file = JSON.parse(readFileSync(path, 'utf8')) as ProposalFile
  const qbo = await qboClient()
  if (file.env !== qbo.cfg.env) throw new Error(`Proposal was built against ${file.env} but QBO_ENV is ${qbo.cfg.env}`)
  const todo = file.proposals.filter(p => p.approved && p.status !== 'skip' && !p.result)
  if (!todo.length) { console.log('Nothing approved and unposted in this file.'); return }
  console.log(`${values['dry-run'] ? 'DRY RUN: would post' : 'Posting'} ${todo.length} payment(s) to ${file.companyName} (${qbo.cfg.env})`)
  let posted = 0, failed = 0
  for (const p of todo) {
    const label = `row ${p.row} ${p.entry.name_raw} ${money(p.entry.amount)}`
    if (!p.payment.CustomerRef.value) {
      console.log(`  SKIP ${label}: no customer id (set payment.CustomerRef.value)`)
      continue
    }
    if (values['dry-run']) { console.log(`  ${label}\n    ${JSON.stringify(p.payment)}`); continue }
    try {
      const res = await qbo.createPayment(p.payment)
      p.result = { paymentId: res.Id, postedAt: new Date().toISOString() }
      posted++
      console.log(`  OK   ${label} -> Payment ${res.Id}`)
    } catch (e) {
      p.result = { error: String(e), at: new Date().toISOString() }
      failed++
      console.log(`  FAIL ${label}: ${String(e).slice(0, 300)}`)
    }
    // Save after every row so a crash never leads to a double post on re-run.
    writeFileSync(path, JSON.stringify(file, null, 2) + '\n')
  }
  if (!values['dry-run']) console.log(`\n${posted} posted, ${failed} failed. Results saved into ${path}.`)
}

async function main() {
  if (values.help || !cmd) { console.log(USAGE); return }
  switch (cmd) {
    case 'auth': {
      await connect(await qboClient())
      return
    }
    case 'review': {
      if (!args.length) throw new Error('review needs at least one photo path')
      await doReview(args)
      return
    }
    case 'extract': {
      if (!args.length) throw new Error('extract needs at least one photo path')
      const pages = await extractLedger(args, { year, model: values.model })
      mkdirSync('out', { recursive: true })
      const outPath = values.out ?? `out/extract-${stamp()}.json`
      writeFileSync(outPath, JSON.stringify(pages, null, 2) + '\n')
      for (const p of pages) {
        console.log(`\n${p.photo}: ${p.page.page_summary}`)
        for (const e of p.page.entries) {
          console.log(`  ${pad(e.row, 3)} ${pad(e.date ?? '?', 11)} ${pad(e.name_raw, 22)} ${pad(e.trip ?? '', 16)} ${pad(money(e.amount), 10)} ${e.method}${e.reference ? ' ' + e.reference : ''}${e.method_inherited ? ' (ditto)' : ''} [${e.confidence}]${e.notes ? '  ' + e.notes : ''}`)
        }
      }
      console.log(`\nWrote ${outPath}`)
      return
    }
    case 'propose': {
      const pages = JSON.parse(readFileSync(args[0] ?? '', 'utf8')) as ExtractedPage[]
      await doReview(pages.map(p => p.photo), pages)
      return
    }
    case 'post': {
      if (!args[0]) throw new Error('post needs a proposal JSON path')
      await doPost(args[0])
      return
    }
    default:
      console.log(USAGE)
      process.exitCode = 1
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
