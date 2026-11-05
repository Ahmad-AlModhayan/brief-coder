/**
 * Prepares a notebook's markdown for Obsidian's renderer. That renderer runs every plugin's processors:
 * a fence named `dataviewjs`, or inline code starting `$=`, would run as code just because the notebook
 * was opened, `![[note]]` would pull a vault note into the page, and a remote image would call out.
 *
 * So nothing active reaches it. Code is lifted out and replaced by tokens the view fills in afterwards,
 * and raw HTML, images and embeds become plain text or links. The scan doesn't need to agree with the
 * markdown parser line for line: each rewrite is harmless when it guesses wrong, and at worst text looks
 * slightly different. What goes through has no unescaped backtick, no run of three tildes, and no `<` that
 * could open a tag apart from a few harmless ones, by construction. Text in an HTML block isn't unescaped by
 * the parser, so even those tags can't bring anything live with them.
 */
export type MarkdownSlot =
	| { kind: "fence"; token: string; code: string; language: string }
	| { kind: "inline"; token: string; code: string }
	| { kind: "attachment"; token: string; name: string; alt: string };

/** Every way a markdown parser might end a line, so the scan never sees fewer lines than it does. */
const LINE_END = /\r\n?|[\n\f\v\u0085\u2028\u2029]/g;
const OPENER = /^([ \t]*(?:>[ \t]*|[*+-][ \t]+|\d{1,9}[.)][ \t]+)*)(`{3,}|~{3,})(.*)$/;
const CLOSER = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/;
const SAFE_TAG = /^<\/?(?:b|i|u|em|strong|sub|sup|kbd|br|hr)\s*\/?>/i;
const ATTACHMENT = /^!\[([^\]\n]{0,500})\]\(attachment:([^)\s]{1,500})\)/;
/** MathJax commands that load something, link somewhere or add markup. */
const ACTIVE_COMMAND = /^\\(?:href|require|unicode|style|class|cssId|mmlToken|data|html)(?![a-zA-Z])/;
/**
 * Indented code reaches inline query processors too; these are the prefixes they look for. In a paragraph
 * the backslash doesn't show, so this applies to every line, after any container, not just indented ones.
 * A line of only "=" is a heading underline.
 */
const LINE_QUERY = /^((?:[ \t>]|[*+-][ \t]|\d{1,9}[.)][ \t]|\[\^[^\]\n]{0,100}\]:)*)(?=\$?=)(?!=+[ \t]*$)/;
const MAX_LINE = 100_000;
const MAX_CELL = 1_000_000;

/** Beyond these sizes a cell is shown as plain text: scanning and rendering it could freeze the app. */
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

export function neutraliseMarkdown(source: string, nonce: string): { text: string; slots: MarkdownSlot[] } {
	const slots: MarkdownSlot[] = [];
	const token = () => `BCNB${nonce}X${slots.length}Z`;
	const out: string[] = [];
	const lines = source.replace(LINE_END, "\n").split("\n");
	let displayMath = false;
	for (let i = 0; i < lines.length; i++) {
		const opener = OPENER.exec(lines[i]);
		if (opener && !(opener[2][0] === "`" && opener[3].includes("`"))) {
			const code: string[] = [];
			const mark = opener[2];
			for (i++; i < lines.length; i++) {
				const closer = CLOSER.exec(lines[i]);
				if (closer && closer[1][0] === mark[0] && closer[1].length >= mark.length) break;
				code.push(lines[i]);
			}
			const t = token();
			slots.push({ kind: "fence", token: t, code: code.join("\n"), language: opener[3].trim().split(/\s+/)[0].replace(/[^\w+#-]/g, "").toLowerCase() });
			out.push(opener[1] + t);
			continue;
		}
		const scanned = scanLine(lines[i].replace(LINE_QUERY, "$1\\"), displayMath, slots, token);
		displayMath = scanned.displayMath;
		out.push(scanned.text);
	}
	return { text: out.join("\n"), slots };
}

function scanLine(line: string, startInMath: boolean, slots: MarkdownSlot[], token: () => string): { text: string; displayMath: boolean } {
	let out = "";
	let displayMath = startInMath;
	let inlineMathEnd = -1;
	for (let i = 0; i < line.length; ) {
		const c = line[i];
		const inMath = displayMath || i < inlineMathEnd;
		if (c === "\\") {
			const rest = line.slice(i);
			const active = ACTIVE_COMMAND.exec(rest);
			if (active) {
				out += `\\backslash{}${active[0].slice(1)}`;
				i += active[0].length;
			} else if (line[i + 1] === "<") {
				// Inside an HTML block the parser leaves a backslash alone, and "<" would be live.
				out += "&lt;";
				i += 2;
			} else {
				out += line.slice(i, i + 2);
				i += 2;
			}
		} else if (c === "`") {
			let n = 1;
			while (line[i + n] === "`") n++;
			const end = inMath ? -1 : closingRun(line, i + n, n);
			if (end >= 0) {
				const t = token();
				const body = line.slice(i + n, end);
				// The format strips one space each side when both are there and the text isn't all spaces.
				const code = body.length > 2 && body[0] === " " && body[body.length - 1] === " " && body.trim() ? body.slice(1, -1) : body;
				slots.push({ kind: "inline", token: t, code });
				out += t;
				i = end + n;
			} else {
				out += "\\`".repeat(n);
				i += n;
			}
		} else if (c === "$") {
			if (line[i + 1] === "$") {
				displayMath = !displayMath;
				out += "$$";
				i += 2;
			} else {
				if (!inMath) {
					const close = closingDollar(line, i + 1);
					if (close > 0) inlineMathEnd = close;
				} else {
					inlineMathEnd = -1;
				}
				out += c;
				i++;
			}
		} else if (c === "<") {
			const next = line[i + 1] ?? "";
			const safe = inMath ? null : SAFE_TAG.exec(line.slice(i));
			if (safe) {
				out += safe[0];
				i += safe[0].length;
			} else if (next && !/\s/.test(next)) {
				// Anything else after "<" could become a tag, a token included. In math it only needs a space.
				out += inMath ? "< " : "&lt;";
				i++;
			} else {
				out += c;
				i++;
			}
		} else if (c === "!" && line[i + 1] === "[") {
			const attachment = inMath ? null : ATTACHMENT.exec(line.slice(i));
			if (attachment) {
				const t = token();
				slots.push({ kind: "attachment", token: t, name: attachment[2], alt: attachment[1] });
				out += t;
				i += attachment[0].length;
			} else {
				out += "\\!";
				i++;
			}
		} else if (c === "[" && line[i + 1] === "[") {
			out += "\\[\\[";
			i += 2;
		} else if (c === "~" && line[i + 1] === "~" && line[i + 2] === "~") {
			// A fence in a container the scan doesn't know, such as a footnote.
			let n = 3;
			while (line[i + n] === "~") n++;
			out += "\\~".repeat(n);
			i += n;
		} else {
			out += c;
			i++;
		}
	}
	return { text: out, displayMath };
}

function closingRun(line: string, from: number, n: number): number {
	for (let i = from; i < line.length; i++) {
		if (line[i] !== "`") continue;
		let run = 1;
		while (line[i + run] === "`") run++;
		if (run === n) return i;
		i += run - 1;
	}
	return -1;
}

function closingDollar(line: string, from: number): number {
	for (let i = from; i < line.length; i++) {
		if (line[i] === "\\") i++;
		else if (line[i] === "$") return i;
	}
	return -1;
}
