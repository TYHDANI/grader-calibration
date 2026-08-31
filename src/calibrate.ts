import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { GRADERS, type Case, type GraderInfo } from './graders.ts'
import {
  confusion, accuracy, precision, recall, specificity, f1, cohensKappa, wilson,
  type Confusion,
} from './metrics.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'))

export const loadCases = (): Case[] => read('data/cases.json').cases
export const loadLabels = (): Record<string, boolean> =>
  Object.fromEntries(
    Object.entries(read('data/labels.json').labels as Record<string, { is_real_failure: boolean }>)
      .map(([id, v]) => [id, v.is_real_failure]),
  )
export const loadHistorical = (): Record<string, boolean> =>
  Object.fromEntries(
    Object.entries(
      read('data/verdicts-historical-v1.json').verdicts as Record<string, { flagged_failure: boolean }>,
    ).map(([id, v]) => [id, v.flagged_failure]),
  )

export interface Row {
  id: string
  kind: string
  note: string
  c: Confusion
  n: number
  /** Cases this grader has no rule for. It passes them, which is not the same as approving them. */
  abstained: number
  accuracy: number
  precision: number
  recall: number
  specificity: number
  f1: number
  kappa: number
  accuracyCI: [number, number]
}

const buildRow = (
  id: string, kind: string, note: string,
  predictions: Record<string, boolean>, labels: Record<string, boolean>, abstained: number,
): Row => {
  const c = confusion(predictions, labels)
  const n = c.tp + c.fp + c.fn + c.tn
  return {
    id, kind, note, c, n, abstained,
    accuracy: accuracy(c),
    precision: precision(c),
    recall: recall(c),
    specificity: specificity(c),
    f1: f1(c),
    kappa: cohensKappa(c),
    accuracyCI: wilson(c.tp + c.tn, n),
  }
}

export const calibrate = (): Row[] => {
  const cases = loadCases()
  const labels = loadLabels()
  const rows: Row[] = []

  // The real recorded output of the grader that actually shipped. Not re-run,
  // not reconstructed: these are the verdicts it produced on 2026-08-14.
  rows.push(buildRow(
    'historical-v1', 'REAL_HISTORICAL',
    'The verdicts the original grader actually produced. Real data, not a re-run.',
    loadHistorical(), labels, 0,
  ))

  for (const g of GRADERS as GraderInfo[]) {
    const predictions: Record<string, boolean> = {}
    let abstained = 0
    for (const c of cases) {
      if (g.covers(c)) predictions[c.id] = g.grade(c)
      else { predictions[c.id] = false; abstained++ }
    }
    rows.push(buildRow(g.id, g.kind, g.note, predictions, labels, abstained))
  }
  return rows
}
