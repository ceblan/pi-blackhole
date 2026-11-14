/**
 * Unified entry point. Registers all pi-vcc + observational-memory
 * commands, hooks, and tools.
 *
 * Upstream: https://github.com/elpapi42/pi-observational-memory (src/index.ts)
 *           https://github.com/sting8k/pi-vcc (index.ts)
 * Merged and extended by pi-vcc-om.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { scaffoldSettings } from "./src/core/settings";
import { registerBeforeCompactHook } from "./src/hooks/before-compact";
import { registerCompactFailedHook } from "./src/hooks/compact-failed";
import { registerPiVccCommand } from "./src/commands/pi-vcc";
import { registerMemoryCommand } from "./src/commands/memory";
import { registerVccRecallCommand } from "./src/commands/vcc-recall";
import { registerConsolidationTrigger } from "./src/om/consolidation.js";
import { registerCompactionTrigger } from "./src/om/compaction-trigger.js";
import { registerRecallTool } from "./src/tools/recall";
import { captureProviderApis, scanRegistryProviders } from "./src/om/provider-stream.js";
import { Runtime } from "./src/om/runtime.js";

export default (pi: ExtensionAPI) => {
	// ── Bridge: capture custom provider stream functions for jiti-loaded agents ──
	// pi-blackhole's consolidation agents are loaded via jiti with moduleCache: false,
	// which creates a separate pi-ai instance whose apiProviderRegistry lacks custom
	// providers (e.g., claude-code registered by other extensions). This bridge stores
	// streamSimple functions in a Symbol.for() global so agents can access them without
	// going through pi-ai's registry.
	//
	// Providers reach the host in two shapes, and both must be captured
	// (see captureProviderApis in provider-stream.ts): the native provider
	// object (pi.registerProvider(provider), single argument — what pi-claude-code
	// uses) and the legacy config (pi.registerProvider(name, config) with a string
	// api id + top-level streamSimple).
	//
	// The registerProvider wrapper only sees calls made through pi-blackhole's own
	// ExtensionAPI object — each extension gets its own instance — so the agent_start
	// scan below is what captures other extensions' providers via the registry's
	// public accessors (getRegisteredProviderIds/getRegisteredNativeProvider/
	// getRegisteredProviderConfig; the old `registeredProviders` field no longer
	// exists and native providers live in a separate private map).
	const PROVIDER_STREAMS_KEY = Symbol.for("pi-blackhole:provider-streams");
	const providerStreams: Map<string, Function> = (globalThis as any)[PROVIDER_STREAMS_KEY] ??= new Map();

	const origRegisterProvider = pi.registerProvider.bind(pi);
	(pi.registerProvider as any) = (nameOrProvider: any, config: any) => {
		captureProviderApis(providerStreams, typeof nameOrProvider === "object" && nameOrProvider !== null ? nameOrProvider : config);
		origRegisterProvider(nameOrProvider, config);
	};

	// Other extensions' registrations never pass through the wrapper above (separate
	// ExtensionAPI instances). On the first agent_start — after all factories have run
	// — scan the model registry through its public accessors and capture both shapes.
	let hasScannedFallback = false;
	pi.on("agent_start", (_event: unknown, ctx: any) => {
		if (hasScannedFallback) return;
		hasScannedFallback = true;
		scanRegistryProviders(providerStreams, (ctx as any)?.modelRegistry);
	});

	scaffoldSettings();

	const omRuntime = new Runtime();

	// Observational memory: background consolidation pipeline
	registerConsolidationTrigger(pi, omRuntime);      // agent_start + turn_end → observer/reflector/dropper
	registerCompactionTrigger(pi, omRuntime);         // agent_end → auto-compaction

	// Pi-vcc: compaction + om injection
	registerBeforeCompactHook(pi, omRuntime);          // session_before_compact → pi-vcc + om content
	registerCompactFailedHook(pi, omRuntime);           // session_compact_failed → failure visibility + compactInFlight guard (pi ≥ 0.84.3)

	// Commands
	registerPiVccCommand(pi, omRuntime);               // /pi-vcc (needs runtime for noAutoCompact flush)
	registerMemoryCommand(pi, omRuntime);              // /blackhole-memory [status|view|full]
	registerVccRecallCommand(pi);                        // /blackhole-recall <query>

	// Tools
	registerRecallTool(pi);                            // unified recall (#N + [12char])
};
