# Limitations

Read these before drawing a conclusion from anything in the README.

### n is 24, and one person did the labelling

Every number here rests on 24 cases labelled by me, the same person who wrote the grader being
criticised. The 95% Wilson interval on the shipped grader's accuracy runs from **64.1% to 93.3%**,
which is most of the useful range. `npm run report` prints that interval rather than hiding it.

A second independent labeller is the single most valuable thing that could be added, because it
would let this measure inter-rater agreement instead of assuming my labels are ground truth. It
does not have that, so it does not claim it.

### The labels and one of the graders are the same artifact

`keyword-broad` produced the labels for the 16 phrase-matching cases. Scoring it against those
labels is circular and its result there means nothing. It earns its place in the table only
through the 8 `GROUNDED` cases it abstains on, which is where the interesting behaviour is.

The `GROUNDED` labels come from per-case numeric assertions checked against `deals.json`, a
publicly published ledger, so those are independent of any keyword logic.

### `keyword-narrow` is a reconstruction, not the original

The v1 grader's source was overwritten when it was fixed and is gone. `keyword-narrow` was
**fitted** to reproduce the verdicts v1 actually recorded, and it matches on all 16 cases it
covers. That is a real check and `test/reconstruction.test.ts` enforces it, but a different regex
could produce the same 16 answers. Treat it as a faithful demonstration of the failure mode, not
as the recovered file.

The row labelled `historical-v1` does not have this problem. Those are the verdicts v1 genuinely
produced, read straight from the committed results.

### Kappa on 24 cases is noisy

Cohen's kappa is a small-sample statistic here and the differences between −0.083, −0.067 and
−0.043 should not be read as a ranking. The finding is the **sign and the gap**: several graders
sit at or below zero while showing accuracies between 83% and 96%. That gap is large enough to
survive the noise. The ordering within it is not.

### Kappa has known problems of its own

With heavily unbalanced classes kappa can be depressed even for a genuinely useful classifier,
which is the flip side of the property being exploited here. It is the right diagnostic for
"is accuracy lying to me" and the wrong one for "how good is this grader in absolute terms".
Nothing here should be read as proposing kappa as the single number to optimise.

### One real failure is not much to detect

The corpus contains exactly one genuine model defect (`A8`, an aggregation error). Recall and
precision computed against a single positive case are extremely fragile. This is why the argument
in the README rests on the **controls** and on the accuracy-versus-kappa gap rather than on any
grader's recall figure.

### The corpus is one system, one model, one day

24 cases against one endpoint running Llama 3.3 70B on 2026-08-14. Whether keyword graders fail
this way in general is not something 24 cases can establish. What they establish is that this
grader failed this way, reproducibly, and that the standard metric did not notice.

### The OTel event is unstable by the spec's own account

`gen_ai.evaluation.result` carries `stability: development`, meaning it is allowed to change.
Conformance here is conformance to one pinned commit, recorded in `vendor/semconv/PINNED.md`, and
is not a durable guarantee. `data/semconv-contract.json` carries that warning in the artifact
itself so it cannot be quoted without it.

### What I would do next, in order

1. A second labeller on the same 24 cases, and report inter-rater agreement.
2. Widen the corpus until the new-failure-mode curve flattens. It has not been measured, so I do
   not know how far that is.
3. Score an LLM-as-judge on the same corpus against the same labels. That is the grader most teams
   actually ship now, and this repo does not test one.
4. Give `keyword-broad` a rule for `GROUNDED` and watch whether kappa moves. If it does not, the
   blind spot is somewhere else.

### About the author's experience

Four years of customer-facing technical delivery, roughly one year building and deploying LLM and
agent systems. I am not an ML researcher and this is not a paper. It is the writeup of a mistake I
made on my own project, instrumented so somebody else can check it.
