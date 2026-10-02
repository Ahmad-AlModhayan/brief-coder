import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ChunkSink, DrawState, OutputBuffer, StreamKind, drawIncrementally } from "../src/run/output";
import { RunSession, SessionStore } from "../src/run/session";

describe("OutputBuffer", () => {
	it("merges consecutive writes of the same stream", () => {
		const b = new OutputBuffer();
		b.append("out", "a");
		b.append("out", "b\n");
		b.append("err", "oops\n");
		b.append("out", "c");
		assert.deepEqual(b.chunks, [
			{ kind: "out", text: "ab\n" },
			{ kind: "err", text: "oops\n" },
			{ kind: "out", text: "c" },
		]);
		assert.equal(b.size, 9);
		assert.equal(b.toString(), "ab\noops\nc");
	});

	it("normalises CRLF, also when split across writes", () => {
		const b = new OutputBuffer();
		b.append("out", "one\r\ntwo\r");
		b.append("out", "\nthree\r\n");
		assert.equal(b.toString(), "one\ntwo\nthree\n");
	});

	it("treats a lone CR as return-to-line-start (progress bars)", () => {
		const b = new OutputBuffer();
		b.append("out", "start\n");
		b.append("out", "10%\r");
		b.append("out", "50%\r");
		b.append("out", "100%\n");
		assert.equal(b.toString(), "start\n100%\n");
		assert.equal(b.size, b.toString().length);
	});

	it("keeps the newest output under the cap, trimming with slack, and counts what was dropped", () => {
		const b = new OutputBuffer(10);
		b.append("out", "0123456789");
		assert.equal(b.trimmed, 0);
		b.append("out", "abcde"); // 15 > 10: trimmed down to 75% of the cap
		assert.equal(b.toString(), "89abcde");
		assert.equal(b.trimmed, 8);
		assert.equal(b.size, 7);
		b.append("err", "XYZ"); // 10: no trim needed yet
		assert.equal(b.toString(), "89abcdeXYZ");
		assert.equal(b.trimmed, 8);
	});

	it("trims rarely when output streams in at the cap", () => {
		const b = new OutputBuffer(10_000);
		let versions = 0;
		let v = b.version;
		for (let i = 0; i < 10_000; i++) {
			b.append("out", `line ${i}\n`);
			if (b.version !== v) {
				versions++;
				v = b.version;
			}
		}
		// ~110 KB written into a 10 KB buffer: one trim per 2.5 KB of growth, not one per line.
		assert.ok(versions < 60, `trimmed ${versions} times`);
		assert.ok(b.size <= 10_000);
		assert.ok(b.toString().endsWith("line 9999\n"));
	});

	it("survives a flood without growing", () => {
		const b = new OutputBuffer(1000);
		for (let i = 0; i < 20_000; i++) b.append(i % 7 === 0 ? "err" : "out", `line ${i}\n`);
		assert.ok(b.size <= 1000);
		assert.ok(b.toString().endsWith("line 19999\n"));
		assert.equal(b.size, b.toString().length);
	});

	it("clears", () => {
		const b = new OutputBuffer();
		b.append("out", "x");
		const v = b.version;
		b.clear();
		assert.equal(b.size, 0);
		assert.equal(b.chunks.length, 0);
		assert.ok(b.version > v);
	});
});

describe("RunSession", () => {
	it("moves through running → done / failed / stopped", () => {
		const s = new RunSession("k", 1000);
		let notified = 0;
		s.subscribe(() => notified++);
		s.begin("Python");
		assert.equal(s.status, "running");
		s.finish({ code: 0 });
		assert.equal(s.status, "done");
		s.begin("Python");
		s.finish({ code: 2 });
		assert.equal(s.status, "failed");
		s.begin("Python");
		s.finish({ code: null, error: "not installed" });
		assert.equal(s.status, "failed");
		assert.match(s.buffer.toString(), /not installed/);
		s.begin("Python");
		s.finish({ code: null, signal: "SIGTERM" }, true);
		assert.equal(s.status, "stopped");
		assert.ok(notified >= 8);
	});

	it("does not clear while running", () => {
		const s = new RunSession("k", 1000);
		s.begin("JS");
		s.write("out", "x");
		s.clear();
		assert.equal(s.buffer.toString(), "x");
		s.finish({ code: 0 });
		s.clear();
		assert.equal(s.status, "idle");
		assert.equal(s.hasContent, false);
	});
});

describe("SessionStore", () => {
	it("scopes sessions by path and prunes idle ones", () => {
		const store = new SessionStore(() => 1000);
		const a = store.get("a.md|py|1|0");
		store.get("a.md|js|2|0");
		store.get("b.md|py|3|0");
		assert.equal(store.forPath("a.md").length, 2);
		assert.equal(store.get("a.md|py|1|0"), a);
		a.begin("Python");
		a.finish({ code: 0 });
		store.prune(); // drops the two sessions that never ran
		assert.equal(store.peek("a.md|js|2|0"), undefined);
		assert.equal(store.peek("a.md|py|1|0"), a);
		store.clearPath("a.md");
		assert.equal(store.peek("a.md|py|1|0"), undefined);
	});
});

/** A fake view that records what was drawn, the way the output panel does with DOM nodes. */
class FakeView implements ChunkSink {
	chunks: Array<{ kind: StreamKind; text: string }> = [];
	ops = 0;
	charsWritten = 0;
	reset() {
		this.chunks = [];
		this.ops++;
	}
	dropFrom(i: number) {
		this.chunks.length = i;
		this.ops++;
	}
	truncate(i: number, len: number) {
		this.chunks[i].text = this.chunks[i].text.slice(0, len);
		this.ops++;
	}
	append(i: number, text: string) {
		this.chunks[i].text += text;
		this.charsWritten += text.length;
		this.ops++;
	}
	add(kind: StreamKind, text: string) {
		this.chunks.push({ kind, text });
		this.charsWritten += text.length;
		this.ops++;
	}
	text() {
		return this.chunks.map((c) => c.text).join("");
	}
}

describe("drawIncrementally", () => {
	it("always shows exactly the buffer, through random output, progress bars and trims", () => {
		let seed = 42;
		const rnd = (n: number) => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed % n;
		};
		const pieces = ["a", "bc", "line\n", "\r", "50%\r", "\r\n", "x\ny", "\n", "progress 10%", "\rdone\n", "é漢\n"];
		for (const cap of [40, 200, 5000]) {
			const buf = new OutputBuffer(cap);
			const view = new FakeView();
			const st = new DrawState();
			for (let step = 0; step < 4000; step++) {
				const kind = (["out", "err", "info"] as const)[rnd(3)];
				buf.append(kind, pieces[rnd(pieces.length)] + (rnd(4) === 0 ? pieces[rnd(pieces.length)] : ""));
				if (rnd(3) === 0) {
					drawIncrementally(buf, st, view);
					assert.equal(view.text(), buf.toString(), `cap ${cap}, step ${step}`);
					assert.deepEqual(view.chunks.map((c) => c.kind), buf.chunks.map((c) => c.kind));
				}
				if (rnd(500) === 0) buf.clear();
			}
		}
	});

	it("appends only new text while output streams", () => {
		const buf = new OutputBuffer(1_000_000);
		const view = new FakeView();
		const st = new DrawState();
		for (let i = 0; i < 2000; i++) {
			buf.append("out", `row ${i}\n`);
			drawIncrementally(buf, st, view);
		}
		assert.equal(view.text(), buf.toString());
		assert.equal(view.charsWritten, buf.size); // every character written to the view exactly once
	});

	it("rewrites only the current line for progress bars", () => {
		const buf = new OutputBuffer(1_000_000);
		const view = new FakeView();
		const st = new DrawState();
		buf.append("out", "header\n".repeat(1000));
		drawIncrementally(buf, st, view);
		const before = view.charsWritten;
		for (let p = 0; p <= 100; p++) {
			buf.append("out", `\rprogress ${p}%`);
			drawIncrementally(buf, st, view);
		}
		assert.ok(view.text().endsWith("header\nprogress 100%"));
		assert.equal(view.text(), buf.toString());
		assert.ok(view.charsWritten - before < 2000, `rewrote ${view.charsWritten - before} chars`);
	});

	it("reports no change when nothing happened", () => {
		const buf = new OutputBuffer();
		const view = new FakeView();
		const st = new DrawState();
		buf.append("out", "x");
		assert.equal(drawIncrementally(buf, st, view), true);
		assert.equal(drawIncrementally(buf, st, view), false);
	});
});

describe("SessionStore lifetimes", () => {
	it("never drops a session something is showing, so its bar keeps working", () => {
		const store = new SessionStore(() => 1000);
		const shown = store.get("n.md|py|1|0");
		const unsubscribe = shown.subscribe(() => undefined);
		store.get("n.md|py|2|0"); // never shown, never ran
		store.prune(Date.now() + 60 * 60 * 1000);
		assert.equal(store.peek("n.md|py|1|0"), shown);
		assert.equal(store.peek("n.md|py|2|0"), undefined);
		store.clearPath("n.md");
		assert.equal(store.peek("n.md|py|1|0"), shown, "Clear keeps sessions that are on screen");
		unsubscribe();
		store.prune();
		assert.equal(store.peek("n.md|py|1|0"), undefined, "empty and unshown: dropped");
	});

	it("drops output nobody has looked at for a while", () => {
		const store = new SessionStore(() => 1000);
		const s = store.get("n.md|py|3|0");
		s.begin("Python");
		s.write("out", "result");
		s.finish({ code: 0 });
		store.prune(Date.now() + 60_000);
		assert.equal(store.peek("n.md|py|3|0"), s, "recent output is kept");
		store.prune(Date.now() + 11 * 60_000);
		assert.equal(store.peek("n.md|py|3|0"), undefined, "old, unshown output is dropped");
	});

	it("Stop before the program starts cancels it", () => {
		const s = new RunSession("k", 100);
		s.begin("Python");
		assert.equal(s.cancelled, false);
		s.stop();
		assert.equal(s.cancelled, true);
		s.finish({ code: null, signal: "SIGTERM" }, true);
		assert.equal(s.status, "stopped");
		assert.equal(s.cancelled, false);
	});
});
