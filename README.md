# grader-calibration

An LLM eval told me my system scored 79%. The real number was 96%. The entire gap was the grader.

This repo puts the **grader** on the stand instead of the model. It takes 24 real replies from a
live LLM endpoint, the verdicts two different graders gave them, and the labels a human assigned
after reading every failure by hand, and it asks a question most eval dashboards never ask: **is
this grader measuring anything?**

```
npm install && npm run report
```

No dependencies. No credentials. No API calls. No Docker. Node 22.18 or newer runs the
TypeScript directly.

---

## The table

```
GRADER           KIND                ACC     PREC    RECALL   KAPPA   TP FP FN TN  ABSTAIN
------------------------------------------------------------------------------------------------
historical-v1    REAL_HISTORICAL    83.3%   20.0%  100.0%   0.284    1  4  0 19      .
keyword-narrow   RECONSTRUCTION     83.3%    0.0%    0.0%  -0.067    0  3  1 20      8
keyword-broad    PORTED             91.7%    0.0%    0.0%  -0.043    0  1  1 22      8
always-pass      CONTROL            95.8%      --    0.0%   0.000    0  0  1 23      .
always-fail      CONTROL             4.2%    4.2%  100.0%   0.000    1 23  0  0      .
coin-flip        CONTROL            45.8%    0.0%    0.0%  -0.083    0 12  1 11      .
```

**`always-pass` is one line that returns `false`. It has the highest accuracy in the table.**

It beats the grader that actually shipped. It beats the corrected one. It catches nothing, ever.
That row is committed as a test: if it ever stops out-scoring the real graders, the build fails and
this README stops being true.

That is what accuracy does on an eval corpus. 23 of the 24 cases genuinely pass, so agreeing with
the truth is nearly free, and a grader can look respectable while being wrong about almost
everything it flags. Cohen's kappa subtracts that floor out. Both useless controls land on exactly
`0.000`, and two of the keyword graders land **below** zero, meaning worse than guessing.

---

## What actually happened

I built an eval for a copilot I ship
([reactorn-copilot-eval](https://github.com/TYHDANI/reactorn-copilot-eval)). The first run came
back 19 of 24. Before publishing that, I read all five failures.

Four of them were the grader.

The refusal check looked for phrases like "not in the ledger". The model had said *"There is no
Apple nuclear PPA in the Q2 2026 NPPI deal ledger."* A correct refusal, scored as a failure,
because the regex did not cover that phrasing. Same for undisclosed pricing: the model said "no
public strike price disclosed" and the pattern wanted "not disclosed".

`npm run cases` prints all four.

Keyword graders fail in one direction. They **undercount correct refusals**, because there are many
ways to say no and only a few of them are in your regex. Had I trusted the harness, I would have
published 79% for a system doing its job and spent a week fixing three things that were not broken.

---

## The part I did not expect

Fixing the grader made the number go **up** and the quality go **down**.

`keyword-broad` is the corrected grader. Its accuracy improved from 83.3% to 91.7%, which reads as
a clear win. Its kappa is **−0.043**. Still worse than chance.

The reason is the `ABSTAIN` column. The corrected grader has no rule for the `GROUNDED` category,
which is exactly where the one real defect lives. It abstains on 8 of 24 cases, and abstaining is
scored as passing, because **that is what abstaining does to your numbers**. A grader that silently
approves a third of your corpus still posts a good accuracy.

So the fix removed the false alarms and left the blind spot untouched, and the only metric that
noticed was the one nobody looks at.

---

## Emitting this as telemetry

`npm run otel` renders each verdict as an OpenTelemetry `gen_ai.evaluation.result` event.

Every attribute name is derived from the spec by `scripts/extract-semconv.mjs`, which reads the
YAML vendored in `vendor/semconv/` at a pinned commit. Nothing is typed from memory, because
attribute names typed from memory are how instrumentation quietly stops being queryable.

A **naive emitter is committed as a control** and `test/otel.test.ts` asserts it FAILS conformance:

```
wrong_event_name     event name is "gen_ai.evaluation", the spec says "gen_ai.evaluation.result"
missing_required     gen_ai.evaluation.name is required and absent
unknown_attribute    "score" is not in the spec for this event
unknown_attribute    "response_id" is not in the spec for this event
```

Both emitters would pass a code review. Only one is queryable.

One trap worth recording: the GenAI conventions **are no longer in
`open-telemetry/semantic-conventions`**. They moved to
`open-telemetry/semantic-conventions-genai`, and the old repo's `model/gen-ai/` now holds only
deprecated definitions. Instrumenting from the obvious location produces attribute names that are
on their way out. See `vendor/semconv/PINNED.md`.

---

## Commands

```
npm run report          score every grader against the human labels
npm run cases           the cases where the shipped grader and the human disagreed
npm run otel            emit verdicts as OTel events, check them against the pinned spec
npm test                26 tests
npm run build:corpus    rebuild data/ from the published source
npm run build:semconv   re-derive the event contract from the vendored spec
```

## How the honesty is enforced

**Nothing in `data/` is hand-written.** `scripts/build-corpus.mjs` fetches the two result files
from the published eval repo and records a sha256 of each in `data/PROVENANCE.md`. The 24 replies
are real output from a real endpoint, not written for this repo.

**The controls must stay broken.** `always-pass` topping the accuracy column is an assertion, not a
sentence in a README. So is the naive OTel emitter failing conformance.

**The tests were mutation-checked.** Making `always-pass` catch one case, loosening the
reconstruction's regex, making the naive emitter conformant, and replacing kappa with raw accuracy
each break the suite. A test that cannot fail is decoration.

**`keyword-broad` scores itself.** It produced the labels for the 16 phrase-matching cases, so its
result on those is tautological and says nothing. It is in the table because of what it does on the
other 8, where it abstains. `LIMITATIONS.md` has the rest.

---

Tyh McLean, Brooklyn. [github.com/TYHDANI](https://github.com/TYHDANI)
