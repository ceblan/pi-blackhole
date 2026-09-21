/**
 * Host-compat gate tests — version detection for the in-band system message.
 *
 * The gate must classify pi hosts by era: <= 0.85 keeps the legacy
 * AgentContext.systemPrompt delivery only; >= 0.86 additionally prepends the
 * prompt as a leading role:"system" transcript message.
 */

import { describe, expect, it } from "vitest";

import { hostUsesInbandSystemMessage } from "../src/om/agents/host-compat.js";

describe("hostUsesInbandSystemMessage", () => {
	it("returns false for pi <= 0.85 hosts (legacy systemPrompt property)", () => {
		expect(hostUsesInbandSystemMessage("0.85.1")).toBe(false);
		expect(hostUsesInbandSystemMessage("0.85.0")).toBe(false);
		expect(hostUsesInbandSystemMessage("0.75.4")).toBe(false);
	});

	it("returns true for pi >= 0.86 hosts (transcript system message)", () => {
		expect(hostUsesInbandSystemMessage("0.86.0")).toBe(true);
		expect(hostUsesInbandSystemMessage("0.86.1")).toBe(true);
		expect(hostUsesInbandSystemMessage("0.87.2")).toBe(true);
		expect(hostUsesInbandSystemMessage("1.0.0")).toBe(true);
	});

	it("handles prerelease suffixes and defaults unknown versions to modern hosts", () => {
		expect(hostUsesInbandSystemMessage("0.86.0-beta.3")).toBe(true);
		expect(hostUsesInbandSystemMessage("0.85.9-rc.1")).toBe(false);
		expect(hostUsesInbandSystemMessage("")).toBe(true);
		expect(hostUsesInbandSystemMessage("junk")).toBe(true);
	});

	it("delegates to the real host VERSION when no explicit version is given", () => {
		// Under the repo devDependencies the aliased host is 0.75.4, so the
		// default path must classify as legacy.
		expect(hostUsesInbandSystemMessage()).toBe(false);
	});
});
