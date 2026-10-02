import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DrawState, OutputBuffer, drawIncrementally } from "../src/run/output";
import { PAGE_CHARS, PagedText } from "../src/ui/pagedText";

/** Just enough DOM for PagedText: elements, text nodes, append/remove. */
class FakeNode {
	parent: FakeEl | null = null;
	remove() {
		if (!this.parent) return;
		this.parent.children.splice(this.parent.children.indexOf(this as unknown as FakeEl), 1);
		this.parent = null;
	}
}
class FakeText extends FakeNode {
	constructor(public data: string) {
		super();
	}
	get length() {
		return this.data.length;
	}
	appendData(s: string) {
		this.data += s;
	}
	deleteData(offset: number, count: number) {
		this.data = this.data.slice(0, offset) + this.data.slice(offset + count);
	}
	substringData(offset: number, count: number) {
		return this.data.substr(offset, count);
	}
}
class FakeEl extends FakeNode {
	children: Array<FakeEl | FakeText> = [];
	className = "";
	constructor(public tag: string, public ownerDocument: FakeDoc) {
		super();
	}
	get firstChild() {
		return this.children[0] ?? null;
	}
	appendChild(n: FakeEl | FakeText) {
		n.parent = this;
		this.children.push(n);
		return n;
	}
	removeChild(n: FakeEl | FakeText) {
		n.remove();
	}
	get text(): string {
		return this.children.map((c) => (c instanceof FakeText ? c.data : c.text)).join("");
	}
}
class FakeDoc {
	createElement(tag: string) {
		return new FakeEl(tag, this);
	}
	createTextNode(s: string) {
		return new FakeText(s);
	}
}

function setup() {
	const root = new FakeDoc().createElement("pre");
	const view = new PagedText(root as unknown as HTMLElement);
	return { root, view };
}

function pagesOf(root: FakeEl): string[] {
	return root.children.map((p) => (p as FakeEl).text);
}

describe("PagedText", () => {
	it("splits output into pages at line ends only", () => {
		const { root, view } = setup();
		let text = "";
		for (let i = 0; i < 3000; i++) text += `line number ${i}\n`;
		view.add("out", text);
		const pages = pagesOf(root);
		assert.equal(pages.join(""), text);
		assert.ok(pages.length > 5);
		for (const p of pages.slice(0, -1)) {
			assert.ok(p.endsWith("\n"), "pages end with a whole line");
			assert.ok(p.length <= PAGE_CHARS, `page of ${p.length}`);
		}
	});

	it("keeps a very long line on one page", () => {
		const { root, view } = setup();
		const long = "x".repeat(PAGE_CHARS * 3);
		view.add("out", "a\n" + long + "\nb\n");
		const pages = pagesOf(root);
		assert.equal(pages.join(""), "a\n" + long + "\nb\n");
		assert.ok(pages.some((p) => p.includes(long)), "the long line is not split");
	});

	it("matches the buffer exactly through random output, progress bars, trims and clears", () => {
		let seed = 7;
		const rnd = (n: number) => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed % n;
		};
		const pieces = ["a", "bc", "line\n", "\r", "50%\r", "\r\n", "x\ny", "\n", "progress 10%", "\rdone\n", "é漢\n", "z".repeat(900) + "\n"];
		for (const cap of [300, 9000, 60_000]) {
			const buf = new OutputBuffer(cap);
			const { root, view } = setup();
			const st = new DrawState();
			for (let step = 0; step < 6000; step++) {
				const kind = (["out", "err", "info"] as const)[rnd(3)];
				buf.append(kind, pieces[rnd(pieces.length)] + (rnd(4) === 0 ? pieces[rnd(pieces.length)] : ""));
				if (rnd(3) === 0) {
					drawIncrementally(buf, st, view);
					assert.equal(root.text, buf.toString(), `cap ${cap}, step ${step}`);
					assert.equal(view.size, buf.size);
					for (const page of root.children as FakeEl[]) assert.ok(page.children.length > 0, "no empty pages");
				}
				if (rnd(800) === 0) buf.clear();
			}
		}
	});

	it("colours each stream separately", () => {
		const { root, view } = setup();
		view.add("out", "ok\n");
		view.add("err", "bad\n");
		const spans = (root.children[0] as FakeEl).children as FakeEl[];
		assert.deepEqual(
			spans.map((s) => [s.className, s.text]),
			[
				["coder-stream-out", "ok\n"],
				["coder-stream-err", "bad\n"],
			],
		);
	});
});
