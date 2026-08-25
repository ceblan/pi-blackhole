# Tests

pi-blackhole uses [Vitest](https://vitest.dev/) for testing. 50 test files cover all major subsystems: VCC compaction pipeline, observational memory, recall, commands, and configuration.

## VCC compaction tests

Tests for the algorithmic compaction pipeline and section extraction.

### compile and formatting

Tests for the compile pipeline and formatting utilities.

- `tests/vcc-compile.test.ts` — `compile()` pipeline end-to-end
- `tests/vcc-format.test.ts` — Summary formatting (`formatSummary`, `wrapLongLines`, `capBrief`)
- `tests/vcc-format-recall.test.ts` — Recall output formatting (`formatRecallOutput`, `formatTouchedOutput`)
- `tests/vcc-content.test.ts` — Content utilities (`clip`, `clipSentence`, `isContentBearing`, `snippet`)
- `tests/vcc-normalize.test.ts` — Message normalization (`normalize`, block kind mapping)
- `tests/vcc-sanitize.test.ts` — ANSI/control character stripping

### section extraction

Tests for goal, preference, and noise extraction.

- `tests/vcc-extract-goals.test.ts` — Goal extraction (task intent, scope changes)
- `tests/vcc-extract-preferences.test.ts` — Preference extraction and dedup against goals
- `tests/vcc-filter-noise.test.ts` — Noise filtering (thinking blocks, noise tools, XML wrappers)

### recall core

Tests for the recall search, drill-down, and entry expansion systems.

- `tests/vcc-build-sections.test.ts` — `buildSections()` orchestration
- `tests/vcc-brief.test.ts` — Brief transcript builder (token counting, compression, dedup)
- `tests/vcc-lineage.test.ts` — Active lineage entry ID extraction
- `tests/vcc-load-messages.test.ts` — JSONL session loading with LRU cache
- `tests/vcc-render-entries.test.ts` — Message → `RenderedEntry` conversion
- `tests/vcc-search-entries.test.ts` — BM25 + regex search
- `tests/vcc-recall-drilldown.test.ts` — `#N:path` drill-down parsing and content extraction
- `tests/vcc-recall-expand.test.ts` — `#N` entry expansion
- `tests/vcc-recall-scope.test.ts` — Scope/mode parsing (`scope:lineage|all`, `mode:hybrid|file|touched`)
- `tests/vcc-recall-tool-scope.test.ts` — Recall tool scope handling

### before-compact hook

Tests for the session_before_compact hook integration.

- `tests/vcc-before-compact.test.ts` — Hook guards, `buildOwnCut`, orphan recovery
- `tests/vcc-before-compact-hook.test.ts` — Hook registration and integration

### test fixtures

Shared fixtures and session data helpers for tests.

- `tests/vcc-fixtures.ts` — Shared test fixtures for VCC tests
- `tests/vcc-support/load-session.ts` — Session loading helpers
- `tests/vcc-support/real-sessions.ts` — Real session data for integration tests
- `tests/fixtures/session.ts` — Generic session fixture

## Observational memory tests

Tests for the OM system: workers, ledger, consolidation, runtime.

### runtime and consolidation

Tests for the OM runtime, worker agents, and consolidation pipeline.

- `tests/runtime.test.ts` — `Runtime` class: model resolution, cooldown integration, error tracking
- `tests/observer.test.ts` — Observer agent: observation extraction, sourceEntryIds
- `tests/reflector.test.ts` — Reflector agent: reflection synthesis from observations
- `tests/dropper.test.ts` — Dropper agent: observation pruning
- `tests/dropper-coverage.test.ts` — Dropper coverage edge cases
- `tests/consolidation.test.ts` — Consolidation pipeline (observer → reflector → dropper)
- `tests/multi-cycle-compaction.test.ts` — Multi-cycle compaction behavior
- `tests/auto-compact-permutations.test.ts` — Auto-compaction config permutations
- `tests/compact-failed.test.ts` — `session_compact_failed` handler: registration, `compactInFlight` reset, overflow-retry notification, pi-default filter, attribution fix

### ledger

Tests for ledger types, folding, projection, and rendering.

- `tests/session-ledger-types.test.ts` — Ledger types and validators (`isObservation`, `isReflection`, etc.)
- `tests/session-ledger-fold.test.ts` — `foldLedger()` deduplication and tombstones
- `tests/session-ledger-progress.test.ts` — Token counting and coverage tracking
- `tests/fold.test.ts` — FoldedLedger output
- `tests/projection.test.ts` — Projection slicing (visible, full, compaction)
- `tests/render-summary.test.ts` — Summary rendering and observation scoring
- `tests/recall.test.ts` — Ledger recall/search
- `tests/reverse-recall.test.ts` — OM id → session entry reverse lookup

### model management

Tests for model budget, compaction trigger, and config.

- `tests/model-budget.test.ts` — Context window estimation and model budget
- `tests/compaction-trigger.test.ts` — Auto-compaction trigger (agent_end → ctx.compact)
- `tests/config.test.ts` — OM config loading and defaults
- `tests/config-simplification.test.ts` — Unified config migration and validation

### supporting modules

Tests for overlay TUIs, clipboard, debug logging, and key matching.

- `tests/configure-overlay.test.ts` — Interactive config overlay TUI
- `tests/status-overlay.test.ts` — Status display overlay
- `tests/clipboard.test.ts` — Clipboard helpers
- `tests/debug-log.test.ts` — JSONL debug logging
- `tests/key-matcher.test.ts` — Key matching for overlay navigation

## Command tests

Tests for the three user-facing commands.

- `tests/blackhole-command.test.ts` — `/blackhole` command (compact, configure, om-off/om-on)
- `tests/memory-command.test.ts` — `/blackhole-memory` command (status, view, full)
- `tests/blackhole-recall.test.ts` — `/blackhole-recall` command

## Configuration

The test suite is configured via `vitest.config.ts` and `tsconfig.json`. Tests run with `pnpm vitest` or `pnpm test`. Type checking via `pnpm check` (tsc --noEmit). Linting via `pnpm lint` (eslint).
