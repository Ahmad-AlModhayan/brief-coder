/**
 * Reads a notebook's markdown into a small tree the view draws with createElement and text nodes only.
 *
 * It never goes through Obsidian's markdown renderer, because that renderer runs every plugin's processors:
 * a fence named `dataviewjs`, `$= ...` in any code element, or a frontmatter block could run as code just
 * because a notebook was opened. Rewriting the text first can't be proved safe, since the rewrite has to
 * agree with a parser it doesn't control. Here there's nothing to agree with: this parser is the only one,
 * no processor runs, and the tree can only say what's listed below. No node carries markup or an attribute
 * from the file, a link's address is checked here, and images load nothing unless they're the cell's own.
 */
export type WrapTag = "em" | "strong" | "del" | "b" | "i" | "u" | "sub" | "sup" | "kbd";

export type Inline =
	| { k: "text"; text: string }
	| { k: "code"; text: string }
	| { k: "math"; tex: string; display: boolean }
	| { k: "wrap"; tag: WrapTag; children: Inline[]; depth: number }
	| { k: "link"; href: string; children: Inline[] }
	| { k: "attachment"; name: string; alt: string }
	| { k: "break" };

export interface ListItem {
	blocks: Block[];
	task: boolean | null;
}

export type Block =
	| { k: "heading"; level: number; content: Inline[] }
	| { k: "paragraph"; content: Inline[] }
	| { k: "code"; code: string; language: string }
	| { k: "math"; tex: string }
	| { k: "quote"; blocks: Block[] }
	| { k: "list"; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
	| { k: "table"; align: ("left" | "right" | "center" | null)[]; head: Inline[][]; rows: Inline[][][] }
	| { k: "rule" };

/** Every way a text might end a line. */
const LINE_END = /\r\n?|[\n\f\v\u0085\u2028\u2029]/g;
const MAX_LINE = 100_000;
const MAX_CELL = 1_000_000;
/** Deeper than this stays as text. It keeps recursion and the page's depth bounded. */
const MAX_BLOCK_DEPTH = 32;
const MAX_WRAP_DEPTH = 16;
const MAX_LINK_DEPTH = 3;
const MAX_LINK_TEXT = 1000;
const MAX_COLUMNS = 100;
/** Characters the slower searches may read per cell. After that, what's left is simply text. */
const SEARCH_BUDGET = 8_000_000;

const SAFE_HREF = /^(?:https?:|mailto:)/i;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const RULE = /^ {0,3}(?:([-*_])(?:[ \t]*\1){2,}[ \t]*|<hr\s*\/?>[ \t]*)$/i;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const TABLE_RULE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const REFERENCE = /^ {0,3}\[([^\]]{1,200})\]:[ \t]*<?([^\s<>]+)>?(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;
const LINK_TARGET = /\([ \t\n]*(?:<([^<>\n]*)>|([^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*))(?:[ \t\n]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t\n]*\)/y;
const REFERENCE_USE = /\[([^\]\n]{0,200})\]/y;
const URL_TEXT = /https?:\/\/[^\s<>`]+/iy;
const ANGLE_LINK = /<((?:https?:\/\/|mailto:)[^\s<>]*)>/iy;
const TAG = /<(\/?)(b|i|u|em|strong|sub|sup|kbd|br)\s*\/?>/iy;
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/y;
const ENTITIES = new Map(Object.entries({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00A0", copy: "©", reg: "®", times: "×", ndash: "–", mdash: "—", hellip: "…", larr: "←", rarr: "→" }));
const PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const SPACE_OR_NOTHING = /^\s?$/u;
const PUNCT_OR_SYMBOL = /^[\p{P}\p{S}]$/u;
const WORD_CHAR = /^[\p{L}\p{N}]$/u;
/** MathJax commands that load something, link somewhere or add markup. */
const ACTIVE_TEX = /\\(?:\\|(?:href|require|unicode|style|class|cssId|bbox|mmlToken|data|html)(?![a-zA-Z]))/g;

/** Beyond these sizes a cell is shown as plain text: reading and drawing it could freeze the app. */
export function markdownTooLarge(source: string): boolean {
	if (source.length > MAX_CELL) return true;
	let start = 0;
	for (;;) {
		const end = source.indexOf("\n", start);
		if ((end < 0 ? source.length : end) - start > MAX_LINE) return true;
		if (end < 0) return false;
		start = end + 1;
	}
}

/** Math goes to MathJax, which can fetch and link: these commands show as text instead. */
export function safeTex(tex: string): string {
	return tex.replace(ACTIVE_TEX, (m) => (m === "\\\\" ? m : `\\backslash{}${m.slice(1)}`));
}

interface Context {
	references: Map<string, string>;
	budget: number;
}

export function parseMarkdown(source: string): Block[] {
	const lines = source.replace(/^\uFEFF/, "").replace(LINE_END, "\n").split("\n");
	const ctx: Context = { references: new Map(), budget: SEARCH_BUDGET };
	for (const line of lines) {
		const m = referenceAt(line);
		if (m) ctx.references.set(m[1].toLowerCase(), m[2]);
	}
	return parseBlocks(lines, ctx, 0);
}

function referenceAt(line: string): RegExpExecArray | null {
	const m = line.includes("]:") ? REFERENCE.exec(line) : null;
	return m && !m[1].startsWith("^") ? m : null;
}

const isBlank = (line: string) => !line.trim();
const indentOf = (line: string) => line.length - line.replace(/^ +/, "").length;
const isHeading = (line: string) => /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line);
const isItem = (line: string) => ITEM.test(line) && !RULE.test(line);

/** Tabs at the start of a line stand for spaces up to the next multiple of four. */
function expandIndent(line: string): string {
	if (line[0] !== "\t" && line[0] !== " ") return line;
	let i = 0;
	let column = 0;
	for (; line[i] === " " || line[i] === "\t"; i++) column += line[i] === "\t" ? 4 - (column % 4) : 1;
	return " ".repeat(column) + line.slice(i);
}

function fenceAt(line: string): RegExpExecArray | null {
	const m = line.includes("``") || line.includes("~~") ? FENCE.exec(line) : null;
	return m && !(m[1][0] === "`" && m[2].includes("`")) ? m : null;
}

/** What ends a paragraph without a blank line. */
function startsBlock(line: string): boolean {
	if (indentOf(line) > 3) return false;
	if (isHeading(line) || fenceAt(line) || RULE.test(line) || QUOTE.test(line) || line.trimStart().startsWith("$$")) return true;
	const item = ITEM.exec(line);
	return !!item && item[4].trim() !== "" && (!/\d/.test(item[2][0]) || parseInt(item[2], 10) === 1);
}

function isTableAt(lines: string[], i: number): boolean {
	const rule = lines[i + 1];
	if (rule === undefined || !rule.includes("-") || !lines[i].includes("|") || !TABLE_RULE.test(rule)) return false;
	const columns = splitRow(lines[i]).length;
	return columns <= MAX_COLUMNS && columns === splitRow(rule).length;
}

function splitRow(line: string): string[] {
	const text = line.trim();
	const cells: string[] = [];
	let cell = "";
	for (let i = text[0] === "|" ? 1 : 0; i < text.length; i++) {
		if (text[i] === "\\" && text[i + 1] === "|") {
			cell += "|";
			i++;
		} else if (text[i] === "|") {
			cells.push(cell);
			cell = "";
		} else cell += text[i];
	}
	if (cell.trim() || !text.endsWith("|")) cells.push(cell);
	return cells.map((c) => c.trim());
}

function parseBlocks(input: string[], ctx: Context, depth: number): Block[] {
	if (depth > MAX_BLOCK_DEPTH) {
		const text = input.join("\n");
		return text.trim() ? [{ k: "paragraph", content: [{ k: "text", text }] }] : [];
	}
	const blocks: Block[] = [];
	const lines = input.map(expandIndent);
	for (let i = 0; i < lines.length; ) {
		const line = lines[i];
		const fence = fenceAt(line);
		if (isBlank(line)) {
			i++;
		} else if (indentOf(line) >= 4) {
			const code: string[] = [];
			for (; i < lines.length && (isBlank(lines[i]) || indentOf(lines[i]) >= 4); i++) code.push(lines[i].slice(4));
			while (!code[code.length - 1].trim()) code.pop();
			blocks.push({ k: "code", code: code.join("\n"), language: "" });
		} else if (fence) {
			const pad = indentOf(line);
			const closer = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*$`);
			const code: string[] = [];
			for (i++; i < lines.length && !closer.test(lines[i]); i++) code.push(lines[i].slice(Math.min(pad, indentOf(lines[i]))));
			i++;
			blocks.push({ k: "code", code: code.join("\n"), language: fence[2].trim().split(/\s+/)[0].replace(/[^\w+#-]/g, "").toLowerCase() });
		} else if (isHeading(line)) {
			const text = line.trim();
			const level = (/^#+/.exec(text) as RegExpExecArray)[0].length;
			blocks.push({ k: "heading", level, content: parseInline(text.slice(level).trim().replace(/(?:^|[ \t])#+$/, "").trim(), ctx, 0) });
			i++;
		} else if (RULE.test(line)) {
			blocks.push({ k: "rule" });
			i++;
		} else if (QUOTE.test(line)) {
			const inner: string[] = [];
			for (; i < lines.length; i++) {
				if (QUOTE.test(lines[i])) inner.push(lines[i].replace(QUOTE, ""));
				else if (!isBlank(lines[i]) && !startsBlock(lines[i]) && !isBlank(inner[inner.length - 1])) inner.push(lines[i]);
				else break;
			}
			blocks.push({ k: "quote", blocks: parseBlocks(inner, ctx, depth + 1) });
		} else if (isItem(line)) {
			i = parseList(lines, i, blocks, ctx, depth);
		} else if (isTableAt(lines, i)) {
			const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") ? (c.endsWith(":") ? "center" : "left") : c.endsWith(":") ? "right" : null));
			const head = splitRow(lines[i]).map((c) => parseInline(c, ctx, 0));
			const rows: Inline[][][] = [];
			for (i += 2; i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i]); i++) rows.push(splitRow(lines[i]).slice(0, head.length).map((c) => parseInline(c, ctx, 0)));
			blocks.push({ k: "table", align, head, rows });
		} else if (referenceAt(line)) {
			i++;
		} else {
			const math = line.trimStart().startsWith("$$") ? displayMath(lines, i, ctx) : null;
			if (math) blocks.push({ k: "math", tex: math.tex });
			i = math ? math.next : parseParagraph(lines, i, blocks, ctx);
		}
	}
	return blocks;
}

function parseParagraph(lines: string[], from: number, blocks: Block[], ctx: Context): number {
	const text = [lines[from].trimStart()];
	let i = from + 1;
	for (; i < lines.length; i++) {
		const line = lines[i];
		if (isBlank(line)) break;
		const setext = SETEXT.exec(line);
		if (setext) {
			blocks.push({ k: "heading", level: setext[1][0] === "=" ? 1 : 2, content: parseInline(text.join("\n").trimEnd(), ctx, 0) });
			return i + 1;
		}
		if (startsBlock(line) || isTableAt(lines, i)) break;
		text.push(line.trimStart());
	}
	blocks.push({ k: "paragraph", content: parseInline(text.join("\n").trimEnd(), ctx, 0) });
	return i;
}

function displayMath(lines: string[], from: number, ctx: Context): { tex: string; next: number } | null {
	const first = lines[from].trim().slice(2);
	if (first.endsWith("$$") && first.length > 2) return { tex: first.slice(0, -2), next: from + 1 };
	if (first.includes("$$")) return null;
	const tex = [first];
	for (let i = from + 1; i < lines.length; i++) {
		if (--ctx.budget < 0) return null;
		const line = lines[i].trim();
		if (line.endsWith("$$")) {
			tex.push(line.slice(0, -2));
			return { tex: tex.join("\n"), next: i + 1 };
		}
		tex.push(lines[i]);
	}
	return null;
}

function parseList(lines: string[], from: number, blocks: Block[], ctx: Context, depth: number): number {
	const first = ITEM.exec(lines[from]) as RegExpExecArray;
	const ordered = /\d/.test(first[2][0]);
	const kind = first[2][first[2].length - 1];
	const items: ListItem[] = [];
	let tight = true;
	let i = from;
	while (i < lines.length) {
		const m = isItem(lines[i]) ? ITEM.exec(lines[i]) : null;
		if (!m || m[2][m[2].length - 1] !== kind) break;
		const gap = m[3].length;
		const contentIndent = m[1].length + m[2].length + (gap > 4 || !m[4].trim() ? 1 : gap);
		const body = [(gap > 4 ? " ".repeat(gap - 1) : "") + m[4]];
		let blank = false;
		for (i++; i < lines.length; i++) {
			const line = lines[i];
			if (isBlank(line)) {
				body.push("");
				blank = true;
			} else if (indentOf(line) >= contentIndent) {
				body.push(line.slice(contentIndent));
				blank = false;
			} else if (!blank && !startsBlock(line) && !isItem(line)) {
				body.push(line.trimStart());
			} else break;
		}
		while (body.length > 1 && !body[body.length - 1]) body.pop();
		const next = blank && i < lines.length && isItem(lines[i]) ? ITEM.exec(lines[i]) : null;
		if (body.includes("") || next?.[2].endsWith(kind)) tight = false;
		const task = /^\[([ xX])\](?:\s|$)/.exec(body[0]);
		if (task) body[0] = body[0].slice(3).trimStart();
		items.push({ task: task ? task[1] !== " " : null, blocks: parseBlocks(body, ctx, depth + 1) });
	}
	blocks.push({ k: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, tight, items });
	return i;
}

type TextNode = Extract<Inline, { k: "text" }>;

interface Opener {
	at: number;
	node: TextNode;
}

/** Emphasis pairs up through one stack per kind, so nesting and unmatched marks cost no more than a pass. */
function parseInline(s: string, ctx: Context, linkDepth: number): Inline[] {
	const out: Inline[] = [];
	const stacks = new Map<string, Opener[]>();
	const text = (t: string) => {
		const last = out[out.length - 1];
		if (last?.k === "text" && !openerNodes.has(last)) last.text += t;
		else out.push({ k: "text", text: t });
	};
	const openerNodes = new WeakSet<TextNode>();
	const stack = (type: string) => {
		let list = stacks.get(type);
		if (!list) stacks.set(type, (list = []));
		return list;
	};
	const pushOpener = (type: string, literal: string) => {
		const node: TextNode = { k: "text", text: literal };
		openerNodes.add(node);
		stack(type).push({ at: out.length, node });
		out.push(node);
	};
	/** Wraps what follows the opener. False when there's no opener, or it would nest too deep. */
	const close = (type: string, tag: WrapTag, take: number): boolean => {
		const list = stack(type);
		const opener = list[list.length - 1];
		if (!opener) return false;
		const children = out.splice(opener.at + 1);
		let inner = 0;
		for (const c of children) if (c.k === "wrap" && c.depth > inner) inner = c.depth;
		if (inner >= MAX_WRAP_DEPTH) {
			out.push(...children);
			return false;
		}
		opener.node.text = opener.node.text.slice(take);
		if (!opener.node.text) {
			out.pop();
			list.pop();
		}
		// Openers inside what was just wrapped stay as the text they already are.
		for (const other of stacks.values()) while (other.length && other[other.length - 1].at > opener.at) other.pop();
		out.push({ k: "wrap", tag, children, depth: inner + 1 });
		return true;
	};
	for (let i = 0; i < s.length; ) {
		const c = s[i];
		if (c === "\\") {
			const next = s[i + 1] ?? "";
			if (next === "\n") out.push({ k: "break" });
			else text(PUNCTUATION.test(next) ? next : c);
			i += next === "\n" || PUNCTUATION.test(next) ? 2 : 1;
		} else if (c === "`") {
			let n = 1;
			while (s[i + n] === "`") n++;
			const end = closingTicks(s, i + n, n, ctx);
			if (end < 0) text("`".repeat(n));
			else {
				const body = s.slice(i + n, end).replace(/\n/g, " ");
				out.push({ k: "code", text: body.length > 2 && body[0] === " " && body[body.length - 1] === " " && body.trim() ? body.slice(1, -1) : body });
			}
			i = end < 0 ? i + n : end + n;
		} else if (c === "$") {
			const math = readMath(s, i, ctx);
			if (math) out.push({ k: "math", tex: math.tex, display: math.display });
			else text(c);
			i = math ? math.end : i + 1;
		} else if (c === "*" || c === "_" || (c === "~" && s[i + 1] === "~")) {
			let n = 1;
			while (s[i + n] === c) n++;
			const before = i ? ([...s.slice(Math.max(0, i - 2), i)].pop() as string) : "";
			const after = String.fromCodePoint(s.codePointAt(i + n) ?? 32);
			const left = !SPACE_OR_NOTHING.test(after) && (!PUNCT_OR_SYMBOL.test(after) || SPACE_OR_NOTHING.test(before) || PUNCT_OR_SYMBOL.test(before));
			const right = !SPACE_OR_NOTHING.test(before) && (!PUNCT_OR_SYMBOL.test(before) || SPACE_OR_NOTHING.test(after) || PUNCT_OR_SYMBOL.test(after));
			const canOpen = c === "_" ? left && (!right || PUNCT_OR_SYMBOL.test(before)) : left;
			const canClose = c === "_" ? right && (!left || PUNCT_OR_SYMBOL.test(after)) : right;
			i += n;
			if (c === "~" && n !== 2) {
				text("~".repeat(n));
				continue;
			}
			let remaining = n;
			while (canClose && remaining > 0) {
				const list = stack(c);
				const top = list[list.length - 1];
				if (!top) break;
				const take = c === "~" ? 2 : Math.min(2, remaining, top.node.text.length);
				if (!close(c, c === "~" ? "del" : take > 1 ? "strong" : "em", take)) break;
				remaining -= take;
			}
			if (remaining > 0) {
				if (canOpen) pushOpener(c, c.repeat(remaining));
				else text(c.repeat(remaining));
			}
		} else if (c === "[" || (c === "!" && s[i + 1] === "[")) {
			const link = linkDepth < MAX_LINK_DEPTH ? readLink(s, c === "!" ? i + 1 : i, ctx) : null;
			if (!link) {
				text(c);
				i++;
				continue;
			}
			i = link.end;
			const children = parseInline(link.text, ctx, linkDepth + 1);
			if (c === "!" && link.href.startsWith("attachment:")) out.push({ k: "attachment", name: link.href.slice(11), alt: link.text });
			else if (SAFE_HREF.test(link.href)) out.push({ k: "link", href: link.href, children: children.length ? children : [{ k: "text", text: link.href }] });
			else out.push(...children);
		} else if (c === "<") {
			ANGLE_LINK.lastIndex = TAG.lastIndex = i;
			const auto = ANGLE_LINK.exec(s);
			const tag = auto ? null : TAG.exec(s);
			if (auto) out.push({ k: "link", href: auto[1], children: [{ k: "text", text: auto[1] }] });
			else if (tag) {
				const name = tag[2].toLowerCase();
				if (name === "br") out.push({ k: "break" });
				else if (!tag[1]) pushOpener(`<${name}`, tag[0]);
				else if (!close(`<${name}`, name as WrapTag, Infinity)) text(tag[0]);
			} else text(c);
			i += auto ? auto[0].length : tag ? tag[0].length : 1;
		} else if (c === "&") {
			ENTITY.lastIndex = i;
			const m = ENTITY.exec(s);
			text(m ? (decodeEntity(m) ?? m[0]) : c);
			i += m ? m[0].length : 1;
		} else if (c === "\n") {
			const last = out[out.length - 1];
			if (last?.k === "text" && last.text.endsWith("  ")) {
				last.text = last.text.trimEnd();
				out.push({ k: "break" });
			} else text(" ");
			i++;
		} else if ((c === "h" || c === "H") && !WORD_CHAR.test(s[i - 1] ?? "")) {
			URL_TEXT.lastIndex = i;
			const m = URL_TEXT.exec(s);
			if (m) {
				let end = m[0].length;
				while (".,;:!?)]'\"*_~".includes(m[0][end - 1])) end--;
				const href = m[0].slice(0, end);
				out.push({ k: "link", href, children: [{ k: "text", text: href }] });
				i += end;
			} else {
				text(c);
				i++;
			}
		} else {
			text(c);
			i++;
		}
	}
	return out.filter((n) => n.k !== "text" || n.text);
}

function decodeEntity(m: RegExpExecArray): string | null {
	if (m[3]) return ENTITIES.get(m[3]) ?? null;
	const code = m[1] ? parseInt(m[1], 10) : parseInt(m[2], 16);
	if (code > 0x10ffff) return null;
	return code === 0 ? "\uFFFD" : String.fromCodePoint(code);
}

function closingTicks(s: string, from: number, n: number, ctx: Context): number {
	for (let i = from; i < s.length; i++) {
		if (--ctx.budget < 0) return -1;
		if (s[i] !== "`") continue;
		let run = 1;
		while (s[i + run] === "`") run++;
		if (run === n) return i;
		i += run - 1;
	}
	return -1;
}

function readMath(s: string, i: number, ctx: Context): { tex: string; display: boolean; end: number } | null {
	if (s[i + 1] === "$") {
		const end = s.indexOf("$$", i + 2);
		ctx.budget -= end < 0 ? s.length - i : end - i;
		if (end < 0 || ctx.budget < 0 || !s.slice(i + 2, end).trim()) return null;
		return { tex: s.slice(i + 2, end), display: true, end: end + 2 };
	}
	if (!s[i + 1] || /\s/.test(s[i + 1])) return null;
	for (let j = i + 1; j < s.length && s[j] !== "\n"; j++) {
		if (--ctx.budget < 0) return null;
		if (s[j] === "\\") j++;
		else if (s[j] === "$") {
			if (/\s/.test(s[j - 1]) || /\d/.test(s[j + 1] ?? "")) return null;
			return { tex: s.slice(i + 1, j), display: false, end: j + 1 };
		}
	}
	return null;
}

function readLink(s: string, open: number, ctx: Context): { text: string; href: string; end: number } | null {
	let nest = 0;
	let close = -1;
	const limit = Math.min(s.length, open + MAX_LINK_TEXT);
	for (let j = open + 1; j < limit; j++) {
		if (--ctx.budget < 0) return null;
		if (s[j] === "\\") j++;
		else if (s[j] === "[") nest++;
		else if (s[j] === "]" && nest-- === 0) {
			close = j;
			break;
		}
	}
	if (close < 0) return null;
	const body = s.slice(open + 1, close);
	if (s[close + 1] === "(") {
		LINK_TARGET.lastIndex = close + 1;
		const m = LINK_TARGET.exec(s);
		if (m) return { text: body, href: (m[1] ?? m[2]).replace(/\\([!-/:-@[-`{-~])/g, "$1"), end: close + 1 + m[0].length };
	}
	REFERENCE_USE.lastIndex = close + 1;
	const use = REFERENCE_USE.exec(s);
	const href = ctx.references.get((use?.[1] || body).toLowerCase());
	return href === undefined ? null : { text: body, href, end: use ? close + 1 + use[0].length : close + 1 };
}
