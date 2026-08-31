// Confusion-matrix statistics for scoring a grader against human labels.
//
// The positive class is deliberately "this case is a real failure", because that
// is the only judgement a grader exists to make. Getting the passes right is
// free on a corpus where almost everything passes.

export interface Confusion {
  tp: number // grader flagged it, and it really was a failure
  fp: number // grader flagged it, and the output was fine
  fn: number // grader let it through, and it really was a failure
  tn: number // grader let it through, and the output was fine
}

export const total = (c: Confusion): number => c.tp + c.fp + c.fn + c.tn

/** Share of all cases the grader got right. The number that flatters. */
export const accuracy = (c: Confusion): number => (c.tp + c.tn) / total(c)

/** Of everything the grader called a failure, how much really was. NaN if it never flagged. */
export const precision = (c: Confusion): number => (c.tp + c.fp === 0 ? NaN : c.tp / (c.tp + c.fp))

/** Of the real failures, how many it caught. NaN if there were none to catch. */
export const recall = (c: Confusion): number => (c.tp + c.fn === 0 ? NaN : c.tp / (c.tp + c.fn))

/** Of the genuinely fine cases, how many it correctly left alone. */
export const specificity = (c: Confusion): number =>
  c.tn + c.fp === 0 ? NaN : c.tn / (c.tn + c.fp)

export const f1 = (c: Confusion): number => {
  const p = precision(c)
  const r = recall(c)
  if (!Number.isFinite(p) || !Number.isFinite(r) || p + r === 0) return NaN
  return (2 * p * r) / (p + r)
}

/**
 * Cohen's kappa. Agreement corrected for the agreement you would get by chance.
 *
 * This is the whole point of the repo. On a corpus where 23 of 24 cases pass,
 * chance agreement is enormous, so accuracy stays high no matter what the grader
 * does. Kappa subtracts that floor out. A grader that always says PASS and one
 * that always says FAIL both score exactly 0 here, which is correct, and neither
 * is visible in the accuracy column.
 *
 * Returns NaN when chance agreement is 1, where the statistic is undefined.
 */
export const cohensKappa = (c: Confusion): number => {
  const n = total(c)
  if (n === 0) return NaN
  const po = accuracy(c)
  const pe = ((c.tp + c.fp) * (c.tp + c.fn) + (c.fn + c.tn) * (c.fp + c.tn)) / (n * n)
  if (1 - pe === 0) return NaN
  return (po - pe) / (1 - pe)
}

/**
 * Wilson score interval for a binomial proportion.
 *
 * Included because n here is 24. A point estimate off 24 cases invites more
 * confidence than it has earned, so every rate in the report carries one.
 * Wilson rather than normal-approximation because it stays inside [0,1] and
 * behaves at the extremes, which is where several of these land.
 */
export const wilson = (successes: number, n: number, z = 1.96): [number, number] => {
  if (n === 0) return [NaN, NaN]
  const p = successes / n
  const d = 1 + (z * z) / n
  const centre = p + (z * z) / (2 * n)
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, (centre - spread) / d), Math.min(1, (centre + spread) / d)]
}

/** Build the matrix from aligned predictions and labels. Throws on any mismatch. */
export const confusion = (
  predictions: Record<string, boolean>,
  labels: Record<string, boolean>,
): Confusion => {
  const ids = Object.keys(labels).sort()
  const predIds = Object.keys(predictions).sort()
  if (ids.length !== predIds.length || ids.some((id, i) => id !== predIds[i])) {
    throw new Error('predictions and labels must cover exactly the same case ids')
  }
  const c: Confusion = { tp: 0, fp: 0, fn: 0, tn: 0 }
  for (const id of ids) {
    const flagged = predictions[id]
    const real = labels[id]
    if (flagged && real) c.tp++
    else if (flagged && !real) c.fp++
    else if (!flagged && real) c.fn++
    else c.tn++
  }
  return c
}
