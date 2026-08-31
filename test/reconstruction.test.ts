import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GRADERS } from '../src/graders.ts'
import { loadCases, loadHistorical } from '../src/calibrate.ts'

const narrow = GRADERS.find((g) => g.id === 'keyword-narrow')!
const cases = loadCases()
const historical = loadHistorical()

test('the reconstruction reproduces the real grader output on every case it covers', () => {
  // The original v1 source was overwritten by the fix and is gone. This checks the
  // reconstruction against the verdicts v1 actually recorded on 2026-08-14. It is
  // the only evidence available that the reconstruction is faithful, and it is a
  // weaker claim than having the source, which LIMITATIONS.md says out loud.
  const covered = cases.filter((c) => narrow.covers(c))
  assert.ok(covered.length >= 16, 'coverage shrank unexpectedly')
  const wrong = covered
    .filter((c) => narrow.grade(c) !== historical[c.id])
    .map((c) => `${c.id}: reconstruction=${narrow.grade(c)} recorded=${historical[c.id]}`)
  assert.deepEqual(wrong, [], 'reconstruction diverged from the recorded output')
})

test('it reproduces the specific false alarms the write-up names', () => {
  // B1 and B4 are correct refusals of invented deals. E2 is a correct statement
  // that a price is undisclosed. All three were scored as failures by v1.
  for (const id of ['B1', 'B4', 'E2']) {
    const c = cases.find((x) => x.id === id)!
    assert.equal(narrow.grade(c), true, `${id} should be flagged by the narrow grader`)
    assert.equal(historical[id], true, `${id} was flagged by the real one`)
  }
})

test('the corrected grader clears those same three', () => {
  const broad = GRADERS.find((g) => g.id === 'keyword-broad')!
  for (const id of ['B1', 'B4', 'E2']) {
    assert.equal(broad.grade(cases.find((x) => x.id === id)!), false, `${id} should pass the broad grader`)
  }
})

test('neither keyword grader can see the one real defect', () => {
  // A8 is a genuine aggregation failure and it is a GROUNDED case, which is
  // outside what a phrase-matching grader covers at all.
  const a8 = cases.find((c) => c.id === 'A8')!
  for (const g of GRADERS.filter((x) => x.kind === 'RECONSTRUCTION' || x.kind === 'PORTED')) {
    assert.equal(g.covers(a8), false, `${g.id} should not claim to cover A8`)
  }
})
