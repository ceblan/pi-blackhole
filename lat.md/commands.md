# Commands

pi-blackhole registers three user-facing commands with Pi's ExtensionAPI. All commands are registered in the default export factory of `index.ts`.

## /blackhole

The primary compaction command. Registered by `registerPiVccCommand()` in [[src/commands/pi-vcc.ts]]. Collapses conversation into a structured summary via the [[vcc-compaction#compile pipeline|VCC compile pipeline]] and injects [[observational-memory|OM content]].

### Subcommands

Available subcommands for `/blackhole`.

| Subcommand | Behavior |
|------------|----------|
| (none) | Trigger compaction via `ctx.compact()` |
| `configure` | Open interactive TUI config overlay via `ctx.ui.custom()` |
| `om-off` | Disable observational memory |
| `om-on` | Re-enable observational memory |

### Manual mode flush

Before compaction in manual mode (`compaction: "manual"`), pending OM entries (observations, reflections, dropped) are flushed from disk to the branch via `pi.appendEntry()`. After flush, the pending file is cleared.

### After compaction

Shows stats via `ctx.ui.notify()` with formatted token counts. Uses `runtime.compactionStats` for summarized count, kept count, and token estimate.

### Configure overlay

The `configure` subcommand opens an interactive TUI overlay defined in [[src/om/configure-overlay.ts]]. Features:

- ↑↓ navigation, Enter to toggle values
- Ctrl+S to save
- Sections: Compaction, Observational Memory, Debug
- Warns on read-only filesystem

## /blackhole-memory

Pipeline status and memory viewer. Registered by `registerMemoryCommand()` in [[src/commands/memory.ts]]. Also accessible as `/blackhole status`.

### Subcommands

Available subcommands for `/blackhole-memory`.

| Subcommand | Behavior |
|------------|----------|
| `status` (default) | Pipeline status: tokens, counts, pending data, errors |
| `view` | Visible observations + reflections, copied to clipboard |
| `full` | ALL recorded memory (including dropped), copied to clipboard |

### Status display

Uses `foldLedger()` for counts, `visibleProjection()` and `fullProjection()` for content. Shows:

- Token progress bars (observer, reflector, compaction thresholds)
- Observation and reflection counts
- Pending data section (manual mode)
- In-flight flags (consolidation, compaction)
- Last errors per stage
- Passive mode warning

The status overlay is rendered via [[src/om/status-overlay.ts]] using `ctx.ui.custom({ overlay: true })`.

### Clipboard

`view` and `full` subcommands copy results to clipboard via [[src/om/clipboard.ts]]. Uses the system clipboard if available, falls back to console output.

## /blackhole-recall

Interactive session history search. Registered by `registerVccRecallCommand()` in [[src/commands/vcc-recall.ts]]. See [[recall#/blackhole-recall command]] for full usage details.

## Provider stream bridge

The entry point factory sets up a provider stream bridge for jiti-loaded consolidation agents. The OM agents need custom providers from other extensions.

### Mechanism

Two capture strategies ensure all providers are available:

1. **Wrap `pi.registerProvider`** — Intercepts registration calls, stores `streamSimple` in `Symbol.for("pi-blackhole:provider-streams")` global Map. Handles providers registered after pi-blackhole loads.
2. **`agent_start` fallback scan** — On first agent start, scans `modelRegistry.registeredProviders` for providers that registered before pi-blackhole. Uses `hasScannedFallback` flag to run exactly once.

The bridge is accessed via `createBridgeStreamFn()` in [[src/om/provider-stream.ts]].
