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

import { captureProviderApis, createBridgeStreamFn, scanRegistryProviders } from "../src/om/provider-stream.js";

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

	it("indexes a native provider (single api impl) by each model's api id", () => {
		const streamSimple = marker("native");
		captureProviderApis(streams, {
			id: "claude-code",
			api: { stream: vi.fn(), streamSimple },
			getModels: () => [
				{ id: "sonnet", provider: "claude-code", api: "claude-code-stream-json" },
				{ id: "opus", provider: "claude-code", api: "claude-code-stream-json" },
			],
		});
		expect(streams.get("claude-code-stream-json")).toBe(streamSimple);
		expect(streams.size).toBe(1);
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
	it("captures native and legacy providers through pi 1.5.2 public accessors", () => {
		const nativeStream = marker("native");
		const legacyStream = marker("legacy");
		const registry = {
			getRegisteredProviderIds: () => ["claude-code", "my-proxy"],
			getRegisteredNativeProvider: (id: string) =>
				id === "claude-code"
					? {
							id,
							api: { stream: vi.fn(), streamSimple: nativeStream },
							getModels: () => [{ id: "sonnet", api: "claude-code-stream-json" }],
						}
					: undefined,
			getRegisteredProviderConfig: (id: string) =>
				id === "my-proxy" ? { api: "proxy-api", streamSimple: legacyStream } : undefined,
		};
		const streams = new Map<string, Function>();
		scanRegistryProviders(streams, registry);
		expect(streams.get("claude-code-stream-json")).toBe(nativeStream);
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

	it("dispatches a claude-code session model to the captured stream instead of compat streamSimple", () => {
		const captured = marker("claude-code-stream");
		const compatStreamSimple = vi.fn(() => {
			throw new Error("No API provider registered for api: claude-code-stream-json");
		});
		const providerStreams = ((globalThis as any)[PROVIDER_STREAMS_KEY] ??= new Map());
		// Simulate the agent_start scan against a pi 1.5.2-shaped registry.
		scanRegistryProviders(providerStreams, {
			getRegisteredProviderIds: () => ["claude-code"],
			getRegisteredNativeProvider: () => ({
				id: "claude-code",
				api: { stream: vi.fn(), streamSimple: captured },
				getModels: () => [{ id: "sonnet", provider: "claude-code", api: "claude-code-stream-json" }],
			}),
		});

		const bridge = createBridgeStreamFn(compatStreamSimple);
		const model = { provider: "claude-code", id: "sonnet", api: "claude-code-stream-json" };
		expect(() => bridge(model, {}, {})).not.toThrow();
		expect(captured).toHaveBeenCalledOnce();
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
