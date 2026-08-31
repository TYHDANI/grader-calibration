import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calibrate } from '../src/calibrate.ts'

const rows = calibrate()
const row = (id: string) => {
  const r = rows.find((x) => x.id === id)
  assert.ok(r, `no row for ${id}`)
  return r
}

test('the do-nothing grader beats every real grader on accuracy', () => {
  // This is the claim the whole repository exists to make. If a change to the
  // corpus or the labels ever makes it false, this test fails and the README
  // stops being true, which is the intended coupling.
  const alwaysPass = row('always-pass')
  const shipped = row('historical-v1')
  assert.ok(
    alwaysPass.accuracy > shipped.accuracy,
    `always-pass (${alwaysPass.accuracy}) should out-score the grader that shipped (${shipped.accuracy})`,
  )
  const highest = [...rows].sort((a, b) => b.accuracy - a.accuracy)[0]
  assert.equal(highest.id, 'always-pass', 'always-pass should top the accuracy column')
})

test('and it catches nothing, which accuracy does not show', () => {
  const r = row('always-pass')
  assert.equal(r.c.tp, 0)
  assert.equal(r.recall, 0)
  assert.ok(Number.isNaN(r.precision))
})

test('kappa correctly rates both degenerate controls as worthless', () => {
  assert.equal(row('always-pass').kappa, 0)
  assert.equal(row('always-fail').kappa, 0)
})

test('the coin flip lands near zero kappa', () => {
  const k = row('coin-flip').kappa
  assert.ok(Math.abs(k) < 0.25, `seeded coin flip kappa ${k} should sit near zero`)
})

test('the grader that shipped had precision far below its accuracy', () => {
  const r = row('historical-v1')
  assert.ok(r.accuracy > 0.8, 'accuracy looked fine')
  assert.ok(r.precision <= 0.25, 'precision did not')
  assert.ok(r.accuracy - r.precision > 0.5, 'the gap between the two is the finding')
})

test('every grader is scored on the same number of cases', () => {
  const ns = new Set(rows.map((r) => r.n))
  assert.equal(ns.size, 1, `graders scored on different denominators: ${[...ns]}`)
})

test('abstaining is counted and is not free', () => {
  // keyword-broad abstains on GROUNDED, which is where the only real failure is.
  // It therefore posts a better accuracy than the grader it replaced while still
  // never catching anything.
  const broad = row('keyword-broad')
  const shipped = row('historical-v1')
  assert.ok(broad.abstained > 0, 'keyword-broad should abstain somewhere')
  assert.ok(broad.accuracy > shipped.accuracy, 'and look like an improvement on accuracy')
  assert.equal(broad.c.tp, 0, 'while catching zero real failures')
  assert.ok(broad.kappa < 0, 'kappa should place it below chance')
})
