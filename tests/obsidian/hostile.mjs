// Tests the notebook rule in real Obsidian: before trust, no notebook text reaches another plugin's
// markdown post-processor or code-block processor as code, on any path. Needs Obsidian installed and a
// built main.js, so it runs locally rather than in CI: `npm run build && npm run test:obsidian`.
// Isolated profile and scratch vault; nothing of the user's is touched. Optional: `--shots <dir>`.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const BIN = process.env.OBSIDIAN_BIN ?? (process.platform === "win32" ? "C:/Program Files/Obsidian/Obsidian.exe" : process.platform === "darwin" ? "/Applications/Obsidian.app/Contents/MacOS/Obsidian" : "obsidian");
const ROOT = path.join(os.tmpdir(), "bc-hostile-run");
const VAULT = path.join(ROOT, "vault");
const PORT = 9334;
const HITS = 9478;
const HIT = `http://127.0.0.1:${HITS}`;
const shots = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [name, markdown]. Every input carries EVIL, so a processor seeing it is unmistakable.
const FENCES = [["backtick", "```dataviewjs\nEVIL\n```"], ["tilde", "~~~dataviewjs\nEVIL\n~~~"], ["long", "`````evilblock\nEVIL\n`````"], ["long tilde", "~~~~~query\nEVIL\n~~~~~"], ["spaced info", "``` dataviewjs\nEVIL\n```"], ["info with words", "~~~evilblock title\nEVIL\n~~~"], ["unclosed", "```dataviewjs\nEVIL"], ["3 spaces in", "   ```evilblock\n   EVIL\n   ```"], ["shorter closer", "````evilblock\nEVIL\n```\n````"]];
const ENDINGS = [["CRLF", "\r\n"], ["CR", "\r"], ["FF", "\f"], ["VT", "\v"], ["NEL", "\u0085"], ["LS", "\u2028"], ["PS", "\u2029"]];
const TABLE = [
	// Frontmatter, the hole #23 reported.
	["frontmatter $=", "---\n$= EVIL()\n---\nx"],
	["frontmatter =", "---\n= EVIL\n---\nx"],
	["frontmatter CRLF", "---\r\n$= EVIL()\r\n---\r\nx"],
	["frontmatter CR", "---\r$= EVIL()\r---\rx"],
	["frontmatter BOM", "\uFEFF---\n$= EVIL()\n---\nx"],
	["frontmatter leading blank lines", "\n\n---\n$= EVIL()\n---\nx"],
	["frontmatter leading spaces line", "   \n---\n$= EVIL()\n---\nx"],
	["frontmatter ending in dots", "---\n$= EVIL()\n...\nx"],
	["frontmatter trailing spaces", "---   \n$= EVIL()\n---   \nx"],
	["frontmatter unclosed", "---\n$= EVIL()"],
	["frontmatter fence inside", "---\n```dataviewjs\nEVIL\n```\n---\nx"],
	["frontmatter after zero width", "\u200B---\n$= EVIL()\n---\nx"],
	// Indented code.
	["indented $=", "    $= EVIL()"],
	["indented =", "    = EVIL"],
	["indented tab", "\t$= EVIL()"],
	["indented 2 tabs", "\t\t= EVIL"],
	["indented split over lines", "    =\n    EVIL"],
	["indented NBSP", "\u00A0\u00A0\u00A0\u00A0$= EVIL()"],
	["indented in list", "- a\n\n      $= EVIL()"],
	["indented in quote", ">     $= EVIL()"],
	["indented in ordered list", "1.      = EVIL"],
	["indented plain code", "    EVIL()"],
	// Fences of every style.
	...FENCES.map(([n, s]) => [`fence ${n}`, s]),
	...ENDINGS.map(([n, e]) => [`fence ended by ${n}`, `text${e}~~~dataviewjs${e}EVIL${e}~~~${e}`]),
	// Nested in containers.
	["fence in quote", "> ```dataviewjs\n> EVIL\n> ```"],
	["fence in nested quote", "> > ~~~evilblock\n> > EVIL\n> > ~~~"],
	["fence in list", "- ```dataviewjs\n  EVIL\n  ```"],
	["fence in ordered list", "1. ~~~query\n   EVIL\n   ~~~"],
	["fence in list in quote", "> - ```evilblock\n>   EVIL\n>   ```"],
	["fence in quote in list", "- > ```evilblock\n  > EVIL\n  > ```"],
	["fence in task item", "- [ ] ```dataviewjs\n  EVIL\n  ```"],
	["fence in callout", "> [!note]\n> ```dataviewjs\n> EVIL\n> ```"],
	["fence in collapsed callout", "> [!tip]- Title\n> ~~~evilblock\n> EVIL\n> ~~~"],
	["fence in footnote", "x[^1]\n\n[^1]: ~~~dataviewjs\n    EVIL\n"],
	["fence after unclosed math", "$$\n\n```dataviewjs\nEVIL\n```"],
	["fence after comment", "%%\n\n```dataviewjs\nEVIL\n```"],
	["frontmatter in callout", "> [!note]\n> ---\n> $= EVIL()\n> ---"],
	["inline in callout title", "> [!note] `$= EVIL()`\n> body"],
	["inline in callout", "> [!note]\n> `= EVIL`"],
	["indented in callout", "> [!note]\n>     $= EVIL()"],
	// Inline code.
	["inline $=", "`$= EVIL()`"],
	["inline =", "`= EVIL`"],
	["inline double ticks", "``$= EVIL()``"],
	["inline padded", "` $= EVIL() `"],
	["inline over two lines", "`$=\nEVIL()`"],
	["inline in heading", "# `$= EVIL()`"],
	["inline in list", "- `= EVIL`"],
	["inline in table", "| a |\n|---|\n| `$= EVIL()` |"],
	["inline in emphasis", "**`$= EVIL()`**"],
	["inline in link", "[`$= EVIL()`](https://example.com)"],
	["inline in image alt", "![`$= EVIL()`](attachment:a.png)"],
	["inline in footnote", "x[^1]\n\n[^1]: `$= EVIL()`"],
	["inline in comment", "%% `$= EVIL()` %%"],
	["inline in HTML comment", "<!-- `$= EVIL()` -->"],
	["inline after math", "$x$ `$= EVIL()` $y$"],
	["inline inside math", "$`$= EVIL()`$"],
	// HTML.
	["html pre code", "<pre><code>$= EVIL()</code></pre>"],
	["html code", "<code>= EVIL</code>"],
	["html language class", '<pre><code class="language-dataviewjs">EVIL</code></pre>'],
	["html uppercase", "<CODE>$= EVIL()</CODE>"],
	["html tag split", "<code\n>$= EVIL()</code\n>"],
	["html entities", "&lt;code&gt;$= EVIL()&lt;/code&gt;"],
	["html in div", "<div>\n<code>$= EVIL()</code>\n</div>"],
	["html after safe tag", "<b>\n\\<code>$= EVIL()\\</code>\n</b>"],
	["html after hr", "<hr>\\<code>$= EVIL()\\</code>"],
	["html markdown attr", '<div markdown="1">\n`$= EVIL()`\n</div>'],
	["html comment close", "<!-->`$= EVIL()`"],
	// Bare query forms, and other ways to look like one.
	["bare =", "= EVIL"],
	["bare $=", "$= EVIL()"],
	["escaped =", "\\= EVIL"],
	["setext over query", "$= EVIL()\n---"],
	["entity backtick", "&#96;$= EVIL()&#96;"],
	["reference definition", "[a]: <`$= EVIL()`>\n\n[a]"],
	["deep quote", `${"> ".repeat(500)}\`$= EVIL()\``],
	["deep list", `${Array.from({ length: 200 }, (_, i) => `${" ".repeat(i * 2)}- x`).join("\n")}\n\n\`$= EVIL()\``],
];
// What must load or run nothing at all, whatever else happens.
const ACTIVE = [
	["image", `![x](${HIT}/md.png) EVIL`],
	["reference image", `![x][r] EVIL\n\n[r]: ${HIT}/ref.png`],
	["html image", `<img src="${HIT}/html.png" onerror="window.__pwned=1"> EVIL`],
	["html image after hr", `<hr>\\<img src="${HIT}/hr.png"> EVIL`],
	["iframe", `<iframe src="${HIT}/frame"></iframe> EVIL`],
	["script", "<script>window.__pwned=2</script> EVIL"],
	["style", "<style>body{display:none}</style> EVIL"],
	["javascript link", "[EVIL](javascript:window.__pwned=3)"],
	["vault embed", "![[Private/secret]] EVIL"],
	["math href", "$\\href{javascript:window.__pwned=4}{EVIL}$ EVIL"],
	["math require", `$\\require{${HIT}/mathjax}$ EVIL`],
	["math bbox", `$\\bbox[background-image:url(${HIT}/bbox.png)]{x}$ EVIL`],
	["math entity", `$&#92;require{${HIT}/entity}$ EVIL`],
	["math macro building a command", `$\\def\\a#1{\\requir#1}\\a{e}{${HIT}/macro}$ EVIL`],
	["display math style", `$$\\style{background:url(${HIT}/style.png)}{x}$$\n\nEVIL`],
];

fs.rmSync(ROOT, { recursive: true, force: true });
const plugins = path.join(VAULT, ".obsidian/plugins");
fs.mkdirSync(path.join(plugins, "brief-coder"), { recursive: true });
fs.mkdirSync(path.join(plugins, "probe"));
fs.mkdirSync(path.join(ROOT, "profile"));
fs.mkdirSync(path.join(VAULT, "Private"));
for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(f, path.join(plugins, "brief-coder", f));
fs.writeFileSync(path.join(plugins, "probe/manifest.json"), JSON.stringify({ id: "probe", name: "Probe", version: "1.0.0", minAppVersion: "1.0.0", description: "test", author: "t", isDesktopOnly: false }));
fs.writeFileSync(path.join(plugins, "probe/main.js"), `
const { Plugin } = require('obsidian');
module.exports = class extends Plugin { onload() {
  const p = window.__probe = { fences: [], ran: [] };
  for (const lang of ['dataviewjs', 'evilblock', 'query'])
    this.registerMarkdownCodeBlockProcessor(lang, (src, el, ctx) => p.fences.push(ctx.sourcePath + '|' + lang + ':' + src));
  this.registerMarkdownPostProcessor((el, ctx) => p.ran.push({ path: ctx.sourcePath, code: [...el.querySelectorAll('code')].map((c) => c.textContent), text: el.textContent }));
} };`);
fs.writeFileSync(path.join(VAULT, ".obsidian/community-plugins.json"), JSON.stringify(["brief-coder", "probe"]));
fs.writeFileSync(path.join(ROOT, "profile/obsidian.json"), JSON.stringify({ vaults: { bchostilevault00: { path: VAULT, ts: 1, open: true } } }));
fs.writeFileSync(path.join(VAULT, "Private/secret.md"), "PRIVATE-NOTE-TEXT");
fs.writeFileSync(path.join(VAULT, "control.md"), "---\nkey: value\n---\n```dataviewjs\nCONTROL\n```\n\n`$= CONTROL()`\n");

const notebook = (cells) => JSON.stringify({ cells, metadata: { language_info: { name: "python", file_extension: ".py" } }, nbformat: 4, nbformat_minor: 5 });
const mdCell = (source, extra = {}) => ({ cell_type: "markdown", metadata: {}, source, ...extra });
const outCell = (data) => ({ cell_type: "code", metadata: {}, execution_count: 1, source: "x", outputs: [{ output_type: "display_data", metadata: {}, data }] });
const write = (name, cells) => fs.writeFileSync(path.join(VAULT, name), typeof cells === "string" ? cells : notebook(cells));
const rows = [...TABLE, ...ACTIVE];
rows.forEach(([, s], i) => write(`case-${i}.ipynb`, [mdCell(s, { attachments: { "a.png": { "image/png": "aGk=" } } }), outCell({ "text/markdown": s })]));
write("trusted.ipynb", [outCell({ "text/html": "<b>held</b>" }), outCell({ "text/markdown": "---\n$= EVIL()\n---\nx" }), mdCell(rows.map(([, s]) => s).join("\n\n"))]);
write("deep.ipynb", `{"nbformat":4,"cells":[{"cell_type":"code","source":"x","outputs":[{"output_type":"display_data","data":{"application/json":${"[".repeat(200000)}${"]".repeat(200000)}}}]}]}`);
write("demo.ipynb", [
	mdCell("# Sales notebook\n\nMonthly totals, with **bold**, *italic*, ~~gone~~, a [link](https://example.com) and `inline_code()`.\n\n$$\\sum_{i<n} x_i$$\n\nInline $x^2$ math.\n\n- one\n- two\n  - nested\n- [x] done\n\n1. first\n2. second\n\n> A quote\n\n```python\nprint('fence')\n```\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n\n---\n\n### Smaller"),
	mdCell("## تحليل المبيعات\n\nهذا نص عربي يقرأ من اليمين إلى اليسار، مع `code` داخله.\n\n- البند الأول\n- البند الثاني\n\n| الشهر | المجموع |\n|---|---|\n| يناير | 10 |"),
	mdCell("![pic](attachment:a.png)", { attachments: { "a.png": { "image/png": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC" } } }),
]);

const hits = [];
const server = http.createServer((req, res) => {
	hits.push(req.url);
	res.end("x");
});
server.listen(HITS, "127.0.0.1");
const proc = spawn(BIN, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(ROOT, "profile")}`, "--window-size=1280,900"], { stdio: "ignore" });
const finish = (code) => {
	try {
		if (process.platform === "win32") execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: "ignore" });
		else proc.kill();
	} catch {}
	server.close();
	process.exit(code);
};

let ws;
let nextId = 1;
const waiting = new Map();
for (let i = 0; i < 120 && !ws; i++) {
	try {
		const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page" && t.url.includes("obsidian") && !t.url.includes("starter"));
		if (page) {
			ws = new WebSocket(page.webSocketDebuggerUrl);
			await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
		}
	} catch {
		ws = undefined;
	}
	if (!ws) await sleep(500);
}
if (!ws) {
	console.error("Obsidian didn't open");
	finish(2);
}
ws.onmessage = (m) => {
	const d = JSON.parse(m.data);
	if (d.id && waiting.has(d.id)) {
		waiting.get(d.id)(d);
		waiting.delete(d.id);
	}
};
const send = (method, params = {}) => new Promise((r) => {
	const id = nextId++;
	waiting.set(id, r);
	ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expr) => {
	const r = await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
	if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
	return r.result?.result?.value;
};
const shot = async (name) => {
	if (!shots) return;
	const r = await send("Page.captureScreenshot", { format: "png" });
	fs.mkdirSync(shots, { recursive: true });
	fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(r.result.data, "base64"));
};
const open = (p) => js(`const f=app.vault.getAbstractFileByPath(${JSON.stringify(p)}); const leaf=app.workspace.getLeaf(false); await leaf.openFile(f); app.workspace.setActiveLeaf(leaf,{focus:true});`);
const reset = () => js(`window.__probe.fences.length=0; window.__probe.ran.length=0;`);
// Cells draw as they come near the screen; both copies of the input have to be there.
const settle = async () => {
	for (let i = 0; i < 40; i++) {
		if (await js(`const c=app.workspace.activeLeaf.view.contentEl; return c.querySelectorAll('.coder-nb-md').length>=2 && !c.querySelector('.coder-nb-md:empty')`)) break;
		await sleep(25);
	}
	await sleep(120);
};

for (let i = 0; i < 80; i++) {
	try {
		if (await js(`return !!(window.app && app.workspace && app.workspace.layoutReady)`)) break;
	} catch {}
	await sleep(250);
}
await js(`[...document.querySelectorAll('.modal button')].find(b=>/Trust author/.test(b.textContent))?.click()`);
await sleep(1500);
await js(`document.querySelectorAll('.modal-close-button').forEach(b=>b.click())`);
await sleep(500);

let failed = 0;
const check = (name, ok, detail = "") => {
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
};
check("plugins loaded", await js(`return !!app.plugins.plugins['brief-coder'] && !!window.__probe`));

// The control: the same probe in a note, so "nothing reached it" below means something.
await open("control.md");
await js(`await app.workspace.activeLeaf.setViewState({type:'markdown',state:{file:'control.md',mode:'preview'}})`);
await sleep(900);
const control = await js(`return window.__probe`);
check("control: the probe's post-processor and code-block processor fire on a note", control.fences.some((f) => f.includes("CONTROL")) && control.ran.some((r) => r.code.some((c) => c.includes("CONTROL"))));

const asCode = [];
const ranAtAll = [];
for (let i = 0; i < rows.length; i++) {
	await reset();
	await open(`case-${i}.ipynb`);
	await settle();
	const p = await js(`const c=app.workspace.activeLeaf.view.contentEl; return {...window.__probe, shown:c.textContent.includes('EVIL'), type:app.workspace.activeLeaf.view.getViewType(), live:c.querySelectorAll('.coder-nb-md :is(script,iframe,style),.coder-nb-md img:not([src^="data:image/"])').length}`);
	const code = p.fences.filter((f) => f.includes("EVIL")).concat(p.ran.flatMap((r) => r.code).filter((c) => c.includes("EVIL")));
	const ran = p.fences.length + p.ran.filter((r) => r.path.endsWith(".ipynb")).length;
	if (code.length) asCode.push(rows[i][0]);
	if (ran) ranAtAll.push(rows[i][0]);
	check(rows[i][0], !code.length && !ran && p.shown && !p.live && p.type === "coder-notebook-view", [code.length && `as code: ${JSON.stringify(code[0]).slice(0, 60)}`, ran && `${ran} processor calls`, !p.shown && "text gone", p.live && "live element"].filter(Boolean).join(", "));
}

await reset();
await open("trusted.ipynb");
await settle();
await js(`app.workspace.activeLeaf.view.contentEl.querySelector('.coder-nb-banner button').click()`);
await sleep(800);
await settle();
const t = await js(`return {...window.__probe, frames:app.workspace.activeLeaf.view.contentEl.querySelectorAll('iframe').length}`);
check("after pressing Trust, still nothing reaches a processor", t.frames === 1 && !t.fences.length && !t.ran.some((r) => r.path.endsWith(".ipynb")), `frames ${t.frames}`);

await open("deep.ipynb");
await sleep(1500);
const deep = await js(`const v=app.workspace.activeLeaf.view; return {type:v.getViewType(), refusal:v.contentEl.querySelector('.coder-nb-refusal')?.innerText}`);
check("deep JSON gets the normal refusal message", deep.type === "coder-notebook-view" && !!deep.refusal, deep.refusal?.slice(0, 80) ?? "no message");

await sleep(300);
check("no network", hits.length === 0, hits.join(" "));
check("nothing executed", await js(`return window.__pwned === undefined`));
check("the embedded note never appeared", !(await js(`return window.__probe.ran.some((r)=>r.path.endsWith('.ipynb') && r.text.includes('PRIVATE-NOTE-TEXT')) || !!document.querySelector('.coder-nb')?.textContent.includes('PRIVATE-NOTE-TEXT')`)));

await open("demo.ipynb");
await sleep(1000);
const look = await js(`const c=app.workspace.activeLeaf.view.contentEl; const q=(s)=>c.querySelector('.coder-nb-md '+s); const dir=(e)=>e&&getComputedStyle(e).direction; const md=c.querySelectorAll('.coder-nb-md');
return {h1:q('h1')?.textContent, bold:q('strong')?.textContent, em:q('em')?.textContent, del:q('del')?.textContent, link:q('a')?.getAttribute('href'), inline:q('code')?.textContent, math:!!q('mjx-container'), mathDisplay:!!q('mjx-container[display="true"]'), nested:!!q('ul ul'), ol:!!q('ol'), task:!!q('input[type=checkbox][disabled]') && q('li.task-list-item').getBoundingClientRect().height < 40, quote:q('blockquote')?.textContent.trim(), fence:c.querySelectorAll('.coder-nb-md .cm-editor').length, table:q('table td')?.textContent, hr:!!q('hr'), ar:dir(md[1]?.querySelector('p')), arLi:dir(md[1]?.querySelector('li')), arTd:dir(md[1]?.querySelector('td')), codeDir:dir(q('.coder-nb-code .cm-content')), img:c.querySelector('.coder-nb-md img.coder-nb-image')?.naturalWidth}`);
console.log(JSON.stringify(look));
check("the viewer still shows headings, emphasis, links and inline code", look.h1 === "Sales notebook" && look.bold === "bold" && look.em === "italic" && look.del === "gone" && look.link === "https://example.com" && look.inline === "inline_code()");
check("math, inline and display", look.math && look.mathDisplay);
check("lists, tasks, quotes, tables, rules", look.nested && look.ol && look.task && look.quote === "A quote" && look.table === "1" && look.hr);
check("fenced code in the code view, left to right", look.fence === 1 && look.codeDir === "ltr");
check("Arabic reads right to left in paragraphs, lists and tables", look.ar === "rtl" && look.arLi === "rtl" && look.arTd === "rtl");
check("attachment image shows", look.img === 1);
await shot("notebook-safe-renderer");
await js(`app.emulateMobile(true)`);
await sleep(800);
await reset();
await open("case-0.ipynb");
await settle();
const m = await js(`return window.__probe`);
check("emulated mobile: nothing reaches a processor", !m.fences.length && !m.ran.some((r) => r.path.endsWith(".ipynb")));
await open("demo.ipynb");
await sleep(800);
await shot("notebook-safe-renderer-mobile");
await js(`app.emulateMobile(false)`);

console.log(`\nInputs: ${rows.length}, each as a markdown cell and as text/markdown output`);
console.log(`Rule (reached a processor as code): ${asCode.length} broke${asCode.length ? `: ${asCode.join("; ")}` : ""}`);
console.log(`Structure (a processor ran at all on notebook text): ${ranAtAll.length} rows`);
console.log(failed ? `FAILED: ${failed}` : "OK");
finish(failed ? 1 : 0);
