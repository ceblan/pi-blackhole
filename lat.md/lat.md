# pi-blackhole

This directory documents the architecture, design decisions, and functionality of pi-blackhole using [lat.md](https://www.npmjs.com/package/lat.md). pi-blackhole is a unified Pi extension merging deterministic algorithmic compaction with session-surviving observational memory.

## Documentation index

Links to all documentation sections covering architecture, compaction, memory, recall, commands, and configuration.

- [[architecture]] — Project overview, design philosophy, module map, data flow, key types, upstream lineage
- [[vcc-compaction]] — VCC compaction pipeline: compile, section extraction, formatting, before-compact hook
- [[observational-memory]] — OM system: three workers, agent prompt contracts, coverage scoring, session ledger, consolidation, model resolution, cooldowns
- [[recall]] — Recall system: unified tool, BM25 search, drill-down, OM coupling
- [[commands]] — Commands: /blackhole, /blackhole-memory, /blackhole-recall, provider stream bridge
- [[config]] — Configuration: unified config, settings reference, environment overrides, migration, presets
- [[tests]] — Test coverage inventory across all subsystems

## Quick start

Install the extension, then use the three commands:

- `/blackhole` — Compact the conversation (zero LLM cost)
- `/blackhole-memory` — View pipeline status and recorded memory
- `/blackhole-recall <query>` — Search session history

The agent gets a `recall` tool for searching history, expanding entries, and drilling into file content.
