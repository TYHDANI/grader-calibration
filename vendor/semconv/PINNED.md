# Vendored OpenTelemetry GenAI semantic conventions

Source: **`open-telemetry/semantic-conventions-genai`**, commit
`67dff024110be5bd9f318006e733f4078e0f4c97`, fetched 2026-08-30.

Pinned to a commit SHA rather than a tag or `main` because `gen_ai.evaluation.result`
carries `stability: development`. It is allowed to change under us, and a moving
reference would let this repo silently start claiming conformance to something
different from what it was written against.

## Worth knowing before you go looking for these files

The GenAI conventions **are no longer in `open-telemetry/semantic-conventions`.**
That repository still has a `model/gen-ai/` directory, but at the time of writing it
contains only `deprecated/` files, whose own note records the move:

> Moved to the [OpenTelemetry GenAI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai).

Fetching `model/gen-ai/registry.yaml` from the old repository returns 404, and
following the deprecated files instead would produce an emitter written against
attribute names that are on their way out.

`scripts/extract-semconv.mjs` derives `data/semconv-contract.json` from the two
YAML files here. No attribute name in this repository is typed by hand.
