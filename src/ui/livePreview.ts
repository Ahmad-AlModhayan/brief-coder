import { ChangeSet, EditorState, Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type CoderPlugin from "../main";
import { isDecoratedFence } from "../languages";
import { BlockSpan, scanBlocks, trackEdit } from "./liveBlocks";

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

interface FieldValue {
	deco: DecorationSet;
	/** Where every fenced block is (opening fence to closing fence). */
	spans: BlockSpan[];
	path: string;
}

const FENCE_START = Decoration.line({ class: "coder-hide-copy" });

function barWidget(plugin: CoderPlugin, key: string, path: string, s: BlockSpan, code: string): Decoration {
	return Decoration.widget({ widget: new RunBarWidget(plugin, key, path, s.meta.lang, s.meta.info, code), block: true, side: 1 });
}

function notePath(state: EditorState): string {
	return state.field(editorInfoField, false)?.file?.path ?? "";
}

function build(plugin: CoderPlugin, state: EditorState): FieldValue {
	const path = notePath(state);
	if (!plugin.settings.showRunBar) return { deco: Decoration.none, spans: [], path };
	const { spans, blocks, keys } = scanBlocks(state.doc, path);
	const builder = new RangeSetBuilder<Decoration>();
	blocks.forEach((b, i) => {
		if (!b.closed || !isDecoratedFence(b.lang)) return;
		// Marks the opening line so CSS can hide Obsidian's own copy flair on blocks that have the bar.
		if (plugin.settings.hideNativeCopy) builder.add(spans[i].from, spans[i].from, FENCE_START);
		builder.add(spans[i].to, spans[i].to, barWidget(plugin, keys[i], path, spans[i], b.code));
	});
	return { deco: builder.finish(), spans, path };
}

/**
 * Typing in ordinary text (the common case) only shifts the bars, and typing inside a code block
 * re-reads just that block. The whole note is scanned again only when fences change.
 */
function update(plugin: CoderPlugin, value: FieldValue, state: EditorState, changes: ChangeSet): FieldValue {
	const path = notePath(state);
	const next = path === value.path ? trackEdit(value.spans, state.doc, changes, path) : null;
	if (!next) return build(plugin, state);
	let deco = value.deco.map(changes);
	const edited = next.edited;
	if (edited && isDecoratedFence(next.spans[edited.index].meta.lang)) {
		// The edited block's bar gets the new code, and with it the block's new key.
		const s = next.spans[edited.index];
		deco = deco.update({
			filter: (_from, _to, d) => !((d.spec as { widget?: unknown }).widget instanceof RunBarWidget),
			filterFrom: s.to,
			filterTo: s.to,
			add: [barWidget(plugin, `${s.meta.base}|0`, path, s, edited.code).range(s.to)],
		});
	}
	return { deco, spans: next.spans, path };
}

/** Live Preview / source mode: a block widget with the Coder bar after each code block. */
export function livePreviewExtension(plugin: CoderPlugin): Extension {
	const field = StateField.define<FieldValue>({
		create: (state) => build(plugin, state),
		update(value, tr) {
			if (tr.effects.some((e) => e.is(refreshEffect))) return build(plugin, tr.state);
			if (!tr.docChanged) return value;
			return update(plugin, value, tr.state, tr.changes);
		},
		provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
	});
	return field;
}
