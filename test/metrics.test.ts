import { test } from 'node:test'
import assert from 'node:assert/strict'
import { confusion, accuracy, precision, recall, f1, cohensKappa, wilson } from '../src/metrics.ts'

test('confusion matrix counts each quadrant', () => {
  const c = confusion({ a: true, b: true, c: false, d: false }, { a: true, b: false, c: true, d: false })
  assert.deepEqual(c, { tp: 1, fp: 1, fn: 1, tn: 1 })
})

test('confusion refuses misaligned inputs rather than silently scoring a subset', () => {
  assert.throws(() => confusion({ a: true }, { a: true, b: false }), /same case ids/)
  assert.throws(() => confusion({ x: true }, { y: true }), /same case ids/)
})

test('kappa is zero for a grader that never flags anything', () => {
  // 23 pass, 1 fail, grader says pass to everything.
  assert.equal(cohensKappa({ tp: 0, fp: 0, fn: 1, tn: 23 }), 0)
})

test('kappa is zero for a grader that flags everything', () => {
  assert.equal(cohensKappa({ tp: 1, fp: 23, fn: 0, tn: 0 }), 0)
})

test('kappa is 1 for perfect agreement and negative for worse than chance', () => {
  assert.equal(cohensKappa({ tp: 5, fp: 0, fn: 0, tn: 5 }), 1)
  assert.ok(cohensKappa({ tp: 0, fp: 5, fn: 5, tn: 0 }) < 0)
})

test('kappa matches a hand-computed value', () => {
  // po = 20/24 = 0.83333, pe = (5*1 + 19*23)/576 = 0.767361
  // k  = (0.833333 - 0.767361) / (1 - 0.767361) = 0.283582...
  assert.ok(Math.abs(cohensKappa({ tp: 1, fp: 4, fn: 0, tn: 19 }) - 0.2835820895) < 1e-9)
})

test('precision and recall are NaN rather than 0 when undefined', () => {
  // Never flagged anything, so "of what it flagged, how much was right" has no answer.
  assert.ok(Number.isNaN(precision({ tp: 0, fp: 0, fn: 1, tn: 23 })))
  // No real failures existed, so recall has no answer.
  assert.ok(Number.isNaN(recall({ tp: 0, fp: 3, fn: 0, tn: 13 })))
  assert.ok(Number.isNaN(f1({ tp: 0, fp: 0, fn: 1, tn: 23 })))
})

test('accuracy stays high on an unbalanced corpus even when the grader is useless', () => {
  // This is the entire premise of the repo, asserted as arithmetic.
  const uselessButAccurate = accuracy({ tp: 0, fp: 0, fn: 1, tn: 23 })
  assert.ok(uselessButAccurate > 0.95)
  assert.equal(cohensKappa({ tp: 0, fp: 0, fn: 1, tn: 23 }), 0)
})

test('wilson interval brackets the estimate and stays inside [0,1]', () => {
  const [lo, hi] = wilson(20, 24)
  assert.ok(lo < 20 / 24 && hi > 20 / 24)
  assert.ok(lo >= 0 && hi <= 1)
  const [lo2, hi2] = wilson(24, 24)
  assert.ok(lo2 > 0.8 && hi2 === 1)
  // A wide interval on a small n is the point of including it.
  assert.ok(hi - lo > 0.2, 'n=24 should produce a visibly wide interval')
})
