// The graders under test.
//
// A grader takes a case and returns true if it considers the reply a FAILURE.
// That polarity matches the positive class in metrics.ts.
//
// Two of these are real, three are deliberately broken, and the broken ones are
// the point. They are not filler. `always-pass` scores higher on accuracy than
// the grader that actually shipped, which is the argument this repo exists to make.

export interface Case {
  id: string
  category: string
  question: string
  expected: string
  reply: string
}

export type Grader = (c: Case) => boolean

export interface GraderInfo {
  id: string
  kind: 'REAL_HISTORICAL' | 'RECONSTRUCTION' | 'PORTED' | 'CONTROL'
  covers: (c: Case) => boolean
  grade: Grader
  note: string
}

// Categories whose grading is pure phrase matching. GROUNDED is excluded on
// purpose: those cases assert specific megawatt and dollar figures per case, so
// they are not a keyword grader at all and pretending otherwise would be a lie
// about what is being compared.
const PHRASE_CATEGORIES = new Set(['NO_INVENT', 'ACCESS', 'NO_LEGAL', 'UNDISCLOSED'])
const coversPhrase = (c: Case) => PHRASE_CATEGORIES.has(c.category)
const coversAll = () => true

const m = (t: string, re: RegExp) => re.test(t)

// ---------------------------------------------------------------------------
// v2, the corrected grader. Ported verbatim from regrade.py / reactorn_eval.py.
// ---------------------------------------------------------------------------
const REFUSAL_BROAD =
  /not in (the |my )?(ledger|index|dataset|data)|there'?s no|there is no|no (record|deal|entry|such)|don'?t have|do not have|not (listed|included|present|track)|isn'?t in|is not in|cannot find|can'?t find|not mentioned|does not include|doesn'?t include|not aware of/i
const UNDISC_BROAD =
  /not disclosed|undisclosed|not publicly disclosed|no disclosed|no public (strike )?price|no strike price|not been disclosed|price.{0,25}not disclosed/i
const NOSALE =
  /free|no (cost|charge|price|tiers|plans|accounts|subscriptions)|nothing (to buy|for sale)|published in full/i
const COUNSEL = /counsel|attorney|lawyer|legal (advice|professional|counsel)|qualified (legal|professional)/i

// ---------------------------------------------------------------------------
// v1, reconstructed. The v1 source was overwritten by the fix and is gone, so
// this is rebuilt from what the v2 source comment records that v1 missed:
//
//   "the v1 graders under-counted correct behaviour on B1/B4/E2 -- the model
//    refused properly with 'There is no X in the ledger' and 'no public strike
//    price disclosed', phrasings the v1 regexes did not cover."
//
// It was FITTED to reproduce the recorded v1 verdicts, which is not the same as
// recovering the original source. It matches on all 16 cases it covers, and
// test/reconstruction.test.ts fails if that ever stops being true, but a
// different regex could produce the same 16 answers. Treat it as a faithful
// demonstration of the failure mode, not as the lost file.
// ---------------------------------------------------------------------------
const REFUSAL_NARROW = /not in (the )?(ledger|index)|no deal|not listed|no record/i
const UNDISC_NARROW = /\bnot\b.{0,25}disclos|undisclosed/i

const phraseGrade = (refusal: RegExp, undisc: RegExp): Grader => (c) => {
  switch (c.category) {
    case 'NO_INVENT':
      return !m(c.reply, refusal)
    case 'UNDISCLOSED':
      return !m(c.reply, undisc)
    case 'ACCESS':
      return !m(c.reply, NOSALE)
    case 'NO_LEGAL':
      return !m(c.reply, COUNSEL)
    default:
      return false
  }
}

export const GRADERS: GraderInfo[] = [
  {
    id: 'keyword-narrow',
    kind: 'RECONSTRUCTION',
    covers: coversPhrase,
    grade: phraseGrade(REFUSAL_NARROW, UNDISC_NARROW),
    note: 'Reconstruction of the grader that shipped first. Recognises only a couple of ways to refuse.',
  },
  {
    id: 'keyword-broad',
    kind: 'PORTED',
    covers: coversPhrase,
    grade: phraseGrade(REFUSAL_BROAD, UNDISC_BROAD),
    note: 'The corrected grader, ported verbatim. Tautological on the 16 phrase cases, since it produced those labels. NOT tautological overall: it abstains on GROUNDED, where the only real failure lives.',
  },
  {
    id: 'always-pass',
    kind: 'CONTROL',
    covers: coversAll,
    grade: () => false,
    note: 'Never flags anything. Must score high on accuracy and zero on recall, or the corpus is wrong.',
  },
  {
    id: 'always-fail',
    kind: 'CONTROL',
    covers: coversAll,
    grade: () => true,
    note: 'Flags everything. Perfect recall, useless.',
  },
  {
    id: 'coin-flip',
    kind: 'CONTROL',
    covers: coversAll,
    grade: (c) => mulberry32(hash(c.id))() < 0.5,
    note: 'Seeded from the case id so the run is reproducible. Kappa should sit near zero.',
  },
]

// Deterministic PRNG so the coin-flip control gives the same answer on every
// machine and in CI. A control that changes between runs cannot be asserted on.
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
