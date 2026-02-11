# Plan: Multi-Phase Compaction — Session Structure Analysis

## Summary

Add a pre-LLM analysis phase that extracts structural metadata from the
full session via `ctx.sessionManager.getEntries()`. The analysis output
is serialized as a `<session-structure>` section in the compaction input,
giving the LLM a verified map of what happened before it reads the
conversation.

No extra subprocess. No extra LLM call. Pure computation on in-memory
session data.

## Data Source

The compaction handler already receives `ctx: ExtensionContext` which
exposes `ctx.sessionManager` (a `ReadonlySessionManager`). This provides:

- `getEntries(): SessionEntry[]` — all entries in the session
- `getLeafId(): string | null` — current leaf
- `getSessionFile(): string | undefined` — path to .jsonl

The `SessionEntry` type from `@mariozechner/pi-coding-agent` is
structurally identical to pi-brain's: discriminated union on `type`
with `id`, `parentId`, `timestamp` on every entry, and
`SessionMessageEntry` wrapping `AgentMessage` (which has `role`,
`content`, `provider`, `model`, `usage`, etc.).

## What Gets Extracted

### Stats
- Message counts (user, assistant, toolResult)
- Models used
- Token/cost totals
- Compaction count, branch point count

### Boundaries
- Compaction events (with token counts)
- Branch summaries
- Resume gaps (10+ minute timestamp gaps)
- Tree jumps (parentId mismatches)

### Friction Signals
- Rephrasing cascades (3+ consecutive user messages without meaningful
  assistant response)
- Tool loops (same tool fails with same error 3+ times)
- Context churn (10+ distinct file reads without writes)
- Silent termination (session ends with unresolved error)

### Delight Signals
- Resilient recovery (error → fix without user intervention)
- One-shot success (complex task, zero corrections)
- Explicit praise (with sarcasm filter)

### Files Touched
- Files read, written, edited via tool calls (extracted from
  assistant message content blocks)
- Note: `fileOps` in CompactionPreparation already has this data.
  We extract from full session entries for completeness (fileOps
  only covers the messages being summarized, not the full session).

## Architecture

### New Files

**`src/session-analysis.ts`** (~400 lines)

Extracted and adapted from pi-brain's `signals.ts`, `boundary.ts`,
and `session.ts`. Self-contained, no external dependencies beyond
pi's SDK types.

Exports one entry point:

```ts
interface SessionAnalysis {
  stats: {
    messageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    toolResultCount: number;
    compactionCount: number;
    branchPointCount: number;
    modelsUsed: string[];
  };
  boundaries: {
    type: "compaction" | "branch" | "resume" | "tree_jump";
    timestamp: string;
    detail: string; // e.g., "compaction: 45K tokens", "resume: 2h gap"
  }[];
  friction: {
    rephrasingCascades: number;
    toolLoops: number;
    contextChurn: number;
    silentTermination: boolean;
  };
  delight: {
    resilientRecovery: boolean;
    oneShotSuccess: boolean;
    explicitPraise: boolean;
  };
  filesTouched: {
    read: string[];
    written: string[];
  };
}

function analyzeSession(entries: SessionEntry[]): SessionAnalysis;
```

Internal helper functions (private, not exported):
- `calculateStats(entries)` — from pi-brain session.ts
- `detectBoundaries(entries)` — simplified from pi-brain boundary.ts
  (skip handoff detection, skip LeafTracker class — use simpler
  parentId mismatch check)
- `detectFriction(entries)` — from pi-brain signals.ts
- `detectDelight(entries)` — from pi-brain signals.ts
- `extractFilesTouched(entries)` — from pi-brain signals.ts

### Modified Files

**`src/serializer.ts`**

Add `sessionAnalysis?: SessionAnalysis` to `CompactionInput`.
Serialize as `<session-structure>` section:

```
<session-structure>
Messages: 47 (user: 12, assistant: 23, tool: 12)
Models: google-antigravity/gemini-3-flash, anthropic/claude-sonnet-4-20250514
Compactions: 2 | Branch points: 1

Boundaries:
- [2026-02-10T14:23:00Z] compaction (45K tokens)
- [2026-02-10T16:45:00Z] resume (2h 22m gap)
- [2026-02-10T17:01:00Z] compaction (38K tokens)

Friction:
- Tool loops: 2 (same error repeated 3+ times)
- Context churn: 1 (10+ file reads without writes)

Delight:
- Resilient recovery: yes (fixed errors without user help)

Files touched:
  read: src/index.ts, src/config.ts, tests/unit/config.test.ts
  written: src/config.ts, src/types.ts
</session-structure>
```

**`src/prompts.ts`**

Add to COMPACTION_SYSTEM_PROMPT and COMPACTION_INCREMENTAL_SYSTEM_PROMPT:

```
If a <session-structure> section is present, use it to:
- Verify file claims against the files-touched list
- Pay extra attention to areas with friction signals (tool loops,
  rephrasing cascades) — preserve error history for those areas
- Note boundary events to understand session flow
- Use stats to calibrate summary density (longer sessions need
  denser summaries)
```

**`src/index.ts`**

In the `session_before_compact` handler, before serialization:

```ts
const entries = ctx.sessionManager.getEntries();
const sessionAnalysis = analyzeSession(entries);
```

Pass `sessionAnalysis` into `serializeCompactionInput()`.

Same for `session_before_tree` handler (branch summarization).

## Implementation Order with Validation

### Step 1: `src/session-analysis.ts`

**Validation:**
- `tsc --noEmit` — confirms type compatibility with pi SDK's
  `SessionEntry`. This is the highest-risk area: if our code expects
  fields that don't exist on the SDK types, it fails here.
- `oxlint` — catches lint issues before tests run.

### Step 2: `tests/unit/session-analysis.test.ts`

Unit tests with synthetic fixture entries:
- Stats calculation with mixed entry types
- Boundary detection (compaction, branch, resume gap, tree jump)
- Friction: rephrasing cascades, tool loops, context churn
- Delight: resilient recovery, one-shot success, praise
- Files touched extraction from tool calls
- Edge cases: empty entries, single message, no friction

**Validation:**
- `vitest run tests/unit/session-analysis.test.ts` — all pass.

### Step 3: Real session smoke test

Write a throwaway script `scripts/analyze-session.ts` that:
1. Reads a real session JSONL file (parse lines as JSON, skip header)
2. Passes entries to `analyzeSession()`
3. Prints the result as JSON

Run it against 3 real sessions from `~/.pi/agent/sessions/`:
- A session with compactions and branches (e.g., the pi-omni-compact
  development session at `--home-will-projects-pi-omni-compact--/
  2026-02-09T23-53-59-217Z_*.jsonl` — 750 lines, 2 compactions,
  1 branch)
- A session with known friction (tool errors, user corrections)
- A short session with no boundaries

**Validation:**
- Manual inspection: do the stats match what `wc -l` and
  `grep -c '"type":"compaction"'` report?
- Do boundaries match what pi-brain's `detectBoundaries()` would
  find on the same data? Run pi-brain's parser on the same file
  and compare outputs.
- Are friction signals plausible? (A session with known tool errors
  should show `toolLoops > 0`.)

This step catches bugs that synthetic fixtures miss: malformed
entries, unexpected field values, edge cases in real data.

### Step 4: `src/serializer.ts`

Add `sessionAnalysis?: SessionAnalysis` to `CompactionInput`.
Serialize as `<session-structure>` section.

**Validation:**
- Unit tests in `tests/unit/serializer.test.ts`:
  - With analysis data → `<session-structure>` section present
  - Without analysis data → no `<session-structure>` section
    (backward compatible)
  - Serialized format matches expected output (snapshot-style)
- Rerun `scripts/analyze-session.ts` but pipe the result through
  the serializer to see the actual `<session-structure>` text for
  a real session. Eyeball it: is it readable? Is it accurate?
  Is it the right density (~200-500 chars)?

### Step 5: `src/prompts.ts`

Add `<session-structure>` instructions to compaction prompts.

**Validation:**
- Unit tests in `tests/unit/prompts.test.ts`:
  - All three prompts contain `session-structure` instructions
  - Verify instruction text matches the intent
- Read the assembled prompt end-to-end (prompt + format + rules).
  Check that session-structure instructions don't contradict
  existing rules (e.g., ACCURACY_RULES already says "only list
  files as modified if a write/edit tool call succeeded" — the
  session-structure's files-touched list should reinforce, not
  conflict with this).

### Step 6: `src/index.ts`

Wire `analyzeSession()` into both handlers.

**Validation:**
- `tsc --noEmit` — confirms the handler passes the right types.
- Integration tests in `tests/integration/`:
  - Existing handler-fallback tests still pass (analysis failure
    must not break fallback behavior).
  - New test: handler receives mock `ctx.sessionManager.getEntries()`
    and the analysis output appears in the serialized input.
- `vitest run` — full test suite passes (unit + integration).

### Step 7: Debug artifact inspection

Enable `debugCompactions: true` in `settings.json`. Trigger a real
compaction (either via E2E test or by using pi in a real session
until context fills up).

**Validation:**
- Read the saved debug artifact at
  `~/.pi/agent/extensions/pi-omni-compact/compactions/`.
- Inspect the `input` field: does `<session-structure>` appear?
  Is the data accurate for this session?
- Inspect the `output` field: did the LLM reference the
  session-structure data? Did it verify file claims? Did it
  note friction areas?
- Compare to a compaction without session-structure (from before
  this change). Is the output measurably better? Does it catch
  file claim errors that the old output missed?

### Step 8: Cross-validation with pi-brain

Run pi-brain's parser on the same session file used in step 3.
Compare its `SessionStats`, `detectBoundaries()`, and
`detectFrictionSignals()` output against our `analyzeSession()`
output.

**Validation:**
- Stats should match exactly (same counting logic).
- Boundaries should match for compaction, branch, and resume
  types. Tree jump detection may differ slightly (we use a
  simpler parentId check vs pi-brain's LeafTracker).
- Friction signals should match within tolerance (same
  thresholds, same detection logic).
- Document any intentional differences and why.

## Simplifications vs pi-brain

To keep the extraction manageable:

- **No LeafTracker class.** Use simpler parentId mismatch detection
  for tree jumps (compare each entry's parentId to the previous
  entry's id).
- **No handoff detection.** Regex-based handoff patterns are niche
  and add complexity.
- **No model switch detection.** Models used is captured in stats;
  per-segment model tracking adds state.
- **No abandoned restart detection.** Requires cross-segment analysis
  with time windows.
- **No friction/delight scores.** Pass raw signal counts. The LLM
  can interpret "tool loops: 3" without a 0.0–1.0 score.

## Risk Assessment

- **Zero risk to existing behavior.** Session analysis is additive.
  If `getEntries()` throws or returns empty, skip the section.
- **Performance.** Analysis is O(n) over entries. A 1000-entry
  session processes in <10ms. No file I/O.
- **Token cost.** The `<session-structure>` section is ~200-500
  chars. Negligible vs the conversation content.
- **Type compatibility.** Pi SDK's `SessionEntry` is structurally
  identical to pi-brain's. Verified by reading both type definitions.
