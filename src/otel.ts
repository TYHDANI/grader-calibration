// Emits each grader verdict as an OpenTelemetry `gen_ai.evaluation.result` event.
//
// Attribute names come from data/semconv-contract.json, which is derived from the
// vendored spec by scripts/extract-semconv.mjs. Nothing here is typed from memory,
// because attribute names typed from memory are how instrumentation quietly stops
// being queryable.
//
// This module writes plain objects. It deliberately does not depend on the OTel
// SDK: the claim being made is about the shape of the payload, and a reviewer can
// check that without installing anything.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))

export interface SemconvAttribute {
  name: string
  requirement_level: string
  type: string | null
}
export interface SemconvContract {
  event: string
  stability: string
  warning: string | null
  pinned_sha: string
  attributes: SemconvAttribute[]
}

export const loadContract = (): SemconvContract =>
  JSON.parse(readFileSync(join(root, 'data/semconv-contract.json'), 'utf8'))

export interface EvaluationEvent {
  name: string
  attributes: Record<string, string | number | boolean>
}

export interface Verdict {
  caseId: string
  graderId: string
  flaggedFailure: boolean
  explanation?: string
}

/**
 * A conformant event.
 *
 * score.value is 1 for a correct-looking output and 0 for one the grader flagged.
 * score.label carries "pass" or "fail", both of which are literal examples in the
 * spec's own definition of the attribute, so this is not an invented vocabulary.
 */
export const emitEvaluationEvent = (v: Verdict): EvaluationEvent => ({
  name: 'gen_ai.evaluation.result',
  attributes: {
    'gen_ai.evaluation.name': v.graderId,
    'gen_ai.evaluation.score.value': v.flaggedFailure ? 0 : 1,
    'gen_ai.evaluation.score.label': v.flaggedFailure ? 'fail' : 'pass',
    ...(v.explanation ? { 'gen_ai.evaluation.explanation': v.explanation } : {}),
    'gen_ai.response.id': v.caseId,
  },
})

/**
 * The control. This is what instrumentation looks like when it is written from
 * intuition rather than from the spec, and every name in it is plausible.
 *
 * test/otel.test.ts asserts that this FAILS conformance. If it ever passes, either
 * the checker has stopped checking or the spec has changed underneath us, and both
 * of those should break the build rather than pass quietly.
 */
export const emitNaiveEvent = (v: Verdict): EvaluationEvent => ({
  name: 'gen_ai.evaluation',
  attributes: {
    'gen_ai.eval.name': v.graderId,
    score: v.flaggedFailure ? 0 : 1,
    'evaluation.label': v.flaggedFailure ? 'fail' : 'pass',
    response_id: v.caseId,
  },
})

export interface ConformanceProblem {
  kind: 'wrong_event_name' | 'missing_required' | 'wrong_type' | 'unknown_attribute'
  detail: string
}

const typeOk = (declared: string | null, value: unknown): boolean => {
  if (declared === null) return true
  if (declared === 'string') return typeof value === 'string'
  if (declared === 'double' || declared === 'int') return typeof value === 'number'
  if (declared === 'boolean') return typeof value === 'boolean'
  return true
}

/** Validates an event against the derived contract. Returns every problem found. */
export const checkConformance = (
  event: EvaluationEvent,
  contract: SemconvContract = loadContract(),
): ConformanceProblem[] => {
  const problems: ConformanceProblem[] = []

  if (event.name !== contract.event) {
    problems.push({
      kind: 'wrong_event_name',
      detail: `event name is "${event.name}", the spec says "${contract.event}"`,
    })
  }

  const known = new Map(contract.attributes.map((a) => [a.name, a]))

  for (const a of contract.attributes) {
    if (a.requirement_level === 'required' && !(a.name in event.attributes)) {
      problems.push({ kind: 'missing_required', detail: `${a.name} is required and absent` })
    }
  }

  for (const [key, value] of Object.entries(event.attributes)) {
    const spec = known.get(key)
    if (!spec) {
      problems.push({ kind: 'unknown_attribute', detail: `"${key}" is not in the spec for this event` })
      continue
    }
    if (!typeOk(spec.type, value)) {
      problems.push({
        kind: 'wrong_type',
        detail: `${key} should be ${spec.type}, got ${typeof value}`,
      })
    }
  }

  return problems
}
