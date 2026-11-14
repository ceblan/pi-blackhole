/**
 * Bridge streamSimple to support custom providers via global Symbol.for().
 *
 * When a custom provider is registered (via index.ts at startup), its stream
 * function is stored under a shared global symbol. This module provides the
 * bridge logic so all OM agents (observer, reflector, dropper) use the same
 * custom-provider resolution instead of each duplicating the 15-line function.
 */
export function createBridgeStreamFn(streamSimple: any) {
	const PROVIDER_STREAMS_KEY = Symbol.for("pi-blackhole:provider-streams");
	return (model: any, ctx: any, opts: any) => {
		const providerStreams: Map<string, Function> | undefined = (globalThis as any)[PROVIDER_STREAMS_KEY];
		if (!providerStreams) return streamSimple(model, ctx, opts);
		const customFn = model?.api ? providerStreams.get(model.api) : undefined;
		return customFn ? customFn(model, ctx, opts) : streamSimple(model, ctx, opts);
	};
}

/** All model sources a registered provider may expose, in preference order. */
function modelsOf(provider: any): any[] {
	const models: any[] = [];
	for (const source of [provider?.getModels?.(), provider?.getAllModels?.(), provider?.models]) {
		if (Array.isArray(source)) models.push(...source);
	}
	return models;
}

/**
 * Index a registered provider's streamSimple implementations into
 * `providerStreams`, keyed by api id. Handles every shape the host accepts:
 *
 * 1. `createProvider()` output — what native registrations (`pi.registerProvider(provider)`,
 *    single argument, e.g. pi-claude-code) actually store: top-level
 *    `streamSimple(model, context, options)` that dispatches per model, plus
 *    `getModels()`/`getAllModels()` whose entries carry the `.api` id. The
 *    object has NO `.api` property of its own.
 * 2. Legacy config (`pi.registerProvider(name, config)`): `config.api` is an
 *    api-id string and `config.streamSimple` is the implementation.
 * 3. createProvider()-input-shaped objects (`api: { stream, streamSimple }` or
 *    an api-id-keyed map) — kept for robustness against future host shapes.
 */
export function captureProviderApis(providerStreams: Map<string, Function>, provider: any): void {
	if (!provider) return;
	// Legacy config: string api id + top-level streamSimple.
	if (typeof provider.api === "string") {
		if (typeof provider.streamSimple === "function" && !providerStreams.has(provider.api)) {
			providerStreams.set(provider.api, provider.streamSimple);
		}
		return;
	}
	// createProvider() output: top-level streamSimple dispatches per model.
	if (typeof provider.streamSimple === "function") {
		for (const model of modelsOf(provider)) {
			if (model?.api && !providerStreams.has(model.api)) providerStreams.set(model.api, provider.streamSimple);
		}
		return;
	}
	const api = provider.api;
	if (api && typeof api.streamSimple === "function") {
		for (const model of modelsOf(provider)) {
			if (model?.api && !providerStreams.has(model.api)) providerStreams.set(model.api, api.streamSimple);
		}
		return;
	}
	if (api && typeof api === "object") {
		for (const [apiId, impl] of Object.entries<any>(api)) {
			if (impl && typeof impl.streamSimple === "function" && !providerStreams.has(apiId)) {
				providerStreams.set(apiId, impl.streamSimple);
			}
		}
	}
}

/**
 * Scan a host ModelRegistry through its public accessors and capture every
 * registered provider's api implementations. The registry exposes
 * `getRegisteredProviderIds()`, `getRegisteredNativeProvider(id)` (object-form
 * registrations) and `getRegisteredProviderConfig(id)` (legacy name+config
 * registrations); older `registeredProviders` fields no longer exist.
 */
export function scanRegistryProviders(providerStreams: Map<string, Function>, registry: any): void {
	if (!registry || typeof registry.getRegisteredProviderIds !== "function") return;
	for (const id of registry.getRegisteredProviderIds() as string[]) {
		captureProviderApis(providerStreams, registry.getRegisteredNativeProvider?.(id));
		captureProviderApis(providerStreams, registry.getRegisteredProviderConfig?.(id));
	}
}
