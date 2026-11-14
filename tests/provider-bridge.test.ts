/**
 * Regression tests for the provider stream bridge capture logic.
 *
 * Crash this guards against (pi 1.5.2 + pi-claude-code): OM consolidation
 * agents call compat streamSimple, which resolves custom apis through
 * pi-ai's apiProviderRegistry. pi-claude-code registers a NATIVE provider
 * (pi.registerProvider(providerObject), single argument) whose dispatch is
 * used by the host's main loop but never enters the compat registry. The
 * bridge must therefore capture streamSimple from the registry's public
 * accessors — the old scan read a `registeredProviders` field that no longer
 * exists, leaving the map empty and crashing pi with "No API provider
 * registered for api: claude-code-stream-json" via uncaughtException.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { captureProviderApis, createBridgeStreamFn, scanRegistryProviders } from "../src/om/provider-stream.js";

/**
 * Load the REAL createProvider from the installed pi host (newest release),
 * so the native-provider fixture is the exact object shape the host stores —
 * not a hand-rolled guess. Skips those cases when no host install is found.
 */
async function loadHostCreateProvider(): Promise<((input: any) => any) | undefined> {
	try {
		const releases = join(process.env.HOME ?? "/home/carlos", ".pi/agent/install/releases");
		const versions = readdirSync(releases).sort();
		const latest = versions.at(-1);
		if (!latest) return undefined;
		const mod = (await import(
			join(releases, latest, "node_modules/@earendil-works/pi-ai/dist/models.js"),
		)) as any;
		return typeof mod.createProvider === "function" ? mod.createProvider : undefined;
	} catch {
		return undefined;
	}
}
const hostCreateProvider = await loadHostCreateProvider();

const PROVIDER_STREAMS_KEY = Symbol.for("pi-blackhole:provider-streams");

/** A streamSimple-shaped fn that records its call. */
function marker(_name?: string) {
	return vi.fn(() => ({ result: () => Promise.resolve({}) }));
}

describe("captureProviderApis", () => {
	let streams: Map<string, Function>;

	beforeEach(() => {
		streams = new Map();
	});

	it("indexes a native provider (real host createProvider output) by each model's api id", ({ skip }) => {
		// Built with the host's actual createProvider — the exact object shape the
		// host stores for pi.registerProvider(provider) registrations: top-level
		// stream/streamSimple dispatchers and NO .api property.
		skip ||= !hostCreateProvider;
		const provider = hostCreateProvider!({
			id: "claude-code",
			name: "Claude Code Subscription (Experimental)",
			baseUrl: "process://claude-code",
			models: [{ id: "sonnet", provider: "claude-code", api: "claude-code-stream-json" }],
			api: {
				stream: vi.fn(),
				streamSimple: vi.fn(() => ({ result: () => Promise.resolve({}) })),
			},
		} as any);
		captureProviderApis(streams, provider);
		expect(streams.get("claude-code-stream-json")).toBe(provider.streamSimple);
		expect(streams.size).toBe(1);
	});

	it("indexes a minimal native-shaped provider (top-level streamSimple, no .api)", () => {
		const streamSimple = marker("native");
		captureProviderApis(streams, {
			id: "claude-code",
			streamSimple,
			getModels: () => [
				{ id: "sonnet", provider: "claude-code", api: "claude-code-stream-json" },
				{ id: "opus", provider: "claude-code", api: "claude-code-stream-json" },
			],
		});
		expect(streams.get("claude-code-stream-json")).toBe(streamSimple);
		expect(streams.size).toBe(1);
	});

	it("indexes a createProvider-input-shaped object (api: { stream, streamSimple })", () => {
		const streamSimple = marker("input-shape");
		captureProviderApis(streams, {
			id: "claude-code",
			api: { stream: vi.fn(), streamSimple },
			getModels: () => [{ id: "sonnet", api: "claude-code-stream-json" }],
		});
		expect(streams.get("claude-code-stream-json")).toBe(streamSimple);
	});

	it("indexes an api map provider by entry key", () => {
		const a = marker("a");
		const b = marker("b");
		captureProviderApis(streams, { api: { "api-a": { streamSimple: a }, "api-b": { streamSimple: b } } });
		expect(streams.get("api-a")).toBe(a);
		expect(streams.get("api-b")).toBe(b);
	});

	it("indexes legacy name+config registrations (string api + top-level streamSimple)", () => {
		const streamSimple = marker("legacy");
		captureProviderApis(streams, { api: "my-custom-api", streamSimple });
		expect(streams.get("my-custom-api")).toBe(streamSimple);
	});

	it("does not clobber existing entries", () => {
		const first = marker("first");
		const second = marker("second");
		streams.set("api-x", first);
		captureProviderApis(streams, { api: "api-x", streamSimple: second });
		expect(streams.get("api-x")).toBe(first);
	});

	it("ignores providers without usable api implementations", () => {
		captureProviderApis(streams, { id: "bare", models: [{ api: "whatever" }] });
		captureProviderApis(streams, undefined);
		expect(streams.size).toBe(0);
	});
});

describe("scanRegistryProviders", () => {
	it("captures native and legacy providers through pi 1.5.2 public accessors", ({ skip }) => {
		skip ||= !hostCreateProvider;
		const native = hostCreateProvider!({
			id: "claude-code",
			models: [{ id: "sonnet", provider: "claude-code", api: "claude-code-stream-json" }],
			api: { stream: vi.fn(), streamSimple: vi.fn(() => ({ result: () => Promise.resolve({}) })) },
		} as any);
		const legacyStream = marker("legacy");
		const registry = {
			getRegisteredProviderIds: () => ["claude-code", "my-proxy"],
			getRegisteredNativeProvider: (id: string) => (id === "claude-code" ? native : undefined),
			getRegisteredProviderConfig: (id: string) =>
				id === "my-proxy" ? { api: "proxy-api", streamSimple: legacyStream } : undefined,
		};
		const streams = new Map<string, Function>();
		scanRegistryProviders(streams, registry);
		expect(streams.get("claude-code-stream-json")).toBe(native.streamSimple);
		expect(streams.get("proxy-api")).toBe(legacyStream);
	});

	it("is a no-op without the accessor (old hosts / bad ctx)", () => {
		const streams = new Map<string, Function>();
		scanRegistryProviders(streams, undefined);
		scanRegistryProviders(streams, { registeredProviders: new Map([["claude-code", { api: { streamSimple: marker("x") } }]]) });
		expect(streams.size).toBe(0);
	});
});

describe("createBridgeStreamFn end-to-end (crash regression)", () => {
	beforeEach(() => {
		delete (globalThis as any)[PROVIDER_STREAMS_KEY];
	});

	it("dispatches a claude-code session model to the captured stream instead of compat streamSimple", ({ skip }) => {
		skip ||= !hostCreateProvider;
		const compatStreamSimple = vi.fn(() => {
			throw new Error("No API provider registered for api: claude-code-stream-json");
		});
		const innerStreamSimple = vi.fn(() => ({ result: () => Promise.resolve({}) }));
		const native = hostCreateProvider!({
			id: "claude-code",
			models: [{ id: "sonnet", provider: "claude-code", api: "claude-code-stream-json" }],
			api: { stream: vi.fn(), streamSimple: innerStreamSimple },
		} as any);
		const providerStreams = ((globalThis as any)[PROVIDER_STREAMS_KEY] ??= new Map());
		// Simulate the agent_start scan against a pi 1.5.2-shaped registry.
		scanRegistryProviders(providerStreams, {
			getRegisteredProviderIds: () => ["claude-code"],
			getRegisteredNativeProvider: () => native,
		});

		const bridge = createBridgeStreamFn(compatStreamSimple);
		const model = { provider: "claude-code", id: "sonnet", api: "claude-code-stream-json" };
		expect(() => bridge(model, {}, {})).not.toThrow();
		expect(innerStreamSimple).toHaveBeenCalledOnce();
		expect(compatStreamSimple).not.toHaveBeenCalled();
	});

	it("still falls back to compat streamSimple for builtin apis", () => {
		const compatStreamSimple = marker("compat");
		(globalThis as any)[PROVIDER_STREAMS_KEY] = new Map([["claude-code-stream-json", marker("x")]]);
		const bridge = createBridgeStreamFn(compatStreamSimple);
		bridge({ provider: "zai", id: "glm-5.3", api: "openai-completions" }, {}, {});
		expect(compatStreamSimple).toHaveBeenCalledOnce();
	});
});
