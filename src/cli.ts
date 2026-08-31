import { calibrate, loadCases, loadLabels, loadHistorical, type Row } from './calibrate.ts'
import { GRADERS } from './graders.ts'
import { emitEvaluationEvent, emitNaiveEvent, checkConformance, loadContract } from './otel.ts'

const BANNER = `
grader-calibration
24 real replies from a live LLM endpoint. The model is not what is being scored here.
The graders are. Positive class is "this case is a real failure".
`

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%`.padStart(7) : '     --')
const k = (x: number) => (Number.isFinite(x) ? x.toFixed(3).padStart(7) : '     --')
const pad = (s: unknown, n: number) => String(s ?? '').padEnd(n)

function table(rows: Row[]) {
  console.log(
    pad('GRADER', 17) + pad('KIND', 17) + '   ACC     PREC    RECALL   KAPPA   TP FP FN TN  ABSTAIN',
  )
  console.log('-'.repeat(96))
  for (const r of rows) {
    console.log(
      pad(r.id, 17) + pad(r.kind, 17) +
      pct(r.accuracy) + pct(r.precision) + pct(r.recall) + k(r.kappa) +
      `  ${String(r.c.tp).padStart(2)} ${String(r.c.fp).padStart(2)} ${String(r.c.fn).padStart(2)} ${String(r.c.tn).padStart(2)}` +
      `   ${r.abstained ? String(r.abstained).padStart(4) : '   .'}`,
    )
  }
}

function cmdReport() {
  const rows = calibrate()
  console.log(BANNER)
  table(rows)

  const best = [...rows].sort((a, b) => b.accuracy - a.accuracy)[0]
  const real = rows.find((r) => r.id === 'historical-v1')!
  const ci = real.accuracyCI

  console.log(`
Read the accuracy column, then read the kappa column.

The highest accuracy in this table belongs to ${best.id}, at ${pct(best.accuracy).trim()}.
${best.id === 'always-pass' ? 'It is one line of code that returns false and never catches anything.' : ''}
The grader that actually shipped scored ${pct(real.accuracy).trim()} accuracy, and of the ${real.c.tp + real.c.fp} cases
it called failures, ${real.c.tp} was real. Its precision was ${pct(real.precision).trim()}.

Accuracy is high for everything here because 23 of 24 cases genuinely pass. That
floor is what kappa subtracts out, which is why the two graders that cannot
possibly be useful both land on exactly 0.000 and two of the keyword graders land
below it.

ABSTAIN counts cases a grader has no rule for. Those are scored as passes, because
that is what a grader that abstains actually does to your numbers. A grader that
silently approves a third of your corpus can still post a good accuracy.

95% CI on the shipped grader's accuracy is ${pct(ci[0]).trim()} to ${pct(ci[1]).trim()}, on n=${real.n}.
Everything here rests on 24 cases labelled by one person. See LIMITATIONS.md.`)
}

function cmdCases() {
  const cases = loadCases()
  const labels = loadLabels()
  const hist = loadHistorical()
  console.log(BANNER)
  console.log('Cases where the shipped grader and the human disagreed:\n')
  let n = 0
  for (const c of cases) {
    if (hist[c.id] === labels[c.id]) continue
    n++
    const kind = hist[c.id] && !labels[c.id] ? 'FALSE ALARM' : 'MISSED IT'
    console.log(`  [${c.id}] ${c.category}   ${kind}`)
    console.log(`    Q  ${c.question}`)
    console.log(`    A  ${c.reply.slice(0, 150).replace(/\s+/g, ' ')}...`)
    console.log()
  }
  console.log(`${n} disagreements out of ${cases.length}.`)
  console.log('All of them are the grader failing to recognise a correct refusal, except A2,')
  console.log('which was graded too strictly against a band the model derived correctly.')
}

function cmdOtel() {
  const contract = loadContract()
  const cases = loadCases()
  const narrow = GRADERS.find((g) => g.id === 'keyword-narrow')!
  const sample = cases.find((c) => c.id === 'B1')!
  const v = { caseId: sample.id, graderId: narrow.id, flaggedFailure: narrow.grade(sample) }

  console.log(BANNER)
  console.log(`Event: ${contract.event}   stability: ${contract.stability}   spec @ ${contract.pinned_sha.slice(0, 12)}`)
  if (contract.warning) console.log(`\n! ${contract.warning}`)
  console.log('\nAttributes the spec defines for this event:')
  for (const a of contract.attributes) console.log(`  ${pad(a.requirement_level, 24)}${pad(a.name, 32)}${a.type ?? ''}`)

  const good = emitEvaluationEvent(v)
  const bad = emitNaiveEvent(v)
  console.log('\nConformant emitter:')
  console.log(JSON.stringify(good, null, 2).split('\n').map((l) => '  ' + l).join('\n'))
  console.log(`  -> ${checkConformance(good, contract).length} problems`)

  console.log('\nThe naive emitter committed as a control:')
  for (const p of checkConformance(bad, contract)) console.log(`  ${pad(p.kind, 20)} ${p.detail}`)
  console.log('\nBoth emitters would look fine in a code review. Only one is queryable.')
}

const [cmd] = process.argv.slice(2)
switch (cmd) {
  case 'report': cmdReport(); break
  case 'cases': cmdCases(); break
  case 'otel': cmdOtel(); break
  default:
    console.log(BANNER)
    console.log('  npm run report   score every grader against the human labels')
    console.log('  npm run cases    the cases where the shipped grader and the human disagreed')
    console.log('  npm run otel     emit the verdicts as OTel events and check them against the spec')
    console.log('  npm test         the controls must score badly, or the build fails')
}
