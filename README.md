# pi-omni-compact

A [pi](https://github.com/mariozechner/pi) extension that replaces the default context compaction with a large-context model subprocess. Instead of summarizing with the active conversation model, it spawns a separate pi instance using a 1M-token Gemini model that can read the entire conversation at once.

## How it works

When pi needs to compact conversation history or summarize an abandoned branch, this extension intercepts the event and:

1. Serializes the full conversation into a hybrid text format
2. Resolves a configured model with a valid API key
3. Spawns a pi subprocess with read-only tools (`read`, `grep`, `find`, `ls`) and an optional [pi-read-map](https://github.com/ArekSredzki/pi-read-map) extension
4. The subprocess reads the conversation and referenced source files, then returns a structured summary

On any failure — no API key, subprocess crash, empty output — the extension returns `undefined` and pi falls back to its default compaction.

## Summary format

The output follows a fixed structure:

- **Goal** — the original user request, quoted verbatim
- **Constraints & Preferences** — requirements and style decisions
- **Progress** — done, in progress, blocked
- **Key Decisions** — what was decided, why, and what alternatives were rejected
- **File Changes** — paths and what changed
- **Error History** — errors encountered and fixes applied
- **Remaining Work** — unfinished tasks
- **Next Steps** — ordered list of recommended actions
- **Critical Context** — specific values, references, and data needed to continue

## Installation

```bash
git clone <this-repo> ~/.pi/agent/extensions/pi-omni-compact
cd ~/.pi/agent/extensions/pi-omni-compact
npm install
```

pi discovers the extension automatically via `package.json`'s `pi.extensions` field.

## Configuration

Edit `settings.json` in the extension directory to configure which models to try. The extension uses the first model that has a valid API key:

```json
{
  "models": [
    { "provider": "google-antigravity", "id": "gemini-3-flash", "thinking": "high" },
    { "provider": "google-antigravity", "id": "gemini-3-pro-low", "thinking": "high" }
  ]
}
```

API keys are resolved through pi's model registry — no separate key configuration needed.

## Benchmark results

Evaluated against 14 real coding sessions (25k–165k tokens) using [pi-compression-benchmark](../pi-compression-benchmark/) with probe-response scoring:

| Strategy | Avg Score | Min | Max |
|----------|-----------|-----|-----|
| **pi-omni-compact** | **57.1** | 35 | 89 |
| pi-agentic-compaction | 46.2 | 30 | 70 |
| pi-default | 46.1 | 20 | 85 |

Strongest on sessions with concrete implementation work. Weakest on pure exploration/research sessions with no clear goal structure.

## Development

```bash
npm run validate   # typecheck + lint + format check
npm test           # unit + integration tests (83 tests)
npm run test:e2e   # end-to-end tests (requires real Gemini API key)
npm run build      # compile to dist/
```

## Architecture

```
src/
  index.ts        Event handlers for session_before_compact, session_before_tree
  models.ts       Resolve first configured model with valid API key
  serializer.ts   Convert pi messages to LLM input format
  prompts.ts      System prompts (initial, incremental, branch)
  subprocess.ts   Spawn pi subprocess, parse JSON event stream
  settings.ts     Load and validate settings.json
```

## License

MIT
