# Configuration

pi-blackhole uses a single unified JSON configuration file. Auto-created with defaults on first startup. Merges pi-vcc and OM settings.

## Unified configuration

The config system is defined in [[src/core/unified-config.ts]]. Key functions:

- `loadUnifiedConfig(cwd)` — Load + merge + migrate + validate + apply env overrides
- `saveUnifiedConfig(partial)` — Save partial config (merges with existing)
- `scaffoldConfig()` — Create config file with defaults if it doesn't exist
- `configFileNeedsMigration()` — Check if on-disk config has legacy keys

### Loading order

Steps performed when loading configuration.

1. Read `pi-blackhole-config.json`
2. Fall back to legacy sources: `pi-vcc-config.json`, `settings.json["pi-blackhole"]`, `.pi/settings.json`
3. Merge with `DEFAULTS` (missing keys filled)
4. Run `migrateOldKnobs()` if new keys absent
5. Apply environment overrides
6. Validate numeric fields and enum values

### Config preserves unknown keys

The config preserves unknown keys, so `_comment` or `_notes` fields can document choices inline. They're ignored by the parser.

## Compaction settings

Settings controlling when and how compaction triggers.

| Setting | Default | Controls |
|---------|---------|----------|
| `compaction` | `"auto"` | When compaction triggers: `"auto"`, `"manual"`, `"off"` |
| `compactionEngine` | `"blackhole"` | Which engine handles auto-compaction: `"blackhole"` or `"pi-default"` |
| `tailBehavior` | `"minimal"` | How much stays visible after compaction: `"minimal"` or `"pi-default"` |
| `compactAfterTokens` | `81000` | Auto-compaction token threshold |

### compaction

Controls when compaction triggers. Replaces legacy `noAutoCompact` and partially replaces `passive`.

| Value | Auto-trigger | `/compact` | `/blackhole` |
|-------|:---:|:---:|:---:|
| `"auto"` | blackhole fires at threshold | blackhole handles | blackhole handles |
| `"manual"` | skipped | Pi handles | blackhole handles |
| `"off"` | skipped (Pi handles) | Pi handles | blackhole handles |

### compactionEngine

Only meaningful when `compaction: "auto"`. For `"manual"`/`"off"`, the hook lets Pi handle everything except `/blackhole`.

- `"blackhole"` — VCC `compile()` generates structured summary + OM injection. Also controls WHEN to compact.
- `"pi-default"` — Pi handles ALL compaction (timing + execution). Blackhole only activates for `/blackhole`.

### Tail behavior

Controls how much of the recent transcript stays visible after compaction. Only applies when `compactionEngine: "blackhole"`.

- `"pi-default"` — Use Pi's `firstKeptEntryId` (respects `keepRecentTokens`, ~20k tokens)
- `"minimal"` — Keep only last user message (aggressive, original pi-vcc behavior)

Ignored when `compactionEngine: "pi-default"`.

## Observational memory settings

Thresholds and budgets for OM workers.

| Setting | Default | Controls |
|---------|---------|----------|
| `memory` | `true` | Enable OM workers + content injection |
| `observeAfterTokens` | `15000` | Min tokens before observer runs |
| `reflectAfterTokens` | `25000` | Min tokens before reflector + dropper run |
| `observerChunkMaxTokens` | `40000` | Max observer input per run (newest-first) |
| `observerPreambleMaxTokens` | `0` (auto) | Preamble cap for observer in manual mode (auto = 30% of chunk) |
| `observationsPoolMaxTokens` | `20000` | Max active observation pool before dropper prunes |
| `observationsPoolTargetTokens` | `10000` | Target size after pruning (derived: half of pool max) |
| `reflectorInputMaxTokens` | `80000` | Max reflector input budget |
| `dropperInputMaxTokens` | `80000` | Max dropper input budget |
| `dropperPressureThreshold` | `0.70` | Fraction of reflectorInputMaxTokens for pressure relief |
| `agentMaxTurns` | `16` | Max agent-loop turns per worker per run |

### memory orthogonality

`memory: false` no longer blocks auto-compaction. Compaction and memory are truly orthogonal:

- `memory: false` + `compaction: "auto"` = compact without OM workers
- `memory: true` + `compaction: "manual"` = OM workers run, no auto-compact

### dropperPressureThreshold

Relief valve: dropper fires when pool reaches this fraction of `reflectorInputMaxTokens`. Prevents reflector from failing with "prompt is too long".

- 0.70 (default): leaves 30% headroom
- Higher (0.90): less aggressive pruning
- Lower (0.50): more aggressive pruning for smaller models
- 1.0: disable pressure-driven dropper entirely

## Model settings

Each worker has a primary model and ordered fallback list. See [[observational-memory#Model resolution]].

| Setting | Default | Controls |
|---------|---------|----------|
| `model` | — | Base fallback model for all workers |
| `observerModel` / `observerFallbackModels` | — / `[]` | Observer primary + fallbacks |
| `reflectorModel` / `reflectorFallbackModels` | — / `[]` | Reflector primary + fallbacks |
| `dropperModel` / `dropperFallbackModels` | — / `[]` | Dropper primary + fallbacks |
| `sessionFallback` | `true` | Fall back to session model when OM candidates exhausted |

### Per-model fields

Each model config supports:

| Field | Default | Controls |
|-------|---------|----------|
| `provider` | — | Provider name (openrouter, cerebras, etc.) |
| `id` | — | Model ID |
| `thinking` | `"low"` | Reasoning effort: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `cooldownHours` | `1` | Cooldown duration after retryable error (0 = disabled) |
| `contextWindow` | inherited | Override context window for this model |

## Debug settings

Debug and logging options.

| Setting | Default | Controls |
|---------|---------|----------|
| `debug` | `false` | Write pre-compaction snapshot to `/tmp/pi-blackhole-debug.json` |
| `debugLog` | `false` | Write continuous JSONL debug log to `~/.pi/agent/pi-blackhole/debug.ndjson` |

## Environment overrides

Environment variables override config file values at load time.

| Variable | Overrides | Example |
|----------|-----------|---------|
| `PI_BLACKHOLE_PASSIVE` | Sets `compaction: "off"` + `memory: false` | `PI_BLACKHOLE_PASSIVE=1` |
| `PI_BLACKHOLE_COMPACTION` | Overrides `compaction` | `PI_BLACKHOLE_COMPACTION=manual` |
| `PI_BLACKHOLE_COMPACTION_ENGINE` | Overrides `compactionEngine` | `PI_BLACKHOLE_COMPACTION_ENGINE=pi-default` |

Legacy env vars still supported: `PI_VCC_OM_PASSIVE`, `PI_OBSERVATIONAL_MEMORY_PASSIVE`.

Invalid values are logged and ignored — must match enum patterns.

## Migration

`migrateOldKnobs()` converts legacy keys to new config surface. Runs in-memory only — on-disk config is never mutated.

| Legacy key | New keys |
|------------|----------|
| `passive: true` | `compaction: "off"` + `memory: false` |
| `noAutoCompact: true` | `compaction: "manual"` |
| `overrideDefaultCompaction: true` | `compactionEngine: "blackhole"` + `tailBehavior: "minimal"` |

Migration runs only when new keys are absent and old keys present. Old keys deleted from in-memory copy. See `MIGRATION-GUIDE.md` for details.

## Configuration presets

Three presets target different context window sizes. Paste the appropriate block into your config.

### Low context (~32k-64k)

Preset for older or fast budget models with smaller context windows.

```json
{
  "observeAfterTokens": 5000,
  "reflectAfterTokens": 10000,
  "compactAfterTokens": 30000,
  "observerChunkMaxTokens": 15000,
  "observerPreambleMaxTokens": 0,
  "observationsPoolMaxTokens": 8000,
  "reflectorInputMaxTokens": 30000,
  "dropperInputMaxTokens": 30000,
  "dropperPressureThreshold": 0.70
}
```

### Medium context (~128k — default)

These are the built-in defaults. See the settings tables above.

### High context (~200k+)

Preset for large models with extended context windows.

```json
{
  "observeAfterTokens": 20000,
  "reflectAfterTokens": 40000,
  "compactAfterTokens": 180000,
  "observerChunkMaxTokens": 80000,
  "observerPreambleMaxTokens": 0,
  "observationsPoolMaxTokens": 40000,
  "reflectorInputMaxTokens": 160000,
  "dropperInputMaxTokens": 160000,
  "dropperPressureThreshold": 0.70
}
```

### Tuning guidance

`compactAfterTokens` should be ~60-70% of your model's context window. If the agent loses context before compaction fires, lower it. If compaction fires too often and breaks flow, raise it. Other thresholds scale proportionally.
