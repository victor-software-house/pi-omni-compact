# Repository Guidelines

## Scope

This repository contains the `pi-omni-compact` Pi extension package.

## Key commands

- `npm run validate` — run typecheck, lint, and format checks
- `npm test` — run unit and integration tests
- `npm run test:e2e` — run end-to-end tests that require a real Pi/API setup
- `npm run build` — compile TypeScript to `dist/`

## Code layout

- `src/index.ts` wires the extension events and command registration.
- `src/config-*.ts` owns operator-facing config UX and persistence.
- `src/settings.ts` owns config normalization and disk I/O.
- `tests/unit/` covers pure helpers.
- `tests/integration/` covers extension registration and fallback behavior.

## Configuration

- Runtime config is written to `~/.pi/agent/pi-omni-compact.json`.
- Keep `settings.json` as a legacy fallback only; new features should prefer the durable user config path.

## Change discipline

- Prefer small, focused changes.
- Keep fallback-to-default-compaction behavior intact on any config or subprocess failure.
