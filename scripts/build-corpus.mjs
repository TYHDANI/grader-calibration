// Derives data/ from the published reactorn-copilot-eval results.
// Nothing in data/ is hand-written. Re-run this to rebuild it.
//
//   node scripts/build-corpus.mjs
//
// Source of truth is the public repo, not a local path, so the provenance of
// every case is a URL anyone can fetch.
import { writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

const BASE = 'https://raw.githubusercontent.com/TYHDANI/reactorn-copilot-eval/main/results'
const SRC = {
  v1: `${BASE}/reactorn_eval_results_v1.json`,
  v2: `${BASE}/reactorn_eval_FINAL_regraded.json`,
}

const sha = (s) => createHash('sha256').update(s).digest('hex')

const get = async (url) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`)
  const text = await r.text()
  return { json: JSON.parse(text), sha256: sha(text) }
}

const v1 = await get(SRC.v1)
const v2 = await get(SRC.v2)

const r1 = Object.fromEntries(v1.json.results.map((c) => [c.id, c]))
const r2 = Object.fromEntries(v2.json.results.map((c) => [c.id, c]))
const ids = Object.keys(r2).sort()

if (ids.length !== Object.keys(r1).length) throw new Error('the two runs cover different cases')

mkdirSync('data', { recursive: true })

// The cases. The reply text is what any grader actually reads.
writeFileSync('data/cases.json', JSON.stringify({
  source: 'github.com/TYHDANI/reactorn-copilot-eval',
  endpoint: v2.json.endpoint,
  model: v2.json.model,
  run_started: v2.json.started,
  provenance: 'REAL_TRACE',
  note: 'Real replies from a live endpoint. Not synthetic, not generated for this repo.',
  cases: ids.map((id) => ({
    id,
    category: r2[id].category,
    question: r2[id].question,
    expected: r2[id].expected,
    reply: r2[id].reply,
  })),
}, null, 2) + '\n')

// The labels. These are the hand-adjudicated verdicts, which is the thing every
// grader below is scored against.
writeFileSync('data/labels.json', JSON.stringify({
  label_source: 'HAND_ADJUDICATED',
  labeller: 'Tyh McLean (sole labeller, see LIMITATIONS.md)',
  adjudicated_on: '2026-08-14',
  method: 'Every case the v1 grader failed was read in full before the number was reported.',
  positive_class: 'is_real_failure',
  labels: Object.fromEntries(ids.map((id) => [id, { is_real_failure: !r2[id].passed }])),
}, null, 2) + '\n')

// The historical grader's actual output. Real data, not a reconstruction.
writeFileSync('data/verdicts-historical-v1.json', JSON.stringify({
  grader_id: 'historical-v1',
  kind: 'REAL_HISTORICAL_OUTPUT',
  note: 'The verdicts the original keyword grader actually produced on 2026-08-14. '
      + 'Its source was replaced by the correction and is not recoverable, so this repo '
      + 'scores its recorded output rather than re-running it.',
  verdicts: Object.fromEntries(ids.map((id) => [id, { flagged_failure: !r1[id].passed }])),
}, null, 2) + '\n')

writeFileSync('data/PROVENANCE.md', `# Provenance

Everything in \`data/\` is built by \`scripts/build-corpus.mjs\` from two files published in
[reactorn-copilot-eval](https://github.com/TYHDANI/reactorn-copilot-eval). None of it is typed by hand.

| Source | sha256 |
|---|---|
| \`${SRC.v1}\` | \`${v1.sha256}\` |
| \`${SRC.v2}\` | \`${v2.sha256}\` |

Fetched ${new Date().toISOString().slice(0, 10)}.

The 24 replies are **real**. They came from \`${v2.json.endpoint}\`
running ${v2.json.model}, on ${v2.json.started.slice(0, 10)}.
No reply in this repo was written for this repo.
`)

console.log(`data/cases.json                 ${ids.length} cases`)
console.log(`data/labels.json                ${Object.values(r2).filter((c) => !c.passed).length} real failures`)
console.log(`data/verdicts-historical-v1.json ${Object.values(r1).filter((c) => !c.passed).length} flagged`)
console.log('data/PROVENANCE.md')
