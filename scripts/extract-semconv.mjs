// Derives data/semconv-contract.json from the vendored spec.
//
// The point is that no attribute name in this repo is typed by a human. If the
// spec renames something, re-running this changes the contract and the
// conformance test starts failing, which is the correct outcome.
//
//   node scripts/extract-semconv.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const EVENT = 'gen_ai.evaluation.result'
const eventsRaw = readFileSync('vendor/semconv/events.yaml', 'utf8')
const registryRaw = readFileSync('vendor/semconv/registry.yaml', 'utf8')
const sha = (s) => createHash('sha256').update(s).digest('hex')

// Slice the one event block out of events.yaml.
const start = eventsRaw.indexOf(`- name: ${EVENT}`)
if (start === -1) throw new Error(`${EVENT} is not in the vendored spec`)
const after = eventsRaw.slice(start + 1)
const nextIdx = after.indexOf('\n  - name: ')
const block = nextIdx === -1 ? after : after.slice(0, nextIdx)

// Each attribute is `- ref: <name>` optionally followed by a requirement_level.
const attributes = []
const lines = block.split('\n')
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^\s*- ref:\s*(\S+)\s*$/)
  if (!m) continue
  let level = 'recommended'
  for (let j = i + 1; j < lines.length; j++) {
    if (/^\s*- (ref|ref_group):/.test(lines[j])) break
    const inline = lines[j].match(/^\s*requirement_level:\s*(\S+)\s*$/)
    if (inline) { level = inline[1]; break }
    if (/^\s*requirement_level:\s*$/.test(lines[j])) {
      const nested = lines[j + 1]?.match(/^\s*(\w+):/)
      if (nested) level = nested[1]
      break
    }
  }
  attributes.push({ name: m[1], requirement_level: level })
}

// Pull each attribute's declared type out of the registry.
for (const a of attributes) {
  const k = registryRaw.indexOf(`- key: ${a.name}\n`)
  if (k === -1) { a.type = null; continue }
  const t = registryRaw.slice(k, k + 400).match(/\n\s*type:\s*(\S+)/)
  a.type = t ? t[1] : null
}

const stability = block.match(/^\s*stability:\s*(\S+)\s*$/m)?.[1] ?? 'unknown'

writeFileSync('data/semconv-contract.json', JSON.stringify({
  event: EVENT,
  stability,
  warning: stability === 'development'
    ? 'This event is DEVELOPMENT stability in the spec. It can change. Do not present conformance here as a stable guarantee.'
    : null,
  source_repo: 'open-telemetry/semantic-conventions-genai',
  pinned_sha: readFileSync('vendor/semconv/PINNED_SHA', 'utf8').trim(),
  vendored_sha256: { 'events.yaml': sha(eventsRaw), 'registry.yaml': sha(registryRaw) },
  attributes,
}, null, 2) + '\n')

console.log(`${EVENT}  (stability: ${stability})`)
for (const a of attributes) console.log(`  ${a.requirement_level.padEnd(22)} ${a.name.padEnd(32)} ${a.type ?? '(group)'}`)
