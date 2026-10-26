/**
 * Agent changes: note edits an agent proposed through coder-bridge.mjs. A changeset is held until
 * you accept it (then written to the notes) or reject it; an accepted one can be reverted. The
 * earlier version of each file is kept in the changeset, and your own later edits always win:
 * accept skips a file that changed since the proposal, revert skips one you changed since accepting.
 * See docs/AGENT_BRIDGE.md.
 */

export const CHANGES_DIR = ".coder/agent-changes";

export type EntryKind = "added" | "changed" | "deleted";
export type Outcome = "applied" | "conflict" | "reverted" | "skipped_changed" | "failed" | null;
export type ChangeStatus = "held" | "accepted" | "partly_accepted" | "rejected" | "reverted" | "partly_reverted";

export interface ChangeEntry {
	path: string;
	kind: EntryKind;
	before: string | null;
	beforeHash: string | null;
	after: string | null;
	outcome: Outcome;
	error?: string;
}

export interface Changeset {
	version: 1;
	id: string;
	actor: string;
	label: string;
	createdAt: string;
	status: ChangeStatus;
	decidedAt: string | null;
	entries: ChangeEntry[];
}

/** File access for applying a changeset (the vault in Obsidian, a Map in tests). */
export interface ChangeIO {
	read(path: string): Promise<string | null>;
	write(path: string, text: string): Promise<void>;
	remove(path: string): Promise<void>;
}

export async function sha256(text: string): Promise<string> {
	const data = new TextEncoder().encode(text);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const hashOf = (text: string | null): Promise<string | null> => (text === null ? Promise.resolve(null) : sha256(text));

/**
 * A plain vault-relative path: forward slashes, no empty, "." / ".." or hidden segments, no drive
 * letters, "~", or names Windows would silently change (trailing dot or space).
 */
export function isSafePath(path: string): boolean {
	if (!path || path.length > 1024 || /[\\:*?"<>|\0]/.test(path)) return false;
	return path.split("/").every((s) => s !== "" && !s.startsWith(".") && s !== "~" && !/[. ]$/.test(s));
}

/** Reads a changeset file, or returns null for anything that isn't one (never throws). */
export function parseChangeset(json: string): Changeset | null {
	try {
		const c = JSON.parse(json) as Changeset;
		const ok =
			c?.version === 1 &&
			typeof c.id === "string" &&
			typeof c.actor === "string" &&
			Array.isArray(c.entries) &&
			c.entries.every((e) => typeof e?.path === "string" && ["added", "changed", "deleted"].includes(e.kind) && isSafePath(e.path));
		return ok ? { ...c, label: String(c.label ?? ""), status: c.status ?? "held" } : null;
	} catch {
		return null;
	}
}

/** "agent:claude-code" → "claude-code". */
export function agentName(actor: string): string {
	return actor.replace(/^agent:/, "") || "agent";
}

/**
 * Writes the agent's versions. Files changed since the proposal are left alone ("conflict"), and
 * so is any path outside what agents may touch now (`allowed`: the bridge's current folders), since
 * a changeset file could have been written by anything on this computer, not only the bridge.
 */
export async function acceptChangeset(c: Changeset, io: ChangeIO, allowed: (path: string) => boolean = () => true): Promise<{ ok: number; skipped: number }> {
	let ok = 0;
	for (const e of c.entries) {
		try {
			if (!isSafePath(e.path) || !allowed(e.path)) {
				e.outcome = "failed";
				e.error = "outside the folders agents may change";
				continue;
			}
			const current = await io.read(e.path);
			if ((await hashOf(current)) !== e.beforeHash) {
				e.outcome = "conflict";
				continue;
			}
			if (e.after === null) await io.remove(e.path);
			else await io.write(e.path, e.after);
			e.outcome = "applied";
			ok++;
		} catch (err) {
			e.outcome = "failed";
			e.error = String(err);
		}
	}
	c.status = ok === c.entries.length ? "accepted" : "partly_accepted";
	c.decidedAt = new Date().toISOString();
	return { ok, skipped: c.entries.length - ok };
}

/** Puts back the earlier versions of applied files, unless you changed them since. */
export async function revertChangeset(c: Changeset, io: ChangeIO): Promise<{ ok: number; skipped: number }> {
	let ok = 0;
	let tried = 0;
	for (const e of c.entries) {
		if (e.outcome !== "applied") continue;
		tried++;
		try {
			const current = await io.read(e.path);
			if ((await hashOf(current)) !== (await hashOf(e.after))) {
				e.outcome = "skipped_changed";
				continue;
			}
			if (e.before === null) await io.remove(e.path);
			else await io.write(e.path, e.before);
			e.outcome = "reverted";
			ok++;
		} catch (err) {
			e.outcome = "failed";
			e.error = String(err);
		}
	}
	c.status = ok === tried ? "reverted" : "partly_reverted";
	c.decidedAt = new Date().toISOString();
	return { ok, skipped: tried - ok };
}

export function rejectChangeset(c: Changeset): void {
	c.status = "rejected";
	c.decidedAt = new Date().toISOString();
}

export type DiffLine = [" " | "+" | "-", string];

/**
 * Line diff for review. Common lines at both ends are trimmed first; the rest gets an LCS when it
 * is small enough, otherwise it is shown as removed-then-added.
 */
export function lineDiff(before: string | null, after: string | null): DiffLine[] {
	const a = before === null ? [] : before.split("\n");
	const b = after === null ? [] : after.split("\n");
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	const out: DiffLine[] = a.slice(0, start).map((l) => [" ", l]);
	const midA = a.slice(start, endA);
	const midB = b.slice(start, endB);
	if (midA.length * midB.length > 4_000_000) {
		for (const l of midA) out.push(["-", l]);
		for (const l of midB) out.push(["+", l]);
	} else {
		// LCS lengths from the end, then walk forward.
		const n = midA.length;
		const m = midB.length;
		const w = m + 1;
		const dp = new Uint32Array((n + 1) * w);
		for (let i = n - 1; i >= 0; i--)
			for (let j = m - 1; j >= 0; j--)
				dp[i * w + j] = midA[i] === midB[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
		let i = 0;
		let j = 0;
		while (i < n || j < m) {
			if (i < n && j < m && midA[i] === midB[j]) {
				out.push([" ", midA[i++]]);
				j++;
			} else if (i < n && (j === m || dp[(i + 1) * w + j] >= dp[i * w + j + 1])) out.push(["-", midA[i++]]);
			else out.push(["+", midB[j++]]);
		}
	}
	for (const l of a.slice(endA)) out.push([" ", l]);
	return out;
}

/** Keeps changed lines plus `context` lines around them; null marks a gap. */
export function hunks(diff: DiffLine[], context = 3): Array<DiffLine | null> {
	const keep = diff.map(() => false);
	diff.forEach(([op], i) => {
		if (op === " ") return;
		for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) keep[k] = true;
	});
	const out: Array<DiffLine | null> = [];
	let gap = false;
	diff.forEach((d, i) => {
		if (keep[i]) {
			if (gap) out.push(null);
			gap = false;
			out.push(d);
		} else gap = true;
	});
	return out;
}
