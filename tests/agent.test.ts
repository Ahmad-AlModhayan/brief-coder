import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ChangeIO, Changeset, acceptChangeset, hunks, lineDiff, parseChangeset, rejectChangeset, revertChangeset, sha256 } from "../src/agent/changes";

function memoryIO(files: Record<string, string>): ChangeIO & { files: Map<string, string> } {
	const map = new Map(Object.entries(files));
	return {
		files: map,
		read: async (p) => map.get(p) ?? null,
		write: async (p, text) => void map.set(p, text),
		remove: async (p) => void map.delete(p),
	};
}

async function changeset(entries: Array<{ path: string; before: string | null; after: string | null }>): Promise<Changeset> {
	return {
		version: 1,
		id: "20261026-120000-abcd",
		actor: "agent:claude-code",
		label: "Tidy notes",
		createdAt: "2026-10-26T12:00:00.000Z",
		status: "held",
		decidedAt: null,
		entries: await Promise.all(
			entries.map(async (e) => ({
				...e,
				kind: e.before === null ? "added" : e.after === null ? "deleted" : "changed",
				beforeHash: e.before === null ? null : await sha256(e.before),
				outcome: null,
			})) as Promise<Changeset["entries"][number]>[],
		),
	};
}

describe("agent changes", () => {
	it("sha256 matches Node's", async () => {
		const { createHash } = await import("node:crypto");
		const text = "ملاحظة\nnote";
		assert.equal(await sha256(text), createHash("sha256").update(text, "utf8").digest("hex"));
	});

	it("accept writes, creates and deletes; revert puts everything back", async () => {
		const io = memoryIO({ "a.md": "old a", "gone.md": "bye" });
		const c = await changeset([
			{ path: "a.md", before: "old a", after: "new a" },
			{ path: "dir/new.md", before: null, after: "fresh" },
			{ path: "gone.md", before: "bye", after: null },
		]);
		assert.deepEqual(await acceptChangeset(c, io), { ok: 3, skipped: 0 });
		assert.equal(c.status, "accepted");
		assert.deepEqual(Object.fromEntries(io.files), { "a.md": "new a", "dir/new.md": "fresh" });
		assert.deepEqual(await revertChangeset(c, io), { ok: 3, skipped: 0 });
		assert.equal(c.status, "reverted");
		assert.deepEqual(Object.fromEntries(io.files), { "a.md": "old a", "gone.md": "bye" });
	});

	it("accept skips a file that changed after the proposal", async () => {
		const io = memoryIO({ "a.md": "edited by you", "b.md": "b" });
		const c = await changeset([
			{ path: "a.md", before: "old a", after: "agent a" },
			{ path: "b.md", before: "b", after: "agent b" },
		]);
		assert.deepEqual(await acceptChangeset(c, io), { ok: 1, skipped: 1 });
		assert.equal(c.status, "partly_accepted");
		assert.equal(c.entries[0].outcome, "conflict");
		assert.equal(io.files.get("a.md"), "edited by you");
		assert.equal(io.files.get("b.md"), "agent b");
	});

	it("an added file that already exists is a conflict", async () => {
		const io = memoryIO({ "new.md": "mine" });
		const c = await changeset([{ path: "new.md", before: null, after: "agent" }]);
		await acceptChangeset(c, io);
		assert.equal(c.entries[0].outcome, "conflict");
		assert.equal(io.files.get("new.md"), "mine");
	});

	it("revert never overwrites your later edits", async () => {
		const io = memoryIO({ "a.md": "old" });
		const c = await changeset([{ path: "a.md", before: "old", after: "agent" }]);
		await acceptChangeset(c, io);
		io.files.set("a.md", "agent, then you");
		assert.deepEqual(await revertChangeset(c, io), { ok: 0, skipped: 1 });
		assert.equal(c.status, "partly_reverted");
		assert.equal(c.entries[0].outcome, "skipped_changed");
		assert.equal(io.files.get("a.md"), "agent, then you");
	});

	it("accept refuses paths outside what agents may change", async () => {
		const io = memoryIO({ "Private/a.md": "old" });
		const c = await changeset([{ path: "Private/a.md", before: "old", after: "agent" }]);
		assert.deepEqual(await acceptChangeset(c, io, (p) => !p.startsWith("Private/")), { ok: 0, skipped: 1 });
		assert.equal(c.entries[0].outcome, "failed");
		assert.equal(io.files.get("Private/a.md"), "old");
	});

	it("revert refuses paths outside what agents may change", async () => {
		const io = memoryIO({ "Private/a.md": "agent" });
		const c = await changeset([{ path: "Private/a.md", before: "old", after: "agent" }]);
		c.entries[0].outcome = "applied"; // as a forged changeset file could claim
		assert.deepEqual(await revertChangeset(c, io, (p) => !p.startsWith("Private/")), { ok: 0, skipped: 1 });
		assert.equal(io.files.get("Private/a.md"), "agent");
	});

	it("reject writes nothing", async () => {
		const io = memoryIO({ "a.md": "old" });
		const c = await changeset([{ path: "a.md", before: "old", after: "agent" }]);
		rejectChangeset(c);
		assert.equal(c.status, "rejected");
		assert.equal(io.files.get("a.md"), "old");
	});

	it("parseChangeset rejects bad or unsafe files", async () => {
		const good = await changeset([{ path: "a.md", before: null, after: "x" }]);
		assert.ok(parseChangeset(JSON.stringify(good)));
		assert.equal(parseChangeset("not json"), null);
		assert.equal(parseChangeset(JSON.stringify({ ...good, version: 2 })), null);
		for (const path of ["../outside.md", ".obsidian/app.json", "notes/../../x.md", "a/.git/config", "..\\x.md", "C:/x.md", "/etc/x.md", "a//b.md", "~/x.md", "dir./x.md", "x.md ", "", "a b.md", "café.md"]) {
			assert.equal(parseChangeset(JSON.stringify({ ...good, entries: [{ ...good.entries[0], path }] })), null, path);
		}
	});
});

describe("lineDiff", () => {
	it("marks removed and added lines, keeping order", () => {
		assert.deepEqual(lineDiff("a\nb\nc", "a\nB\nc\nd"), [
			[" ", "a"],
			["-", "b"],
			["+", "B"],
			[" ", "c"],
			["+", "d"],
		]);
	});

	it("handles new and deleted files", () => {
		assert.deepEqual(lineDiff(null, "x\ny"), [
			["+", "x"],
			["+", "y"],
		]);
		assert.deepEqual(lineDiff("x", null), [["-", "x"]]);
	});

	it("hunks keep context and mark gaps", () => {
		const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
		const after = before.replace("l10", "L10");
		const h = hunks(lineDiff(before, after), 2);
		assert.equal(h[0], null);
		assert.deepEqual(h.slice(1).map((x) => x && x[1]), ["l8", "l9", "l10", "L10", "l11", "l12"]);
	});

	it("stays fast on big files", () => {
		const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
		const start = performance.now();
		lineDiff(big, big.replace("line 2500", "changed"));
		assert.ok(performance.now() - start < 500);
	});
});
