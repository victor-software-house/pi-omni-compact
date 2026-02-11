# pi-omni-compact

*2026-02-11T17:41:04Z*

A [pi](https://github.com/mariozechner/pi) extension that replaces default context compaction with a large-context model subprocess. Instead of summarizing with the active conversation model, it spawns a separate pi instance using a 1M-token Gemini model that can read the entire conversation at once — producing higher-quality summaries with full context.

## Project structure

```bash
find src -name '*.ts' | sort
```

```output
src/debug.ts
src/index.ts
src/models.ts
src/prompts.ts
src/serializer.ts
src/session-analysis.ts
src/settings.ts
src/subprocess.ts
```

Each module has a single responsibility:

- **index.ts** — Extension entry point; hooks `session_before_compact` and `session_before_tree` events
- **models.ts** — Resolves the first configured model with a valid API key
- **serializer.ts** — Converts pi messages into a hybrid text format for the LLM
- **prompts.ts** — System prompts for initial, incremental, and branch summarization
- **subprocess.ts** — Spawns a pi subprocess with read-only tools, parses JSON event stream
- **session-analysis.ts** — Structural analysis of session entries (tool usage, errors, file changes)
- **settings.ts** — Loads and validates settings.json
- **debug.ts** — Saves compaction input/output as debug artifacts

## Source metrics

```bash
wc -l src/*.ts | tail -1
```

```output
 1683 total
```

```bash
find tests -name '*.test.ts' | wc -l && echo 'test files' && find tests -name '*.test.ts' -exec grep -c 'it(' {} + | awk -F: '{s+=$2} END {print s, "test cases"}'
```

```output
11
test files
160 test cases
```

## Test suite

```bash
find tests -name '*.test.ts' | sort | while read f; do count=$(grep -c 'it(' "$f"); echo "$f ($count tests)"; done
```

```output
tests/e2e/compaction.test.ts (2 tests)
tests/e2e/fallback.test.ts (2 tests)
tests/integration/extension-load.test.ts (6 tests)
tests/integration/handler-fallback.test.ts (4 tests)
tests/unit/debug.test.ts (5 tests)
tests/unit/models.test.ts (6 tests)
tests/unit/prompts.test.ts (36 tests)
tests/unit/serializer.test.ts (35 tests)
tests/unit/session-analysis.test.ts (32 tests)
tests/unit/settings.test.ts (11 tests)
tests/unit/subprocess.test.ts (21 tests)
```

## Validation

```bash
npm run typecheck 2>&1
```

```output

> pi-omni-compact@0.1.0 typecheck
> tsc --noEmit

```

```bash
npx vitest run --reporter=verbose 2>&1 | tail -40
```

```output
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22mserializeCompactionInput[2m > [22mhandles empty messages gracefully[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22mserializeCompactionInput[2m > [22mincludes edited files in file operations[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22mserializeCompactionInput[2m > [22mincludes user compaction note when customInstructions present[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22mserializeCompactionInput[2m > [22momits user compaction note when customInstructions absent[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22mserializeCompactionInput[2m > [22momits user compaction note when customInstructions is whitespace[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22mserializeBranchInput[2m > [22mextracts and serializes messages from session entries[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22mserializeBranchInput[2m > [22mincludes assistant tool calls from entries[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22mserializeBranchInput[2m > [22mhandles branch_summary entries[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22mserializeBranchInput[2m > [22mhandles compaction entries[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22mserializeBranchInput[2m > [22mhandles custom_message entries[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22mserializeBranchInput[2m > [22mskips non-message entry types[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22mserializeBranchInput[2m > [22mhandles empty entries array[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22mserializeBranchInput[2m > [22mpreserves message ordering[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22msession-structure serialization[2m > [22mincludes session-structure section when analysis is provided[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22msession-structure serialization[2m > [22momits session-structure section when analysis is absent[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22msession-structure serialization[2m > [22mplaces session-structure before conversation[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22msession-structure serialization[2m > [22mincludes message stats[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22msession-structure serialization[2m > [22mincludes models used[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22msession-structure serialization[2m > [22mincludes compaction and branch point counts[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22msession-structure serialization[2m > [22mincludes boundaries[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22msession-structure serialization[2m > [22mincludes friction signals[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22msession-structure serialization[2m > [22mincludes delight signals[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22msession-structure serialization[2m > [22mincludes files touched[32m 0[2mms[22m[39m
 [32m✓[39m tests/unit/serializer.test.ts[2m > [22msession-structure serialization[2m > [22momits empty friction/delight/boundary sections[32m 0[2mms[22m[39m
 [32m✓[39m tests/integration/handler-fallback.test.ts[2m > [22msession_before_compact handler[2m > [22mreturns undefined when no model is available[32m 3[2mms[22m[39m
 [32m✓[39m tests/integration/handler-fallback.test.ts[2m > [22msession_before_compact handler[2m > [22mreturns undefined when model has no API key[32m 1[2mms[22m[39m
 [32m✓[39m tests/integration/handler-fallback.test.ts[2m > [22msession_before_tree handler[2m > [22mreturns undefined when userWantsSummary is false[32m 0[2mms[22m[39m
 [32m✓[39m tests/integration/handler-fallback.test.ts[2m > [22msession_before_tree handler[2m > [22mreturns undefined when no model is available[32m 1[2mms[22m[39m
 [32m✓[39m tests/integration/extension-load.test.ts[2m > [22mextension loading[2m > [22mexports a default function[32m 1[2mms[22m[39m
 [32m✓[39m tests/integration/extension-load.test.ts[2m > [22mextension loading[2m > [22mregisters session_before_compact handler[32m 2[2mms[22m[39m
 [32m✓[39m tests/integration/extension-load.test.ts[2m > [22mextension loading[2m > [22mregisters session_before_tree handler[32m 0[2mms[22m[39m
 [32m✓[39m tests/integration/extension-load.test.ts[2m > [22mextension loading[2m > [22mregisters exactly two event handlers[32m 0[2mms[22m[39m
 [32m✓[39m tests/integration/extension-load.test.ts[2m > [22mextension loading[2m > [22mdoes not register any tools[32m 0[2mms[22m[39m
 [32m✓[39m tests/integration/extension-load.test.ts[2m > [22mextension loading[2m > [22mdoes not register any commands[32m 0[2mms[22m[39m

[2m Test Files [22m [1m[32m9 passed[39m[22m[90m (9)[39m
[2m      Tests [22m [1m[32m156 passed[39m[22m[90m (156)[39m
[2m   Start at [22m 09:41:49
[2m   Duration [22m 658ms[2m (transform 573ms, setup 0ms, import 2.16s, tests 68ms, environment 1ms)[22m

```

## Configuration

The extension is configured via `settings.json`. It tries each model in order and uses the first one with a valid API key:

```bash
cat settings.json
```

```output
{
  "debugCompactions": false,
  "minSummaryChars": 100,
  "models": [
    { "provider": "google-antigravity", "id": "gemini-3-flash", "thinking": "high" },
    { "provider": "google-antigravity", "id": "gemini-3-pro-low", "thinking": "high" }
  ]
}
```

## How compaction works

When pi's context window fills up, it fires `session_before_compact`. This extension intercepts the event and:

1. Analyzes the full session for structural metadata (tool usage, errors, file changes, friction/delight signals)
2. Serializes the conversation into a hybrid text format
3. Spawns a subprocess with read-only tools (`read`, `grep`, `find`, `ls`) so it can inspect referenced files
4. Returns a structured summary covering goal, progress, decisions, file changes, errors, and next steps

On failure — no API key, subprocess crash, output too short — it returns `undefined` and pi falls back to its built-in compaction.

## Benchmark results

Evaluated against 14 real coding sessions (25k-165k tokens) using probe-response scoring:

| Strategy | Avg Score | Min | Max |
|----------|-----------|-----|-----|
| **pi-omni-compact** | **57.1** | 35 | 89 |
| pi-agentic-compaction | 46.2 | 30 | 70 |
| pi-default | 46.1 | 20 | 85 |

Strongest on sessions with concrete implementation work. Weakest on pure exploration/research sessions.

## Git history

```bash
git log --oneline
```

```output
03aea63 docs: update README with pi install, new settings, and test count
33db5b2 feat: add user compaction notes, accuracy rules, debug artifacts, and min summary length
01d47c9 chore: add temp directories to gitignore
42f22e5 Add README
ebc0433 Implement extension core, tests, and benchmark-tuned prompts
c3e1481 Add subprocess unit tests and E2E test scaffolding
ba7d51a Add design doc and implementation handoff for pi-omni-compact
```
