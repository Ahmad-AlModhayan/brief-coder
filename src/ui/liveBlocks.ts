/**
 * Where the fenced blocks of an editor's note are, kept up to date while typing without
 * re-reading the whole note on every keystroke (pure: no DOM, no Obsidian; unit-tested).
 */
import type { ChangeSet, Text } from "@codemirror/state";
import { FencedBlock, blockKeys, findFencedBlocks, keyBase } from "../util/fence";

/** What a block is. Tracked edits never change its fence lines, so this only changes with the code. */
export interface BlockMeta {
	lang: string;
	info: string;
	/** The block's key without its order number (see keyBase). */
	base: string;
	/** Length of the opening fence line. */
	openLen: number;
	/** Length of the closing fence line, or -1 when the block isn't closed. */
	closeLen: number;
}

export interface BlockSpan {
	/** Start of the opening fence line. */
	from: number;
	/** End of the closing fence line (end of the note when the block isn't closed). */
	to: number;
	meta: BlockMeta;
}

export interface Scan {
	spans: BlockSpan[];
	blocks: FencedBlock[];
	keys: string[];
}

/** Reads every fenced block of the note. */
export function scanBlocks(doc: Text, path: string): Scan {
	const text = doc.toString();
	if (!text.includes("```") && !text.includes("~~~")) return { spans: [], blocks: [], keys: [] };
	const blocks = findFencedBlocks(text.split("\n"));
	const keys = blockKeys(path, blocks);
	const spans = blocks.map((b, i) => {
		const open = doc.line(b.startLine + 1);
		const close = doc.line(b.endLine + 1);
		const base = keys[i].slice(0, keys[i].lastIndexOf("|"));
		return { from: open.from, to: close.to, meta: { lang: b.lang, info: b.info, base, openLen: open.length, closeLen: b.closed ? close.length : -1 } };
	});
	return { spans, blocks, keys };
}

/** A line that starts like a code fence. */
const FENCE_LINE = /^[ \t]*(?:```|~~~)/;

export interface Tracked {
	spans: BlockSpan[];
	/** Set when the edit changed the code of one block (its key is then `${base}|0`). */
	edited?: { index: number; code: string };
}

/** Index of the first block that ends at or after `pos` (blocks are sorted and don't overlap). */
function blockAt(spans: readonly BlockSpan[], pos: number): number {
	let lo = 0;
	let hi = spans.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (spans[mid].to < pos) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * Moves the blocks through an edit. Typing in ordinary text only shifts the blocks after it, and
 * typing inside a code block re-reads just that block. Returns null when the note must be scanned
 * again: an edit on a fence line, a line that now looks like a fence, or a block identical to another.
 */
export function trackEdit(spans: readonly BlockSpan[], doc: Text, changes: ChangeSet, path: string): Tracked | null {
	let target = -1;
	let rescan = false;
	let first = -1;
	changes.iterChanges((fromA, toA, fromB, toB) => {
		if (rescan) return;
		if (first < 0) first = fromA;
		const i = blockAt(spans, fromA);
		const s = spans[i];
		if (!s || toA < s.from) {
			// Outside every block, only a line that now starts like a fence can move blocks around.
			for (let n = doc.lineAt(fromB).number, last = doc.lineAt(toB).number; n <= last && !rescan; n++) rescan = FENCE_LINE.test(doc.line(n).text);
			return;
		}
		// Inside a block, only edits between its fence lines are tracked.
		const { openLen, closeLen } = s.meta;
		if (closeLen < 0 || fromA <= s.from + openLen || toA >= s.to - closeLen || (target >= 0 && target !== i)) rescan = true;
		else target = i;
	});
	if (rescan) return null;
	// Blocks that end before the edit stay as they are.
	const moved = spans.map((s) => (s.to < first ? s : { from: changes.mapPos(s.from), to: changes.mapPos(s.to, 1), meta: s.meta }));
	if (target < 0) return { spans: moved };
	const s = moved[target];
	const lines = doc.sliceString(s.from, s.to).split("\n");
	const [block] = findFencedBlocks(lines);
	// The block must still end at its closing fence (a code line can become a fence by deleting text before it).
	if (!block || !block.closed || block.endLine !== lines.length - 1) return null;
	const base = keyBase(path, s.meta.lang, block.code);
	const before = s.meta.base;
	// Identical blocks are numbered in order, so a block that matches another one needs a full scan.
	if (moved.some((o, k) => k !== target && (o.meta.base === base || o.meta.base === before))) return null;
	moved[target] = { from: s.from, to: s.to, meta: { ...s.meta, base } };
	return { spans: moved, edited: { index: target, code: block.code } };
}
