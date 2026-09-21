/**
 * Host version gates for the memory workers.
 *
 * The pi extension loader aliases every @earendil-works/* import of the
 * extension to the host modules, so the workers always run against the host's
 * pi-agent-core/pi-ai — the repo's pinned devDependencies only matter for
 * type-checking. Two host eras matter for the workers' system prompt:
 *
 * - pi <= 0.85: AgentContext.systemPrompt is honored. Their pi-ai token
 *   estimator (estimateMessageTokens) only string-handles role "user" and
 *   "toolResult" content; any other role with string content is iterated as
 *   content blocks, crashing with "Cannot read properties of undefined
 *   (reading 'length')" inside clampMaxTokensToContext — which every provider
 *   streamSimple calls. An in-band system message with string content kills
 *   every candidate model on these hosts.
 * - pi >= 0.86: AgentContext.systemPrompt was removed (upstream OM #82); the
 *   system prompt is replayed from a leading role:"system" transcript message.
 */
import { VERSION } from "@earendil-works/pi-coding-agent";

/** Compare a dotted version string against (major, minor, patch). */
function versionAtLeast(version: string | undefined, major: number, minor: number, patch: number): boolean {
	// Unknown/unparseable host version: assume a modern host so the workers
	// keep receiving their prompt (future hosts are >= 0.86 by definition).
	if (typeof version !== "string" || !/^\d+\.\d+/.test(version)) return true;
	const [vMajor = 0, vMinor = 0, vPatch = 0] = version.split(".").map((p) => Number.parseInt(p, 10) || 0);
	return vMajor * 1_000_000 + vMinor * 1_000 + vPatch >= major * 1_000_000 + minor * 1_000 + patch;
}

/**
 * True when the host reads the worker system prompt from a leading
 * role:"system" message in context.messages (pi >= 0.86). On hosts <= 0.85 the
 * legacy AgentContext.systemPrompt property is the only safe delivery: their
 * pi-ai crashes on in-band system messages with string content.
 */
export function hostUsesInbandSystemMessage(version: string | undefined = VERSION): boolean { // @lat: [[observational-memory#Agent prompts and contracts]]
	return versionAtLeast(version, 0, 86, 0);
}
