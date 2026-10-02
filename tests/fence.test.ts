import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { blockAtLine, blockKeys, findFencedBlocks, hashString, parseFenceInfo } from "../src/util/fence";

const lines = (s: string) => s.split("\n");

describe("findFencedBlocks", () => {
	it("finds backtick and tilde blocks with their language and code", () => {
		const blocks = findFencedBlocks(lines("# Title\n```python\nprint(1)\nprint(2)\n```\ntext\n~~~js\nconsole.log(1)\n~~~"));
		assert.equal(blocks.length, 2);
		assert.deepEqual(
			blocks.map((b) => [b.lang, b.code, b.startLine, b.endLine, b.closed]),
			[
				["python", "print(1)\nprint(2)", 1, 4, true],
				["js", "console.log(1)", 6, 8, true],
			],
		);
	});

	it("keeps the full info string", () => {
		const [b] = findFencedBlocks(lines('```python title="Demo" norun\nx\n```'));
		assert.equal(b.lang, "python");
		assert.equal(b.info, 'python title="Demo" norun');
	});

	it("needs a closing fence at least as long as the opening one", () => {
		const [b] = findFencedBlocks(lines("````md\n```js\ninner\n```\n````"));
		assert.equal(b.lang, "md");
		assert.equal(b.code, "```js\ninner\n```");
		assert.equal(b.endLine, 4);
	});

	it("does not close a backtick fence with tildes", () => {
		const [b] = findFencedBlocks(lines("```\na\n~~~\nb\n```"));
		assert.equal(b.code, "a\n~~~\nb");
	});

	it("reports unclosed blocks running to the end of the note", () => {
		const [b] = findFencedBlocks(lines("```py\nprint(1)\nprint(2)"));
		assert.equal(b.closed, false);
		assert.equal(b.endLine, 2);
		assert.equal(b.code, "print(1)\nprint(2)");
	});

	it("strips the indentation of list-nested fences", () => {
		const [b] = findFencedBlocks(lines("- item\n    ```bash\n    echo hi\n      nested\n    ```"));
		assert.equal(b.lang, "bash");
		assert.equal(b.code, "echo hi\n  nested");
	});

	it("ignores inline triple backticks and blockquoted fences", () => {
		assert.equal(findFencedBlocks(lines("use ```code``` inline")).length, 0);
		assert.equal(findFencedBlocks(lines("> ```js\n> x\n> ```")).length, 0);
	});

	it("handles empty blocks and no language", () => {
		const [b] = findFencedBlocks(lines("```\n```"));
		assert.equal(b.lang, "");
		assert.equal(b.code, "");
		assert.equal(b.closed, true);
	});

	it("handles CRLF-free trailing spaces on the closing fence", () => {
		const [b] = findFencedBlocks(lines("```go\nfmt.Println(1)\n```   "));
		assert.equal(b.closed, true);
	});
});

describe("parseFenceInfo", () => {
	it("reads language, title and norun", () => {
		assert.deepEqual(parseFenceInfo('python title="My script" norun'), { lang: "python", title: "My script", noRun: true });
		assert.deepEqual(parseFenceInfo("js title:demo.js"), { lang: "js", title: "demo.js", noRun: false });
		assert.deepEqual(parseFenceInfo("{.rust no-run}"), { lang: "rust", title: undefined, noRun: true });
		assert.deepEqual(parseFenceInfo(""), { lang: "", title: undefined, noRun: false });
	});
});

describe("block identity", () => {
	it("hashes deterministically", () => {
		assert.equal(hashString("abc"), hashString("abc"));
		assert.notEqual(hashString("abc"), hashString("abd"));
		assert.match(hashString(""), /^[0-9a-f]{8}$/);
	});

	it("gives identical blocks different keys by order, and keys survive edits elsewhere", () => {
		const a = findFencedBlocks(lines("```py\nx\n```\n```py\nx\n```"));
		const keysA = blockKeys("n.md", a);
		assert.equal(keysA.length, 2);
		assert.notEqual(keysA[0], keysA[1]);
		const b = findFencedBlocks(lines("new paragraph\n\n```py\nx\n```\nmore\n```py\nx\n```"));
		assert.deepEqual(blockKeys("n.md", b), keysA);
	});

	it("finds the block under a line", () => {
		const blocks = findFencedBlocks(lines("a\n```js\n1\n```\nb"));
		assert.equal(blockAtLine(blocks, 0), undefined);
		assert.equal(blockAtLine(blocks, 2)?.lang, "js");
		assert.equal(blockAtLine(blocks, 3)?.lang, "js");
		assert.equal(blockAtLine(blocks, 4), undefined);
	});
});
