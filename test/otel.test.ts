import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emitEvaluationEvent, emitNaiveEvent, checkConformance, loadContract } from '../src/otel.ts'
import { loadCases } from '../src/calibrate.ts'
import { GRADERS } from '../src/graders.ts'

const contract = loadContract()
const v = { caseId: 'B1', graderId: 'keyword-narrow', flaggedFailure: true, explanation: 'x' }

test('the contract was derived from the vendored spec, not typed here', () => {
  assert.equal(contract.event, 'gen_ai.evaluation.result')
  assert.match(contract.pinned_sha, /^[0-9a-f]{40}$/)
  const required = contract.attributes.filter((a) => a.requirement_level === 'required')
  assert.deepEqual(required.map((a) => a.name), ['gen_ai.evaluation.name'])
})

test('the spec marks this event as unstable and we say so', () => {
  assert.equal(contract.stability, 'development')
  assert.ok(contract.warning, 'an unstable event must carry a warning in the contract')
})

test('the conformant emitter produces no problems', () => {
  assert.deepEqual(checkConformance(emitEvaluationEvent(v), contract), [])
})

test('the naive emitter MUST fail, or the checker is not checking', () => {
  const problems = checkConformance(emitNaiveEvent(v), contract)
  assert.ok(problems.length > 0, 'a control that passes is not a control')
  assert.ok(problems.some((p) => p.kind === 'wrong_event_name'))
  assert.ok(problems.some((p) => p.kind === 'missing_required'))
  assert.ok(problems.some((p) => p.kind === 'unknown_attribute'))
})

test('the checker catches a wrong type, not just a wrong name', () => {
  const bent = emitEvaluationEvent(v)
  bent.attributes['gen_ai.evaluation.score.value'] = 'zero'
  const problems = checkConformance(bent, contract)
  assert.ok(problems.some((p) => p.kind === 'wrong_type'), 'a string score should be rejected')
})

test('every case emits a conformant event for every grader', () => {
  const cases = loadCases()
  for (const g of GRADERS) {
    for (const c of cases) {
      if (!g.covers(c)) continue
      const ev = emitEvaluationEvent({ caseId: c.id, graderId: g.id, flaggedFailure: g.grade(c) })
      assert.deepEqual(checkConformance(ev, contract), [], `${g.id} on ${c.id}`)
    }
  }
})
