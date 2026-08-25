/**
 * Tests for the session_compact_failed hook (src/hooks/compact-failed.ts).
 *
 * Covers: handler registration, compactInFlight reset on abort/error,
 * overflow-retry visibility, pi-default noise filtering, error notification
 * gating on attribution, and the fromExtension attribution fix (upstream pi
 * only flags content-bearing compactions, so hook { cancel: true } returns are
 * mislabeled — we correct via compactWasPiVcc / lastCompactCancelled).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/om/debug-log.js", () => ({
	debugLog: vi.fn(),
}));

import { debugLog } from "../src/om/debug-log.js";
import { registerCompactFailedHook } from "../src/hooks/compact-failed.js";
import { registerBeforeCompactHook } from "../src/hooks/before-compact.js";

function traceEvents(): string[] {
	return (vi.mocked(debugLog).mock.calls as unknown as [string][]).map((c) => c[0]);
}

function traceData(event: string): Record<string, unknown> | undefined {
	const call = (vi.mocked(debugLog).mock.calls as unknown as [string, Record<string, unknown>][]).find(
		(c) => c[0] === event,
	);
	return call?.[1];
}

interface FailedEvent {
	reason?: "manual" | "threshold" | "overflow";
	errorMessage?: string;
	aborted?: boolean;
	willRetry?: boolean;
	fromExtension?: boolean;
}

function captureHandler(args: {
	compactionEngine?: "blackhole" | "pi-default";
	compactInFlight?: boolean;
	compactWasPiVcc?: boolean;
	lastCompactCancelled?: boolean;
} = {}) {
	let handler: ((event: FailedEvent, ctx: unknown) => void) | undefined;
	const pi = {
		on: vi.fn((name: string, cb: any) => {
			if (name === "session_compact_failed") handler = cb;
		}),
	};
	const controller = args.compactInFlight ? new AbortController() : null;
	const runtime = {
		ensureConfig: vi.fn(),
		config: {
			compactionEngine: args.compactionEngine ?? "blackhole",
			debugLog: false,
		},
		compactInFlight: args.compactInFlight ?? false,
		autoCompactionController: controller,
		compactWasPiVcc: args.compactWasPiVcc ?? false,
		lastCompactCancelled: args.lastCompactCancelled ?? false,
	};
	registerCompactFailedHook(pi as any, runtime as any);
	if (!handler) throw new Error("session_compact_failed handler was not registered");
	return { handler: handler!, pi, runtime };
}

function fakeCtx(overrides: Record<string, unknown> = {}) {
	return {
		cwd: "/tmp/project",
		sessionManager: { getSessionId: vi.fn(() => "test-session-001") },
		hasUI: true,
		ui: { notify: vi.fn() },
		...overrides,
	};
}

function failedEvent(e: FailedEvent = {}): FailedEvent {
	return {
		reason: e.reason ?? "threshold",
		errorMessage: e.errorMessage,
		aborted: e.aborted ?? false,
		willRetry: e.willRetry ?? false,
		fromExtension: e.fromExtension ?? false,
	};
}

describe("compact-failed hook", () => {
	beforeEach(() => {
		vi.mocked(debugLog).mockClear();
	});

	it("registers a session_compact_failed handler", () => {
		const { pi } = captureHandler();
		expect(pi.on).toHaveBeenCalledWith("session_compact_failed", expect.any(Function));
	});

	it("resets compactInFlight and the controller on abort", () => {
		const { handler, runtime } = captureHandler({ compactInFlight: true });
		const ctx = fakeCtx();

		handler(failedEvent({ reason: "manual", aborted: true }), ctx);

		expect(runtime.compactInFlight).toBe(false);
		expect(runtime.autoCompactionController).toBeNull();
		expect(traceEvents()).toContain("compact_failed.compactInFlight_reset");
	});

	it("resets compactInFlight on non-abort errors", () => {
		const { handler, runtime } = captureHandler({ compactInFlight: true });
		const ctx = fakeCtx();

		handler(failedEvent({ reason: "threshold", errorMessage: "provider 500" }), ctx);

		expect(runtime.compactInFlight).toBe(false);
		expect(runtime.autoCompactionController).toBeNull();
		expect(traceEvents()).toContain("compact_failed.compactInFlight_reset");
	});

	it("does not emit a reset trace when nothing was in flight", () => {
		const { handler, runtime } = captureHandler({ compactInFlight: false });
		const ctx = fakeCtx();

		handler(failedEvent({ reason: "manual", aborted: true }), ctx);

		expect(runtime.compactInFlight).toBe(false);
		expect(traceEvents()).not.toContain("compact_failed.compactInFlight_reset");
	});

	it("notifies overflow-retry visibility (aborted + willRetry)", () => {
		const { handler } = captureHandler();
		const ctx = fakeCtx();

		handler(failedEvent({ reason: "overflow", aborted: true, willRetry: true }), ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"blackhole: overflow compaction aborted, retrying turn",
			"info",
		);
	});

	it("does not notify overflow-retry when willRetry is false", () => {
		const { handler } = captureHandler();
		const ctx = fakeCtx();

		handler(failedEvent({ reason: "overflow", aborted: true, willRetry: false }), ctx);

		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("skips detailed handling for pi-default engine failures that are not ours", () => {
		const { handler } = captureHandler({ compactionEngine: "pi-default" });
		const ctx = fakeCtx();

		handler(failedEvent({ reason: "threshold", errorMessage: "boom", fromExtension: false }), ctx);

		// Received is still traced (lightweight observability), then the skip trace.
		expect(traceEvents()).toContain("compact_failed.received");
		expect(traceEvents()).toContain("compact_failed.skipped_pi_default");
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("notifies errors when fromExtension is true", () => {
		const { handler } = captureHandler();
		const ctx = fakeCtx();

		handler(failedEvent({ reason: "overflow", errorMessage: "summary too long", fromExtension: true }), ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"blackhole: compaction failed — summary too long",
			"error",
		);
	});

	it("does not notify errors when not attributed to blackhole", () => {
		const { handler } = captureHandler();
		const ctx = fakeCtx();

		handler(failedEvent({ reason: "threshold", errorMessage: "boom", fromExtension: false }), ctx);

		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("attributes failures to blackhole when compactWasPiVcc is true despite fromExtension false", () => {
		const { handler } = captureHandler({ compactionEngine: "pi-default", compactWasPiVcc: true });
		const ctx = fakeCtx();

		handler(failedEvent({ reason: "manual", errorMessage: "boom", fromExtension: false }), ctx);

		// compactWasPiVcc means the failure is ours: not skipped, error surfaced,
		// and the trace records the corrected attribution.
		expect(traceEvents()).not.toContain("compact_failed.skipped_pi_default");
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"blackhole: compaction failed — boom",
			"error",
		);
		expect(traceData("compact_failed.received")).toMatchObject({
			fromExtension: false,
			compactWasPiVcc: true,
			attributedFromExtension: true,
		});
	});

	it("attributes aborted compactions cancelled by our hook (lastCompactCancelled)", () => {
		// Upstream quirk: a { cancel: true } from session_before_compact emits
		// aborted:true with fromExtension:false. Our flag corrects the record.
		const { handler, runtime } = captureHandler({ compactionEngine: "pi-default", lastCompactCancelled: true });
		const ctx = fakeCtx();

		handler(failedEvent({ reason: "manual", aborted: true, fromExtension: false }), ctx);

		expect(traceData("compact_failed.received")).toMatchObject({
			aborted: true,
			fromExtension: false,
			lastCompactCancelled: true,
			attributedFromExtension: true,
		});
		// Not skipped despite pi-default engine — the cancel was ours.
		expect(traceEvents()).not.toContain("compact_failed.skipped_pi_default");
		// The flag is consumed after the event is handled.
		expect(runtime.lastCompactCancelled).toBe(false);
	});

	it("ignores stale extension ctx during handling", () => {
		const { handler, runtime } = captureHandler();
		const staleCtx = {
			get cwd() {
				throw { message: "This extension ctx is stale after session replacement or reload." };
			},
		};

		expect(() => handler(failedEvent({ reason: "manual", aborted: true }), staleCtx)).not.toThrow();
		expect(runtime.ensureConfig).not.toHaveBeenCalled();
	});
});

describe("compact-failed attribution × before-compact hook", () => {
	beforeEach(() => {
		vi.mocked(debugLog).mockClear();
	});

	function captureBeforeCompact() {
		let handler: ((event: any, ctx: any) => any) | undefined;
		const pi = {
			on: vi.fn((name: string, cb: any) => {
				if (name === "session_before_compact") handler = cb;
			}),
		};
		const runtime = {
			ensureConfig: vi.fn(),
			config: {
				compaction: "auto",
				compactionEngine: "blackhole",
				overrideDefaultCompaction: true,
				noAutoCompact: false,
				memory: true,
			},
			lastCompactCancelled: false,
			compactWasPiVcc: false,
			compactionStats: null,
		};
		registerBeforeCompactHook(pi as any, runtime as any);
		if (!handler) throw new Error("session_before_compact handler was not registered");
		return { handler: handler!, runtime };
	}

	function makeEvent(branchEntries: any[]) {
		return {
			type: "session_before_compact",
			customInstructions: undefined,
			branchEntries,
			preparation: {
				previousSummary: undefined,
				fileOps: { read: [], written: [], edited: [] },
				tokensBefore: 1000,
			},
			signal: new AbortController().signal,
		};
	}

	function fakeCtx2() {
		return {
			cwd: "/tmp/project",
			hasUI: true,
			ui: { notify: vi.fn() },
		};
	}

	it("sets lastCompactCancelled when own-cut cancels (too few live messages)", () => {
		const { handler, runtime } = captureBeforeCompact();
		const branch = [
			{ id: "e1", type: "message", message: { role: "user", content: "hello" } },
			{ id: "e2", type: "message", message: { role: "assistant", content: "hi" } },
		];

		const result = handler(makeEvent(branch), fakeCtx2());

		expect(result).toEqual({ cancel: true });
		expect(runtime.lastCompactCancelled).toBe(true);
	});

	it("resets lastCompactCancelled when a compaction proceeds", () => {
		const { handler, runtime } = captureBeforeCompact();
		runtime.lastCompactCancelled = true;
		const branch = [
			{ id: "e1", type: "message", message: { role: "user", content: "first question" } },
			{ id: "e2", type: "message", message: { role: "assistant", content: "first answer" } },
			{ id: "e3", type: "message", message: { role: "user", content: "second question" } },
		];

		const result = handler(makeEvent(branch), fakeCtx2());

		expect(result?.compaction).toBeTruthy();
		expect(runtime.lastCompactCancelled).toBe(false);
	});
});
