# Changelog

## 0.1.0 — 2026-02-23

Initial release.

### Features

- Intercepts `session_before_compact` and `session_before_tree` events to replace pi's default compaction with a large-context model subprocess
- Spawns a pi subprocess with read-only tools (`read`, `grep`, `find`, `ls`) so the summarizer can inspect referenced source files
- Session analysis extracts structural metadata before summarization: friction signals (error loops, rephrasing cascades, context churn), delight signals (one-shot success, resilient recovery), session boundaries, and file operations
- Three prompt variants: initial compaction, incremental compaction (merges new messages into an existing summary), and branch summarization
- Configurable model fallback chain — tries each model in order, uses the first with a valid API key
- Optional [pi-read-map](https://github.com/Whamp/pi-read-map) integration for faster codebase navigation
- Debug mode saves compaction input/output as timestamped JSON artifacts
- Minimum summary length gate — short output triggers fallback to default compaction
- Graceful degradation: returns `undefined` on any failure so pi falls back to built-in compaction
