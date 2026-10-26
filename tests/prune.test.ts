import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { pruneTemp } from "../src/run/process";

it("removes build caches unused for 14 days and run folders left by a crash", async () => {
	const cache = join(tmpdir(), "brief-coder-cache", "prune-test");
	const old = join(cache, "old-block");
	const fresh = join(cache, "fresh-block");
	const leftover = join(tmpdir(), `brief-coder-prunetest${process.pid}`);
	// From before the rename (1.0.x).
	const oldLeftover = join(tmpdir(), `obsidian-coder-prunetest${process.pid}`);
	for (const d of [old, fresh, leftover, oldLeftover]) {
		mkdirSync(d, { recursive: true });
		writeFileSync(join(d, "main.cs"), "x");
	}
	const now = Date.now();
	const days = (n: number) => new Date(now - n * 24 * 3600_000);
	utimesSync(old, days(15), days(15));
	utimesSync(fresh, days(13), days(13));
	utimesSync(leftover, days(2), days(2));
	utimesSync(oldLeftover, days(2), days(2));
	await pruneTemp(now);
	assert.ok(!existsSync(old));
	assert.ok(existsSync(fresh));
	assert.ok(!existsSync(leftover));
	assert.ok(!existsSync(oldLeftover));
});
