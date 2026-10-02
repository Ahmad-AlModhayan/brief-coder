/**
 * Pure helpers for finding fenced code blocks in Markdown text.
 * Shared by reading view, Live Preview and commands so every surface agrees on block identity.
 */

export interface FencedBlock {
	/** 0-based line of the opening fence. */
	startLine: number;
	/** 0-based line of the closing fence (last line of the document when unclosed). */
	endLine: number;
	closed: boolean;
	/** Language token as written (may be empty). */
	lang: string;
	/** Full info string after the fence characters. */
	info: string;
	/** Code between the fences, with the fence's indentation removed. */
	code: string;
}

export interface FenceInfo {
	lang: string;
	title?: string;
	noRun: boolean;
}

const OPEN_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

/** Finds top-level (or list-nested) fenced code blocks. Blocks inside blockquotes/callouts are skipped. */
export function findFencedBlocks(lines: readonly string[]): FencedBlock[] {
	const blocks: FencedBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		const m = OPEN_RE.exec(lines[i]);
		if (!m) {
			i++;
			continue;
		}
		const [, indent, fence, rest] = m;
		const fenceChar = fence[0];
		if (fenceChar === "`" && rest.includes("`")) {
			// Not a valid backtick fence (inline code like ```foo```).
			i++;
			continue;
		}
		const info = rest.trim();
		const lang = info.split(/\s+/)[0] ?? "";
		const closeRe = new RegExp(`^[ \\t]*${fenceChar === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
		let j = i + 1;
		while (j < lines.length && !closeRe.test(lines[j])) j++;
		const closed = j < lines.length;
		const body = lines.slice(i + 1, closed ? j : lines.length);
		const code = body.map((l) => stripIndent(l, indent)).join("\n");
		blocks.push({ startLine: i, endLine: closed ? j : lines.length - 1, closed, lang, info, code });
		i = closed ? j + 1 : lines.length;
	}
	return blocks;
}

function stripIndent(line: string, indent: string): string {
	if (!indent) return line;
	if (line.startsWith(indent)) return line.slice(indent.length);
	// Fall back to removing as much leading whitespace as the fence had.
	let k = 0;
	while (k < indent.length && k < line.length && (line[k] === " " || line[k] === "\t")) k++;
	return line.slice(k);
}

/** Parses `python title="Demo" norun` / `{python norun}` style info strings. */
export function parseFenceInfo(info: string): FenceInfo {
	const cleaned = info.trim().replace(/^\{/, "").replace(/\}$/, "");
	const lang = (cleaned.split(/\s+/)[0] ?? "").replace(/^\./, "");
	const titleMatch = /\btitle\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i.exec(cleaned);
	const noRun = /(^|\s)(no-?run|norun=true)(\s|$)/i.test(cleaned);
	return {
		lang,
		title: titleMatch ? titleMatch[1] ?? titleMatch[2] ?? titleMatch[3] : undefined,
		noRun,
	};
}

/** 32-bit FNV-1a hash as hex; fast and stable for block identity. */
export function hashString(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Stable identity for a block inside a note: survives edits elsewhere in the note,
 * and distinguishes identical blocks by their order.
 */
export function blockKeys(path: string, blocks: readonly FencedBlock[]): string[] {
	const seen = new Map<string, number>();
	return blocks.map((b) => {
		const base = `${path}|${b.lang.toLowerCase()}|${hashString(b.code)}`;
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		return `${base}|${n}`;
	});
}

/** Returns the block containing the given 0-based line, if any. */
export function blockAtLine(blocks: readonly FencedBlock[], line: number): FencedBlock | undefined {
	return blocks.find((b) => line >= b.startLine && line <= b.endLine);
}
