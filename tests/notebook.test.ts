import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Block, Inline, markdownTooLarge, parseMarkdown, safeTex } from "../src/notebook/markdown";
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

/** One of every shape from the real Obsidian table (tests/obsidian/hostile.mjs). */
const HOSTILE = [
	"---\n$= EVIL()\n---\nx", "\uFEFF---\n= EVIL\n---", "\n\n---\r\n$= EVIL\r\n---", "    $= EVIL()", "\t= EVIL", "- a\n\n      $= EVIL", ">     = EVIL", "```dataviewjs\nEVIL\n```", "~~~evilblock\nEVIL", "x\r~~~query\rEVIL\r~~~", "x\u2028~~~query\u2028EVIL\u2028~~~",
	"> [!note]\n> ```dataviewjs\n> EVIL\n> ```", "- ```dataviewjs\n  EVIL\n  ```", "- > ```evilblock\n  > EVIL\n  > ```", "[^1]: ~~~dataviewjs\n    EVIL", "`$= EVIL`", "``= EVIL``", "# `$= EVIL`", "| a |\n|---|\n| `= EVIL` |", "[`= EVIL`](https://x.example)", "![`$= EVIL`](attachment:a)",
	"<pre><code>$= EVIL</code></pre>", '<pre><code class="language-dataviewjs">EVIL</code></pre>', "<CODE>= EVIL</CODE>", "<code\n>EVIL</code\n>", "&lt;code&gt;= EVIL&lt;/code&gt;", "&#96;$= EVIL&#96;", "<b>\n\\<code>$= EVIL\\</code>\n</b>", '<div markdown="1">\n`$= EVIL`\n</div>', "<!-- `$= EVIL` -->", "$= EVIL", "= EVIL", "\\= EVIL", "%% `= EVIL` %%",
	"<img src=x onerror=EVIL>", "<script>EVIL</script>", "[EVIL](javascript:EVIL)", "![EVIL](https://x.example/a.png)", "![[EVIL]]", "$\\href{javascript:x}{EVIL}$ EVIL",
];

/** Calls `visit` for every block and inline in a tree. */
function walkTree(blocks: Block[], visit: (n: Block | Inline) => void): void {
	const inlines = (nodes: Inline[]) => {
		for (const n of nodes) {
			visit(n);
			if (n.k === "wrap" || n.k === "link") inlines(n.children);
		}
	};
	for (const b of blocks) {
		visit(b);
		if (b.k === "heading" || b.k === "paragraph") inlines(b.content);
		else if (b.k === "quote") walkTree(b.blocks, visit);
		else if (b.k === "list") for (const i of b.items) walkTree(i.blocks, visit);
		else if (b.k === "table") for (const c of [...b.head, ...b.rows.flat()]) inlines(c);
	}
}

/** A readable form of inline nodes: "text", ["em", ...], ["a:href", ...], "BR". */
function plainTree(nodes: Inline[]): unknown[] {
	const out: unknown[] = [];
	for (const n of nodes) {
		const piece = n.k === "wrap" ? [n.tag, ...plainTree(n.children)] : n.k === "link" ? [`a:${n.href}`, ...plainTree(n.children)] : n.k === "break" ? "BR" : n.k === "text" ? n.text : n;
		if (typeof piece === "string" && typeof out[out.length - 1] === "string" && piece !== "BR" && out[out.length - 1] !== "BR") out[out.length - 1] += piece;
		else out.push(piece);
	}
	return out;
}

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

	it("JSON nested too deeply to read back gets the same refusal, not an exception", () => {
		const deep = `{"nbformat":4,"cells":[{"cell_type":"code","source":"","outputs":[{"output_type":"display_data","data":{"application/json":${"[".repeat(200_000)}${"]".repeat(200_000)}}}]}]}`;
		const result = parseNotebook(deep);
		assert.equal(result.ok, false);
		assert.ok(!result.ok && result.code === "json" && /nested too deeply/.test(result.reason));
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

describe("markdown never reaches another plugin's processors", () => {
	it("nothing the notebook view loads can reach Obsidian's markdown renderer or parse markup", () => {
		const seen = new Set<string>();
		const walk = (file: string) => {
			if (seen.has(file)) return;
			seen.add(file);
			const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
			assert.ok(!/\bMarkdownRenderer\b|\bMarkdownPreviewRenderer\b|\bMarkdownPreviewView\b|\bsanitizeHTMLToDom\b|\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b|\bDOMParser\b|\bcreateContextualFragment\b|\bdocument\.write\b/.test(text), `${file} can reach a markdown renderer or an HTML parser`);
			for (const m of text.matchAll(/^(?:import|export) (?!type\b)[^;]*? from "(\.[^"]+)"/gm)) walk(join(dirname(file), `${m[1]}.ts`));
		};
		walk("src/ui/notebookView.ts");
		assert.ok([...seen].some((f) => f.endsWith("notebookMarkdown.ts")), "the walk reached the drawing code");
	});

	it("the tree has no way to say anything but what the drawing code knows", () => {
		const known = new Set(["heading", "paragraph", "code", "math", "quote", "list", "table", "rule", "text", "wrap", "link", "attachment", "break"]);
		const tags = new Set(["em", "strong", "del", "b", "i", "u", "sub", "sup", "kbd"]);
		for (const src of HOSTILE) {
			walkTree(parseMarkdown(src), (n) => {
				assert.ok(known.has(n.k), `${src} made ${n.k}`);
				if (n.k === "wrap") assert.ok(tags.has(n.tag), n.tag);
				if (n.k === "link") assert.ok(/^(?:https?:|mailto:)/i.test(n.href), n.href);
			});
		}
	});

	it("shows hostile text, so nothing silently disappears", () => {
		const shown = (src: string) => {
			const parts: string[] = [];
			walkTree(parseMarkdown(src), (n) => {
				if (n.k === "text") parts.push(n.text);
				else if (n.k === "code") parts.push("code" in n ? n.code : n.text);
				else if (n.k === "attachment") parts.push(n.alt);
				else if (n.k === "math") parts.push(n.tex);
			});
			return parts.join("");
		};
		for (const src of HOSTILE) assert.ok(shown(src).includes("EVIL"), `${JSON.stringify(src)} lost its text`);
	});

	it("frontmatter is just a rule and text", () => {
		for (const src of ["---\n$= EVIL()\n---\nx", "---\r\n$= EVIL()\r\n---\r\nx", "---\r$= EVIL()\r---\rx", "\uFEFF---\n$= EVIL()\n---\nx", "\n\n---\n$= EVIL()\n---\nx"]) {
			assert.deepEqual(parseMarkdown(src), [{ k: "rule" }, { k: "heading", level: 2, content: [{ k: "text", text: "$= EVIL()" }] }, { k: "paragraph", content: [{ k: "text", text: "x" }] }], JSON.stringify(src));
		}
	});
});

describe("reading markdown", () => {
	const inline = (src: string) => {
		const [block] = parseMarkdown(src);
		assert.equal(block.k, "paragraph", src);
		return (block as Extract<Block, { k: "paragraph" }>).content;
	};
	const text = (t: string) => ({ k: "text", text: t });

	it("headings, with and without closing marks, and underlines", () => {
		assert.deepEqual(parseMarkdown("## Two ##"), [{ k: "heading", level: 2, content: [text("Two")] }]);
		assert.deepEqual(parseMarkdown("Title\n==="), [{ k: "heading", level: 1, content: [text("Title")] }]);
		assert.equal(parseMarkdown("#nospace")[0].k, "paragraph");
		assert.equal(parseMarkdown("####### seven")[0].k, "paragraph");
	});

	it("emphasis, nested and unmatched", () => {
		assert.deepEqual(plainTree(inline("**b** *i* ~~d~~ __s__ _e_")), [["strong", "b"], " ", ["em", "i"], " ", ["del", "d"], " ", ["strong", "s"], " ", ["em", "e"]]);
		assert.deepEqual(plainTree(inline("***both***")), [["em", ["strong", "both"]]]);
		assert.deepEqual(plainTree(inline("**a *b* c**")), [["strong", "a ", ["em", "b"], " c"]]);
		assert.deepEqual(plainTree(inline("snake_case_name 2 * 3 * 4")), ["snake_case_name 2 * 3 * 4"]);
		assert.deepEqual(plainTree(inline("*open only")), ["*open only"]);
	});

	it("Arabic emphasis pairs up", () => {
		assert.deepEqual(plainTree(inline("هذا **مهم** جدا")), ["هذا ", ["strong", "مهم"], " جدا"]);
	});

	it("inline code keeps its text exactly and strips one pad", () => {
		assert.deepEqual(inline("`a *b* <i>`"), [{ k: "code", text: "a *b* <i>" }]);
		assert.deepEqual(inline("`` a`b ``"), [{ k: "code", text: "a`b" }]);
		assert.deepEqual(inline("`unclosed"), [text("`unclosed")]);
	});

	it("math, without taking prices for it", () => {
		assert.deepEqual(inline("$x^2$"), [{ k: "math", tex: "x^2", display: false }]);
		assert.deepEqual(parseMarkdown("$$\na\nb\n$$"), [{ k: "math", tex: "\na\nb\n" }]);
		assert.deepEqual(parseMarkdown("$$x$$"), [{ k: "math", tex: "x" }]);
		assert.deepEqual(inline("costs $5 and $10"), [text("costs $5 and $10")]);
		assert.deepEqual(inline("\\$x$"), [text("$x$")]);
	});

	it("takes network and link commands out of math, however they're escaped", () => {
		assert.equal(safeTex("\\href{u}{x}"), "\\backslash{}href{u}{x}");
		assert.equal(safeTex("\\\\\\require{u}"), "\\\\\\backslash{}require{u}");
		assert.equal(safeTex("\\\\href"), "\\\\href");
		assert.equal(safeTex("\\hrefx \\frac12"), "\\hrefx \\frac12");
		for (const c of ["unicode", "style", "class", "cssId", "bbox", "mmlToken", "data", "html"]) assert.ok(safeTex(`\\${c}{x}`).startsWith("\\backslash{}"), c);
	});

	it("links only go to the web or mail, and everything else keeps its text", () => {
		assert.deepEqual(plainTree(inline("[a](https://x.example)")), [["a:https://x.example", "a"]]);
		assert.deepEqual(plainTree(inline('[a](<https://x.example/b c> "t")')), [["a:https://x.example/b c", "a"]]);
		assert.deepEqual(plainTree(inline("see https://x.example/a_(b). <mailto:a@b.c>")), ["see ", ["a:https://x.example/a_(b", "https://x.example/a_(b"], "). ", ["a:mailto:a@b.c", "mailto:a@b.c"]]);
		for (const bad of ["javascript:alert(1)", "obsidian://open?file=x", "data:text/html,x", "file:///etc/passwd", "rel/path.md", "app://x"]) {
			assert.deepEqual(plainTree(inline(`[a](${bad})`)), ["a"], bad);
		}
		const [p] = parseMarkdown("[a][r] [r]\n\n[r]: https://x.example \"t\"") as Extract<Block, { k: "paragraph" }>[];
		assert.deepEqual(plainTree(p.content), [["a:https://x.example", "a"], " ", ["a:https://x.example", "r"]]);
	});

	it("loads nothing: remote images become links, and vault embeds stay text", () => {
		assert.deepEqual(plainTree(inline("![pic](https://x.example/a.png)")), [["a:https://x.example/a.png", "pic"]]);
		assert.deepEqual(plainTree(inline("![pic](rel.png)")), ["pic"]);
		assert.deepEqual(plainTree(inline("![[Private/secret]]")), ["![[Private/secret]]"]);
		assert.deepEqual(inline("![a](attachment:a.png)"), [{ k: "attachment", name: "a.png", alt: "a" }]);
	});

	it("raw HTML is text, apart from a few plain tags that have no attributes", () => {
		assert.deepEqual(plainTree(inline("<b>x</b> a<br>b <sub>1</sub>")), [["b", "x"], " a", "BR", "b ", ["sub", "1"]]);
		for (const raw of ['<img src="x" onerror="y">', "<script>x</script>", '<a href="x">y</a>', '<b onclick="x">y</b>', "<code>y</code>", "<!-- y -->"]) {
			assert.deepEqual(plainTree(inline(raw)), [raw], raw);
		}
		assert.deepEqual(plainTree(inline("<b>never closed")), ["<b>never closed"]);
	});

	it("entities are text once decoded, so they can't start anything", () => {
		assert.deepEqual(inline("&lt;img&gt; &#96;x&#96; &#x26; &nope; &amp;lt;"), [text("<img> `x` & &nope; &lt;")]);
	});

	it("code blocks, fenced and indented, with odd line ends and closers", () => {
		const code = (c: string, language = "") => [{ k: "code", code: c, language }];
		assert.deepEqual(parseMarkdown("```python title\nx\n\ny\n```"), code("x\n\ny", "python"));
		assert.deepEqual(parseMarkdown("~~~\r\nx\r\n~~~"), code("x"));
		assert.deepEqual(parseMarkdown("````\n```\n````"), code("```"));
		assert.deepEqual(parseMarkdown("```\nnever closed"), code("never closed"));
		assert.deepEqual(parseMarkdown("  ```\n    x\n  ```"), code("  x"));
		assert.deepEqual(parseMarkdown("    x\n\n\ty\n"), code("x\n\ny"));
		assert.equal(parseMarkdown("``` a`b ```")[0].k, "paragraph");
	});

	it("lists: nested, ordered from any number, tasks, tight and loose", () => {
		const [list] = parseMarkdown("3. a\n4. b\n   - c\n     d\n") as Extract<Block, { k: "list" }>[];
		assert.equal(list.ordered, true);
		assert.equal(list.start, 3);
		assert.equal(list.tight, true);
		assert.equal(list.items[1].blocks[1].k, "list");
		const [tasks] = parseMarkdown("- [x] done\n- [ ] todo\n- [link](https://x.example)") as Extract<Block, { k: "list" }>[];
		assert.deepEqual(tasks.items.map((i) => i.task), [true, false, null]);
		assert.equal((parseMarkdown("- a\n\n- b") as Extract<Block, { k: "list" }>[])[0].tight, false);
		assert.equal((parseMarkdown("- a\n- b\n\n1. c") as Extract<Block, { k: "list" }>[])[0].tight, true, "a different list after a blank line");
		assert.equal(parseMarkdown("- - -")[0].k, "rule");
		assert.deepEqual(parseMarkdown("text\n2. not a list").map((b) => b.k), ["paragraph"]);
	});

	it("quotes, with lazy lines and blocks inside", () => {
		const [quote] = parseMarkdown("> a\nb\n> ```\n> c\n> ```") as Extract<Block, { k: "quote" }>[];
		assert.deepEqual(quote.blocks.map((b) => b.k), ["paragraph", "code"]);
	});

	it("tables: alignment, escaped pipes, uneven rows", () => {
		const [table] = parseMarkdown("| a | b | c |\n|:--|--:|:-:|\n| 1\\|2 | `x` |\n| 3 | 4 | 5 | 6 |\nnext") as Extract<Block, { k: "table" }>[];
		assert.deepEqual(table.align, ["left", "right", "center"]);
		assert.deepEqual(table.rows[0][0], [text("1|2")]);
		assert.equal(table.rows[0].length, 2);
		assert.equal(table.rows[1].length, 3);
		assert.equal(parseMarkdown("a | b\n--- | ---\n1 | 2")[0].k, "table");
		assert.equal(parseMarkdown("| a |\n| b |")[0].k, "paragraph");
	});

	it("line breaks: a soft one is a space, a hard one breaks", () => {
		assert.deepEqual(plainTree(inline("a\nb  \nc\\\nd")), ["a b", "BR", "c", "BR", "d"]);
	});

	it("Obsidian's own syntax is plain text in a notebook", () => {
		assert.deepEqual(plainTree(inline("[[Note]] ==mark== %%c%% #tag")), ["[[Note]] ==mark== %%c%% #tag"]);
	});

	it("hostile input stays cheap and bounded", () => {
		const inputs = [
			`${" ".repeat(90_000)}x`, `\`${"a ".repeat(45_000)}\``, "![".repeat(45_000), "[".repeat(90_000), "[a](".repeat(20_000), "<b".repeat(45_000), "<b>".repeat(30_000), "*a ".repeat(30_000), "*a_".repeat(30_000), "a*".repeat(45_000), "$".repeat(90_000), "$a ".repeat(30_000), "&".repeat(90_000), "\\".repeat(90_000),
			"`".repeat(90_000), Array.from({ length: 400 }, (_, n) => "`".repeat(n + 1)).join(" "), "https://x/".concat(".".repeat(90_000), "y"), "$$x\n".repeat(100_000), "> ".repeat(45_000), "- ".repeat(45_000), "1. a\n".repeat(100_000), `${"|a".repeat(45_000)}\n${"|-".repeat(45_000)}`, "---\n".repeat(100_000), "# ".concat(" ".repeat(90_000), "x"), `[a]: ${"x".repeat(90_000)} "`, "```\n".repeat(100_000), "<".repeat(90_000), "*".repeat(90_000), `${"**a".repeat(30_000)}${"**".repeat(30_000)}`,
		];
		for (const src of inputs) {
			const t0 = performance.now();
			parseMarkdown(src);
			const ms = performance.now() - t0;
			assert.ok(ms < 1500, `${JSON.stringify(src.slice(0, 16))} took ${Math.round(ms)} ms`);
		}
	});

	it("nesting past the limits stays as text instead of recursing", () => {
		const depth = (blocks: Block[]): number => Math.max(0, ...blocks.map((b) => (b.k === "quote" ? 1 + depth(b.blocks) : b.k === "list" ? 1 + Math.max(...b.items.map((i) => depth(i.blocks))) : 0)));
		assert.ok(depth(parseMarkdown(`${"> ".repeat(5000)}x`)) <= 40);
		assert.ok(depth(parseMarkdown(Array.from({ length: 400 }, (_, n) => `${" ".repeat(n * 2)}- x`).join("\n"))) <= 40);
		const wrapDepth = (nodes: Inline[]): number => Math.max(0, ...nodes.map((n) => (n.k === "wrap" ? 1 + wrapDepth(n.children) : 0)));
		const [p] = parseMarkdown(`${"*a ".repeat(5000)}b${" a*".repeat(5000)}`) as Extract<Block, { k: "paragraph" }>[];
		assert.ok(wrapDepth(p.content) <= 16);
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
		assert.deepEqual(opened(`\uFEFF${nb([])}`).cells, []);
	});
});
