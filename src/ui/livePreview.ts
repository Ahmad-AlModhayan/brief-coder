import { EditorState, Extension, RangeSetBuilder, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type CoderPlugin from "../main";
import { isDecoratedFence } from "../languages";
import { blockKeys, findFencedBlocks } from "../util/fence";

/** Dispatched when settings change so editors rebuild their decorations. */
export const refreshEffect = StateEffect.define<null>();

const cleanups = new WeakMap<HTMLElement, () => void>();

class RunBarWidget extends WidgetType {
	constructor(
		private plugin: CoderPlugin,
		readonly key: string,
		readonly path: string,
		readonly fence: string,
		readonly info: string,
		readonly code: string,
	) {
		super();
	}

	eq(other: RunBarWidget): boolean {
		return other.key === this.key && other.info === this.info;
	}

	toDOM(): HTMLElement {
		const el = createDiv({ cls: "coder-lp" });
		const unmount = this.plugin.mountBlock(el, { key: this.key, path: this.path, fence: this.fence, info: this.info, code: this.code });
		cleanups.set(el, unmount);
		return el;
	}

	destroy(dom: HTMLElement): void {
		cleanups.get(dom)?.();
		cleanups.delete(dom);
	}

	ignoreEvent(): boolean {
		return true; // clicks/typing inside the bar never move the editor cursor
	}

	get estimatedHeight(): number {
		return 34;
	}
}

interface Range {
	from: number;
	to: number;
}

interface FieldValue {
	deco: DecorationSet;
	/** Document ranges of the code blocks (opening fence to closing fence). */
	ranges: Range[];
}

const EMPTY: FieldValue = { deco: Decoration.none, ranges: [] };
const FENCE_START = Decoration.line({ class: "coder-hide-copy" });

function build(plugin: CoderPlugin, state: EditorState): FieldValue {
	if (!plugin.settings.showRunBar) return EMPTY;
	const doc = state.doc;
	const text = doc.toString();
	if (!text.includes("```") && !text.includes("~~~")) return EMPTY;
	const path = state.field(editorInfoField, false)?.file?.path ?? "";
	const blocks = findFencedBlocks(text.split("\n"));
	const keys = blockKeys(path, blocks);
	const builder = new RangeSetBuilder<Decoration>();
	const ranges: Range[] = [];
	blocks.forEach((b, i) => {
		const start = doc.line(b.startLine + 1);
		ranges.push({ from: start.from, to: doc.line(b.endLine + 1).to });
		if (!b.closed || !isDecoratedFence(b.lang)) return;
		// Marks the opening line so CSS can hide Obsidian's own copy flair on blocks that have the bar.
		if (plugin.settings.hideNativeCopy) builder.add(start.from, start.from, FENCE_START);
		const pos = doc.line(b.endLine + 1).to;
		builder.add(
			pos,
			pos,
			Decoration.widget({ widget: new RunBarWidget(plugin, keys[i], path, b.lang, b.info, b.code), block: true, side: 1 }),
		);
	});
	return { deco: builder.finish(), ranges };
}

/**
 * Typing in ordinary text (the common case) only shifts the bars; the note is re-scanned when an
 * edit touches a code block or adds/removes fence characters.
 */
function needsRebuild(value: FieldValue, tr: Transaction): boolean {
	let rebuild = false;
	tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		if (rebuild) return;
		for (const r of value.ranges) {
			if (fromA <= r.to && toA >= r.from) {
				rebuild = true;
				return;
			}
		}
		if (/[`~]/.test(inserted.toString()) || /[`~]/.test(tr.startState.doc.sliceString(fromA, toA))) rebuild = true;
	});
	return rebuild;
}

/** Live Preview / source mode: a block widget with the Coder bar after each code block. */
export function livePreviewExtension(plugin: CoderPlugin): Extension {
	const field = StateField.define<FieldValue>({
		create: (state) => build(plugin, state),
		update(value, tr) {
			if (tr.effects.some((e) => e.is(refreshEffect))) return build(plugin, tr.state);
			if (!tr.docChanged) return value;
			if (needsRebuild(value, tr)) return build(plugin, tr.state);
			return {
				deco: value.deco.map(tr.changes),
				ranges: value.ranges.map((r) => ({ from: tr.changes.mapPos(r.from), to: tr.changes.mapPos(r.to, 1) })),
			};
		},
		provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
	});
	return field;
}
