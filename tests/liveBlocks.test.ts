import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { EditorState } from "@codemirror/state";
import { BlockSpan, scanBlocks, trackEdit } from "../src/ui/liveBlocks";

const PATH = "notes/test.md";

const NOTE = [
	"# Title",
	"",
	"Some text with `inline` code.",
	"",
	"```python",
	"x = 1",
	"print(x)",
	"```",
	"",
	"- a list item",
	"    ```js",
	"    console.log(1)",
	"    ```",
	"",
	"```dataview",
	"TABLE file.name",
	"```",
	"",
	"~~~bash",
	"echo hi",
	"~~~",
	"",
	"The end.",
].join("\n");

/** Applies one edit and returns what trackEdit made of it (null = full scan needed) and the new document. */
function edit(doc: string, spans: BlockSpan[], from: number, to: number, insert: string) {
	const tr = EditorState.create({ doc }).update({ changes: { from, to, insert } });
	return { tracked: trackEdit(spans, tr.state.doc, tr.changes, PATH), doc: tr.state.doc };
}

describe("Live Preview block tracking", () => {
	it("scans fences like the rest of Coder", () => {
		const scan = scanBlocks(EditorState.create({ doc: NOTE }).doc, PATH);
		assert.deepEqual(
			scan.spans.map((s) => [s.meta.lang, NOTE.slice(s.from, s.from + s.meta.openLen), NOTE.slice(s.to - s.meta.closeLen, s.to)]),
			[
				["python", "```python", "```"],
				["js", "    ```js", "    ```"],
				["dataview", "```dataview", "```"],
				["bash", "~~~bash", "~~~"],
			],
		);
		assert.deepEqual(
			scan.keys.map((k, i) => k === `${scan.spans[i].meta.base}|0`),
			[true, true, true, true],
		);
	});

	it("only moves the blocks when typing in ordinary text, backticks included", () => {
		const { spans } = scanBlocks(EditorState.create({ doc: NOTE }).doc, PATH);
		const at = NOTE.indexOf("Some text") + 4;
		for (const insert of ["a", "`", "``", "~", "\n"]) {
			const { tracked } = edit(NOTE, spans, at, at, insert);
			assert.ok(tracked, `"${insert}" should not need a scan`);
			assert.equal(tracked.edited, undefined);
			assert.equal(tracked.spans[0].from, spans[0].from + insert.length);
		}
	});

	it("leaves the blocks before an edit untouched", () => {
		const { spans } = scanBlocks(EditorState.create({ doc: NOTE }).doc, PATH);
		const at = NOTE.indexOf("```dataview") - 1; // the empty line after the js block
		const { tracked } = edit(NOTE, spans, at, at, "x");
		assert.ok(tracked);
		assert.equal(tracked.spans[0], spans[0]);
		assert.equal(tracked.spans[1], spans[1]);
		assert.equal(tracked.spans[3].from, spans[3].from + 1);
	});

	it("re-reads only the edited block when typing inside it", () => {
		const { spans } = scanBlocks(EditorState.create({ doc: NOTE }).doc, PATH);
		const at = NOTE.indexOf("print(x)") + "print(x)".length;
		const { tracked, doc } = edit(NOTE, spans, at, at, "\nprint(x * 2)");
		assert.ok(tracked?.edited);
		assert.equal(tracked.edited.index, 0);
		assert.equal(tracked.edited.code, "x = 1\nprint(x)\nprint(x * 2)");
		const fresh = scanBlocks(doc, PATH);
		assert.deepEqual(tracked.spans, fresh.spans);
		assert.equal(`${tracked.spans[0].meta.base}|0`, fresh.keys[0]);
	});

	it("scans again when a fence line is edited or a new fence appears", () => {
		const { spans } = scanBlocks(EditorState.create({ doc: NOTE }).doc, PATH);
		const open = NOTE.indexOf("```python") + 3;
		assert.equal(edit(NOTE, spans, open, open, "3").tracked, null); // language name
		const close = NOTE.indexOf("print(x)\n```") + "print(x)\n".length;
		assert.equal(edit(NOTE, spans, close, close, "x").tracked, null); // closing fence
		const prose = NOTE.indexOf("The end.");
		assert.equal(edit(NOTE, spans, prose, prose, "```js\n").tracked, null); // new fence
		assert.equal(edit(NOTE, spans, prose, prose + 3, "```").tracked, null); // a line turned into a fence
	});

	it("scans again when a code line turns into a closing fence", () => {
		const doc = "````md\nx ````\nmore\n````\n";
		const { spans } = scanBlocks(EditorState.create({ doc }).doc, PATH);
		const at = doc.indexOf("x ````");
		assert.equal(edit(doc, spans, at, at + 2, "").tracked, null);
	});

	it("scans again when the edited block is identical to another one", () => {
		const doc = "```py\nx\n```\n\n```py\nx\n```\n";
		const { spans } = scanBlocks(EditorState.create({ doc }).doc, PATH);
		assert.equal(edit(doc, spans, 6, 6, "y").tracked, null);
	});

	it("agrees with a full scan after many random edits", () => {
		let doc = NOTE;
		let spans = scanBlocks(EditorState.create({ doc }).doc, PATH).spans;
		let seed = 42;
		const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
		const pieces = ["a", " ", "\n", "`", "~", "```", "x = 2", "", "\n```\n", "````", "    ", "```py\n"];
		let tracked = 0;
		for (let i = 0; i < 3000; i++) {
			const change = () => {
				const from = rand(doc.length + 1);
				return { from, to: Math.min(doc.length, from + (rand(4) === 0 ? rand(6) : 0)), insert: pieces[rand(pieces.length)] };
			};
			// mostly single edits, sometimes two at once (multiple cursors)
			const changes = rand(5) === 0 ? [change(), change()].sort((a, b) => a.from - b.from).filter((c, k, all) => k === 0 || c.from > all[0].to) : [change()];
			const tr = EditorState.create({ doc }).update({ changes });
			const result = trackEdit(spans, tr.state.doc, tr.changes, PATH);
			const fresh = scanBlocks(tr.state.doc, PATH);
			if (result) {
				tracked++;
				assert.deepEqual(result.spans, fresh.spans, `edit ${i}: ${JSON.stringify(changes)}`);
				if (result.edited) {
					assert.equal(result.edited.code, fresh.blocks[result.edited.index].code);
					assert.equal(`${result.spans[result.edited.index].meta.base}|0`, fresh.keys[result.edited.index]);
				}
			}
			doc = tr.state.doc.toString();
			spans = result ? result.spans : fresh.spans; // keep tracking from what trackEdit returned, like the editor does
		}
		assert.ok(tracked > 600, `only ${tracked} of 3000 edits avoided a scan`);
	});
});
