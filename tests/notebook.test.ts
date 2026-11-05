import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { markdownTooLarge, neutraliseMarkdown } from "../src/notebook/markdown";
import { cleanText, imageSource, planOutput } from "../src/notebook/outputs";
import { parseNotebook } from "../src/notebook/parse";
import { isNotebookTrusted, moveNotebook, readTrustStore, revokeNotebook, trustNotebook } from "../src/notebook/trust";
import { claimsNotebooks } from "../src/settings";

/** The model's maps have no prototype, so a key from the file can't reach Object.prototype. */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const nb = (cells: unknown[], extra: object = {}) => JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells, ...extra });
const opened = (text: string) => {
	const r = parseNotebook(text);
	if (!r.ok) throw new Error(`expected a notebook, got: ${r.reason}`);
	return r.notebook;
};
const refused = (text: string) => {
	const r = parseNotebook(text);
	if (r.ok) throw new Error("expected a refusal");
	return r;
};

describe("reading nbformat 4", () => {
	it("reads code, markdown and raw cells with sources as a string or a list of lines", () => {
		const { cells } = opened(
			nb([
				{ cell_type: "markdown", metadata: {}, source: ["# Title\n", "text"] },
				{ cell_type: "code", metadata: {}, execution_count: 3, outputs: [], source: "print(1)" },
				{ cell_type: "raw", metadata: {}, source: "raw text" },
			]),
		);
		assert.deepEqual(cells.map((c) => c.kind), ["markdown", "code", "raw"]);
		assert.equal(cells[0].source, "# Title\ntext");
		assert.equal(cells[1].source, "print(1)");
		assert.equal(cells[1].kind === "code" && cells[1].executionCount, 3);
	});

	it("reads all four output types", () => {
		const { cells } = opened(
			nb([
				{
					cell_type: "code",
					source: "",
					outputs: [
						{ output_type: "stream", name: "stderr", text: ["a\n", "b\n"] },
						{ output_type: "display_data", data: { "text/plain": ["x\n", "y"], "image/png": "aGk=\n" }, metadata: {} },
						{ output_type: "execute_result", execution_count: 2, data: { "application/json": { a: 1 } }, metadata: {} },
						{ output_type: "error", ename: "ValueError", evalue: "bad", traceback: ["line 1", "line 2"] },
					],
				},
			]),
		);
		const code = cells[0];
		assert.ok(code.kind === "code");
		assert.deepEqual(code.outputs[0], { kind: "stream", name: "stderr", text: "a\nb\n" });
		assert.deepEqual(plain(code.outputs[1]), { kind: "data", data: { "text/plain": "x\ny", "image/png": "aGk=\n" } });
		assert.deepEqual(plain(code.outputs[2]), { kind: "data", data: { "application/json": '{\n  "a": 1\n}' } });
		assert.deepEqual(code.outputs[3], { kind: "error", name: "ValueError", value: "bad", traceback: "line 1\nline 2" });
	});

	it("finds the language from the file extension, then the language name, then the kernel", () => {
		const lang = (metadata: object) => opened(nb([], { metadata })).language;
		assert.equal(lang({ language_info: { name: "python", file_extension: ".py" } }), "py");
		assert.equal(lang({ language_info: { name: "julia" } }), "jl");
		assert.equal(lang({ kernelspec: { language: "r" } }), "r");
		assert.equal(lang({}), "py");
		assert.equal(lang({ language_info: { file_extension: "../../evil<>" } }), "py");
	});

	it("keeps a cell it doesn't know as a visible placeholder, so nothing silently disappears", () => {
		const { cells } = opened(nb([{ cell_type: "mystery", source: "x" }, 7, null]));
		assert.deepEqual(cells.map((c) => c.kind), ["unsupported", "unsupported", "unsupported"]);
	});

	it("keeps an output it doesn't know as a visible placeholder", () => {
		const { cells } = opened(nb([{ cell_type: "code", source: "", outputs: [{ output_type: "mystery" }, 7] }]));
		assert.ok(cells[0].kind === "code");
		assert.deepEqual(cells[0].outputs, [{ kind: "unknown" }, { kind: "unknown" }]);
	});

	it("reads image attachments of a markdown cell", () => {
		const { cells } = opened(nb([{ cell_type: "markdown", source: "![a](attachment:a.png)", attachments: { "a.png": { "image/png": "aGk=" } } }]));
		assert.ok(cells[0].kind === "markdown");
		assert.deepEqual(plain(cells[0].attachments), { "a.png": { "image/png": "aGk=" } });
	});

	it("survives wrong types inside a cell", () => {
		const { cells } = opened(nb([{ cell_type: "code", source: 5, execution_count: "x", outputs: "no" }, { cell_type: "markdown", source: { a: 1 }, attachments: 3 }]));
		assert.ok(cells[0].kind === "code");
		assert.equal(cells[0].source, "");
		assert.equal(cells[0].executionCount, null);
		assert.deepEqual(cells[0].outputs, []);
		assert.equal(cells[1].source, "");
	});

	it("doesn't let a __proto__ key in the file reach any object", () => {
		opened('{"nbformat":4,"cells":[{"cell_type":"code","source":"","outputs":[{"output_type":"display_data","data":{"__proto__":{"polluted":"yes"}}}]}]}');
		assert.equal(({} as Record<string, unknown>).polluted, undefined);
	});
});

describe("files that aren't nbformat 4 get a clear refusal", () => {
	it("malformed JSON", () => {
		assert.equal(refused('{"nbformat": 4, "cells": [').code, "json");
		assert.equal(refused("").code, "json");
	});

	it("JSON that isn't a notebook", () => {
		for (const text of ["[]", "null", "12", '"x"', "{}", '{"nbformat":4}', '{"nbformat":4,"cells":{}}', '{"nbformat":"4","cells":[]}']) assert.equal(refused(text).code, "not-notebook", text);
	});

	it("older and newer formats, naming the version", () => {
		const old = refused('{"nbformat":3,"worksheets":[{"cells":[]}]}');
		assert.equal(old.code === "version" && old.version, 3);
		const newer = refused('{"nbformat":5,"cells":[]}');
		assert.equal(newer.code === "version" && newer.version, 5);
	});
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
const data = (d: Record<string, string>) => ({ kind: "data" as const, data: d });

describe("what a saved output shows", () => {
	it("plain text and images show without trust", () => {
		assert.deepEqual(planOutput(data({ "text/plain": "hi" }), false), [{ kind: "text", text: "hi", tone: "out", dropped: 0 }]);
		assert.deepEqual(planOutput(data({ "image/png": PNG, "text/plain": "<Figure>" }), false), [{ kind: "image", src: `data:image/png;base64,${PNG}` }]);
		assert.deepEqual(planOutput({ kind: "stream", name: "stderr", text: "e" }, false), [{ kind: "text", text: "e", tone: "err", dropped: 0 }]);
	});

	for (const mime of ["text/html", "application/javascript", "text/javascript"]) {
		it(`${mime} stays blocked until trusted, and the text version shows instead`, () => {
			const plan = planOutput(data({ [mime]: "<script>x</script>", "text/plain": "fallback" }), false);
			assert.deepEqual(plan, [{ kind: "blocked" }, { kind: "text", text: "fallback", tone: "out", dropped: 0 }]);
			assert.ok(!JSON.stringify(plan).includes("<script>"));
		});
	}

	it("once trusted, HTML and scripts go to a frame and nothing else", () => {
		assert.deepEqual(planOutput(data({ "text/html": "<b>x</b>", "text/plain": "x" }), true), [{ kind: "frame", html: "<b>x</b>" }]);
		const [js] = planOutput(data({ "application/javascript": 'a("</script><img>")' }), true);
		assert.ok(js.kind === "frame");
		assert.equal(js.html, '<script>a("<\\/script><img>")</script>');
	});

	it("SVG shows only as an image, never as markup in the page, trusted or not", () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
		for (const trusted of [false, true]) {
			const [part] = planOutput(data({ "image/svg+xml": svg }), trusted);
			assert.ok(part.kind === "image");
			assert.ok(part.src.startsWith("data:image/svg+xml;charset=utf-8,"));
			assert.ok(!/[<>]/.test(part.src), "the markup is encoded");
		}
	});

	it("names a type it can't show, and shows an unknown output as such", () => {
		assert.deepEqual(planOutput(data({ "application/vnd.x+json": "{}" }), false), [{ kind: "unshown", mime: "application/vnd.x+json" }]);
		assert.deepEqual(planOutput({ kind: "unknown" }, false), [{ kind: "unshown", mime: "" }]);
	});

	it("a markdown output goes through the markdown path", () => {
		assert.deepEqual(planOutput(data({ "text/markdown": "# x", "text/plain": "x" }), false), [{ kind: "markdown", source: "# x" }]);
	});

	it("an error shows its traceback without terminal colours", () => {
		const [part] = planOutput({ kind: "error", name: "E", value: "v", traceback: "\u001b[31mE\u001b[0m: v" }, false);
		assert.deepEqual(part, { kind: "text", text: "E: v", tone: "err", dropped: 0 });
	});

	it("caps a huge text output and says how much was dropped", () => {
		const [part] = planOutput({ kind: "stream", name: "stdout", text: "x".repeat(300_000) }, false);
		assert.ok(part.kind === "text");
		assert.equal(part.text.length, 200_000);
		assert.equal(part.dropped, 100_000);
	});

	it("cleanText keeps what a terminal would show after a carriage return", () => {
		assert.equal(cleanText("10%\r50%\r100%\ndone\r\n"), "100%\ndone\n");
		assert.equal(cleanText("\u001b]0;title\u0007a\u001b[1;32mb\u001b[0m"), "ab");
	});
});

describe("image data is checked, not believed", () => {
	const none = (mime: string, d: string) => assert.equal(imageSource(mime, d), null, `${mime}: ${d.slice(0, 30)}`);

	it("accepts real image bytes of an allowed type, line breaks included", () => {
		assert.equal(imageSource("image/png", `${PNG.slice(0, 4)}\n${PNG.slice(4)}\n`), `data:image/png;base64,${PNG}`);
	});

	it("refuses bytes that don't match the type", () => {
		none("image/png", Buffer.from("<html><script>alert(1)</script>").toString("base64"));
		none("image/jpeg", PNG);
		none("image/png", "");
	});

	it("refuses anything that could break out of the data address", () => {
		none("image/png", `${PNG}" onerror="alert(1)`);
		none("image/png", "javascript:alert(1)");
		none("text/html", PNG);
		none("image/png;base64,x", PNG);
		none("image/x-unknown", PNG);
	});

	it("refuses an oversized image", () => {
		none("image/png", PNG + "A".repeat(33 * 1024 * 1024));
		none("image/svg+xml", `<svg>${" ".repeat(9 * 1024 * 1024)}</svg>`);
	});

	it("refuses SVG that isn't SVG", () => {
		none("image/svg+xml", "<html></html>");
	});

	it("a bad image falls through to the text version", () => {
		assert.deepEqual(planOutput(data({ "image/png": "nope", "text/plain": "alt" }), false), [{ kind: "text", text: "alt", tone: "out", dropped: 0 }]);
	});
});

describe("markdown from a notebook reaches Obsidian's renderer with nothing active in it", () => {
	const run = (src: string) => neutraliseMarkdown(src, "N");
	const clean = (src: string) => run(src).text;

	it("leaves ordinary markdown alone", () => {
		const src = "# Title\n\n**bold** a < b and [link](https://x.y) \\* $5\n\n- item\n    - nested\n\n> quote";
		assert.equal(clean(src), src);
	});

	it("takes every fence out, whatever its language or container", () => {
		for (const src of ["```dataviewjs\nevil()\n```", "~~~dataviewjs\nevil()\n~~~", "> ```dataviewjs\n> evil()\n> ```", "1. ```dataviewjs\n   evil()\n   ```", "- > ~~~ dataviewjs\n  > evil()", "    ```dataviewjs\nevil()"]) {
			const { text, slots } = run(src);
			assert.ok(!/dataviewjs|evil|```|~~~/.test(text), `${src} -> ${text}`);
			assert.equal(slots.length, 1, src);
			assert.equal(slots[0].kind, "fence");
		}
	});

	it("keeps the fence's code and language for the view to draw", () => {
		const { text, slots } = run("before\n\n- ```python\n  print(1)\n  ```\n\nafter");
		assert.equal(text, `before\n\n- ${slots[0].token}\n\nafter`);
		assert.deepEqual({ ...slots[0], token: "" }, { kind: "fence", token: "", code: "  print(1)", language: "python" });
	});

	it("a closing fence inside other text can't let a later fence through", () => {
		const { text } = run("```\nx\n> ```\n```dataviewjs\nevil()\n```");
		assert.ok(!/dataviewjs|evil|```/.test(text), text);
	});

	it("takes inline code out, so processors that read <code> see only a token", () => {
		const { text, slots } = run("a `$= dv.evil()` b ``c ` d`` e");
		assert.ok(!text.includes("evil"), text);
		assert.deepEqual(slots.map((s) => s.kind === "inline" && s.code), ["$= dv.evil()", "c ` d"]);
		assert.equal(text, `a ${slots[0].token} b ${slots[1].token} e`);
	});

	it("leaves no backtick a markdown parser could pair up", () => {
		for (const src of ["`open\n- `$= evil`", "`multi\nline`", "``` a`b\n`c", "\\``$= evil`"]) {
			const out = clean(src).replace(/\\`/g, "");
			assert.ok(!out.includes("`"), `${src} -> ${out}`);
		}
	});

	it("turns raw HTML into visible text", () => {
		for (const src of ["<script>evil()</script>", '<img src=x onerror="evil()">', '<iframe src="https://evil.example"></iframe>', '<pre><code class="language-dataviewjs">evil()</code></pre>', "<!-- x -->", "<?php x ?>", "<style>*{display:none}</style>", '<a href="javascript:evil()">x</a>', "<b onclick=evil()>x</b>", "\\\\<script>", "<SCRIPT>", "- <svg onload=evil()>", "<https://evil.example>"]) {
			assert.ok(!/<[a-zA-Z/!?]/.test(clean(src).replace("</b>", "")), `${src} -> ${clean(src)}`);
		}
		assert.equal(clean("<script>"), "&lt;script>");
	});

	it("keeps a few harmless tags with no attributes", () => {
		assert.equal(clean("a<br>b <b>c</b> x<sub>1</sub> <br/>"), "a<br>b <b>c</b> x<sub>1</sub> <br/>");
	});

	it("loads nothing: every image becomes a link, and vault embeds become text", () => {
		assert.equal(clean("![x](https://evil.example/p.png)"), "\\![x](https://evil.example/p.png)");
		assert.equal(clean("![x][r]\n\n[r]: https://evil.example/p.png"), "\\![x][r]\n\n[r]: https://evil.example/p.png");
		assert.equal(clean("![[Private/secret]]"), "\\!\\[\\[Private/secret]]");
		assert.equal(clean("[[a]] [[1, 2], [3]]"), "\\[\\[a]] \\[\\[1, 2], [3]]");
		assert.equal(clean("\\![x](https://a.example/p.png)"), "\\![x](https://a.example/p.png)", "an author's escape isn't undone");
	});

	it("an attachment becomes a slot the view fills from the cell", () => {
		const { text, slots } = run("see ![fig 1](attachment:a.png) here");
		assert.equal(text, `see ${slots[0].token} here`);
		assert.deepEqual({ ...slots[0], token: "" }, { kind: "attachment", token: "", name: "a.png", alt: "fig 1" });
	});

	it("keeps math readable and safe whether or not the parser agrees it's math", () => {
		assert.equal(clean("$a<b$ and $$x<y$$"), "$a< b$ and $$x< y$$");
		assert.equal(clean("$$\n<script>\n$$"), "$$\n< script>\n$$");
		assert.ok(!/<[a-z]/.test(clean("$ <img src=x>$")));
		assert.ok(!clean("$![x](https://a.example/p.png)$").includes("$!["));
		assert.ok(!clean("$`$= evil`$").replace(/\\`/g, "").includes("`"));
	});

	it("takes the network and link commands out, inside math or not", () => {
		for (const cmd of ["\\href{javascript:evil()}{x}", "\\require{evil}", "\\unicode{x}", "\\style{x}{y}", "\\class{x}{y}", "\\cssId{x}{y}"]) {
			assert.ok(!/\\(href|require|unicode|style|class|cssId)/.test(clean(`$${cmd}$`)), cmd);
			assert.ok(!/\\(href|require|unicode|style|class|cssId)/.test(clean(`$ ${cmd}\n$`)), cmd);
		}
		assert.equal(clean("$\\alpha + \\frac{1}{2}$"), "$\\alpha + \\frac{1}{2}$");
	});

	it("makes indented code that an inline query plugin would read harmless", () => {
		assert.equal(clean("    $= evil()"), "    \\$= evil()");
		assert.equal(clean(">     = evil"), ">     \\= evil");
		assert.equal(clean("    print(1)"), "    print(1)");
	});

	it("handles Windows line ends", () => {
		const { slots } = run("```py\r\nx\r\n```\r\n");
		assert.equal(slots[0].kind === "fence" && slots[0].code, "x");
	});
});

describe("trust", () => {
	it("nothing is trusted to begin with", () => {
		assert.equal(isNotebookTrusted({}, "a.ipynb", "h1"), false);
	});

	it("is remembered per notebook, for exactly the contents the user saw", () => {
		const store = trustNotebook({}, "a.ipynb", "h1");
		assert.equal(isNotebookTrusted(store, "a.ipynb", "h1"), true);
		assert.equal(isNotebookTrusted(store, "b.ipynb", "h1"), false, "another notebook");
		assert.equal(isNotebookTrusted(store, "a.ipynb", "h2"), false, "the file changed");
	});

	it("can be revoked", () => {
		assert.equal(isNotebookTrusted(revokeNotebook(trustNotebook({}, "a.ipynb", "h1"), "a.ipynb"), "a.ipynb", "h1"), false);
	});

	it("follows a rename, and ends with a delete", () => {
		const store = trustNotebook({}, "a.ipynb", "h1");
		assert.equal(isNotebookTrusted(moveNotebook(store, "a.ipynb", "x/b.ipynb"), "x/b.ipynb", "h1"), true);
		assert.equal(isNotebookTrusted(moveNotebook(store, "a.ipynb", "x/b.ipynb"), "a.ipynb", "h1"), false);
		assert.deepEqual(revokeNotebook(store, "a.ipynb"), {});
		assert.deepEqual(moveNotebook({}, "a.ipynb", "b.ipynb"), {});
	});

	it("reads a saved store defensively, so a damaged settings file trusts nothing it didn't mean to", () => {
		for (const bad of [undefined, null, 5, "x", [], ["a"]]) assert.deepEqual(readTrustStore(bad), {});
		assert.deepEqual(readTrustStore({ "a.ipynb": "h1", "b.ipynb": 7, "c.ipynb": null, "d.ipynb": true }), { "a.ipynb": "h1" });
		assert.equal(isNotebookTrusted({}, "constructor", "x"), false);
		assert.equal(isNotebookTrusted({}, "toString", String(Object.prototype.toString)), false);
	});
});

describe("who opens .ipynb", () => {
	it("Brief Coder's notebook view, when nothing else does", () => {
		assert.equal(claimsNotebooks(new Set(["py"]), () => false), true);
	});

	it("another plugin keeps it", () => {
		assert.equal(claimsNotebooks(new Set(["py"]), (ext) => ext === "ipynb"), false);
	});

	it("a user who listed it under Code files keeps the text editor", () => {
		assert.equal(claimsNotebooks(new Set(["py", "ipynb"]), () => false), false);
	});
});

describe("the view path has no desktop-only code", () => {
	it("nothing it imports, however deep, reaches Node, Electron or the process runner", () => {
		const seen = new Set<string>();
		const bare = new Set<string>();
		const walk = (file: string) => {
			if (seen.has(file)) return;
			seen.add(file);
			const text = readFileSync(file, "utf8");
			assert.ok(!/\brequire\(|\bimport\(/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")), `${file} loads code at run time`);
			for (const m of text.matchAll(/^(?:import|export) (?!type\b)[^;]*? from "([^"]+)"/gm)) {
				if (m[1].startsWith(".")) walk(join(dirname(file), `${m[1]}.ts`));
				else bare.add(m[1]);
			}
		};
		walk("src/ui/notebookView.ts");
		for (const f of seen) assert.ok(!/process\.ts$|runner\.ts$/.test(f), f);
		for (const b of bare) assert.ok(b === "obsidian" || b.startsWith("@codemirror/") || b.startsWith("@lezer/"), b);
		assert.ok([...seen].some((f) => f.endsWith("parse.ts")), "the walk reached the core");
	});

	it("the manifest stays open to phones", () => {
		assert.equal(JSON.parse(readFileSync("manifest.json", "utf8")).isDesktopOnly, false);
	});
});

describe("findings from the review of #21", () => {
	const run = (src: string) => neutraliseMarkdown(src, "N");
	const clean = (src: string) => run(src).text;

	it("no tilde fence survives odd line ends or containers the scan doesn't know", () => {
		for (const src of ["text\r~~~dataviewjs\rdv.paragraph(1)\r~~~\r", "~~~dataviewjs\r\r\nevil()\r\n~~~", "~~~dataviewjs \nevil()\n~~~", "x[^1]\n\n[^1]: ~~~dataviewjs\n    evil()\n", "a ~~~dataviewjs evil()", "a\f~~~dataviewjs\fevil()"]) {
			assert.ok(!/(^|[^\\])~~/.test(clean(src)), JSON.stringify(src) + " -> " + JSON.stringify(clean(src)));
		}
		assert.equal(clean("~~strike~~"), "~~strike~~");
	});

	it("a safe tag starting an HTML block can't bring live HTML with it", () => {
		for (const src of ['<hr>\\<img src="http://x.example/hr.png">', '<b>\n\\<img src="http://x.example/b.png">\\<code>$= dv.evil()\\</code>\n</b>', "\\\\\\<img src=x>"]) {
			assert.ok(!/<(img|code|\/code)/.test(clean(src)), `${src} -> ${clean(src)}`);
		}
	});

	it("a token can't become a tag name", () => {
		assert.ok(!/<BCNB/.test(clean("<`x` a=b>")), clean("<`x` a=b>"));
		assert.ok(!/<[^\s]/.test(clean("<\\`x <1a <$x <_y").replace(/&lt;/g, "")));
	});

	it("takes the query prefix off code indented inside any container", () => {
		assert.equal(clean("-      $= evil()"), "-      \\$= evil()");
		assert.equal(clean("1.      = x"), "1.      \\= x");
		assert.equal(clean("> -     $= x"), "> -     \\$= x");
		assert.equal(clean("[^1]:     $= x"), "[^1]:     \\$= x");
		assert.equal(clean("$= top"), "\\$= top");
	});

	it("leaves a heading underline alone", () => {
		assert.equal(clean("Title\n==="), "Title\n===");
	});

	it("hostile lines stay cheap", () => {
		for (const src of [`${" ".repeat(90_000)}x`, `\`${"a ".repeat(45_000)}\``, "![".repeat(45_000), "<b".repeat(45_000), `- ${" ".repeat(90_000)}x`, `\`\`\`${" ".repeat(90_000)}x`]) {
			const t0 = performance.now();
			clean(src);
			assert.ok(performance.now() - t0 < 250, `${src.slice(0, 12)} took ${performance.now() - t0} ms`);
		}
	});

	it("markdown too big to scan is flagged, by line or by cell", () => {
		assert.equal(markdownTooLarge("short"), false);
		assert.equal(markdownTooLarge("x".repeat(100_001)), true);
		assert.equal(markdownTooLarge("line\n".repeat(250_000)), true);
	});

	it("a language name can't reach Object.prototype", () => {
		for (const name of ["constructor", "__proto__", "toString"]) {
			assert.equal(typeof opened(nb([], { metadata: { language_info: { name } } })).language, "string", name);
		}
	});

	it("a JSON output that's a list keeps its value", () => {
		const { cells } = opened(nb([{ cell_type: "code", source: "", outputs: [{ output_type: "display_data", data: { "application/json": [1, 2], "application/vnd.x+json": 3 } }] }]));
		assert.ok(cells[0].kind === "code");
		assert.deepEqual(plain(cells[0].outputs[0]), { kind: "data", data: { "application/json": "[\n  1,\n  2\n]", "application/vnd.x+json": "3" } });
	});

	it("reads a file with a byte order mark", () => {
		assert.deepEqual(opened(`﻿${nb([])}`).cells, []);
	});
});
