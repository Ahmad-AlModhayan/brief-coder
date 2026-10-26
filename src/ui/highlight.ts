/**
 * Syntax highlighting for the code file editor without shipping any grammar:
 * Obsidian already bundles CodeMirror 5 language modes (used for code blocks in notes);
 * CodeMirror 6's StreamLanguage accepts the same mode interface. Zero bundle cost, ~100 languages.
 *
 * Obsidian's StreamLanguage names syntax nodes after the CM5 token ("keyword", "string", "def"…)
 * and colours them with `cm-<token>` classes, which its theme CSS already styles. Obsidian adds
 * those classes only inside its own Markdown editor, so `tokenClasses` does the same here.
 * `themeHighlighting` covers a stock StreamLanguage (tag-based), should Obsidian ever switch.
 */
import { HighlightStyle, StreamLanguage, StreamParser, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { tags as t } from "@lezer/highlight";

interface CM5ModeInfo {
	name: string;
	mime?: string;
	mimes?: string[];
	mode: string;
	ext?: string[];
	alias?: string[];
}

interface CM5Mode {
	name?: string;
	startState?: (...a: unknown[]) => unknown;
	token: (stream: unknown, state: unknown) => string | null;
	blankLine?: (state: unknown) => void;
	indent?: (state: unknown, textAfter: string, line?: string) => unknown;
	lineComment?: string;
	blockCommentStart?: string;
	blockCommentEnd?: string;
}

interface CM5 {
	modes?: Record<string, unknown>;
	modeInfo?: CM5ModeInfo[];
	findModeByExtension?: (ext: string) => CM5ModeInfo | null;
	findModeByName?: (name: string) => CM5ModeInfo | null;
	getMode: (config: object, spec: string | object) => CM5Mode;
	startState?: (mode: CM5Mode, ...a: unknown[]) => unknown;
	copyState?: (mode: CM5Mode, state: unknown) => unknown;
	Pass?: unknown;
	requireMode?: (mode: string, cb: () => void) => void;
}

function cm5(): CM5 | null {
	const w = window as unknown as { CodeMirror?: CM5 };
	return w.CodeMirror && typeof w.CodeMirror.getMode === "function" ? w.CodeMirror : null;
}

/** A few common extensions the CM5 meta table may miss. */
const EXTRA: Record<string, string> = {
	mts: "javascript", cts: "javascript", mjs: "javascript", cjs: "javascript", jsonc: "javascript", kts: "clike", kt: "clike",
	sc: "clike", dart: "clike", zsh: "shell", fish: "shell", bat: "shell", cmd: "shell", ps1: "powershell", psm1: "powershell",
	svelte: "htmlmixed", vue: "htmlmixed", fsx: "mllike", fs: "mllike", ml: "mllike", cr: "crystal", rkt: "scheme", lisp: "commonlisp",
	ex: "elixir", exs: "elixir", nim: "nim", zig: "rust", gql: "graphql", proto: "protobuf", r: "r", jl: "julia",
};

const MIME_FOR: Record<string, string> = {
	kts: "text/x-kotlin", kt: "text/x-kotlin", sc: "text/x-scala", dart: "application/dart", jsonc: "application/json",
};

function modeInfoFor(c: CM5, ext: string): { spec: string; mode: string; name: string } | null {
	const e = ext.toLowerCase();
	const info = c.findModeByExtension?.(e) ?? null;
	if (info && info.mode && info.mode !== "null") return { spec: MIME_FOR[e] ?? info.mime ?? info.mimes?.[0] ?? info.mode, mode: info.mode, name: info.name };
	const mode = EXTRA[e];
	if (mode) return { spec: MIME_FOR[e] ?? mode, mode, name: mode };
	return null;
}

/** More than this many registered modes means Obsidian's full mode bundle has been loaded. */
const BUNDLE_LOADED = 30;

function ensureLoaded(c: CM5, mode: string): Promise<boolean> {
	const has = () => !!c.modes?.[mode];
	if (has()) return Promise.resolve(true);
	if (c.requireMode) {
		return new Promise((resolve) => {
			const timer = setTimeout(() => resolve(has()), 1500);
			try {
				c.requireMode?.(mode, () => {
					clearTimeout(timer);
					resolve(has());
				});
			} catch {
				clearTimeout(timer);
				resolve(false);
			}
		});
	}
	// Obsidian loads its bundle of ~100 modes on demand: the first request for a mode that isn't
	// registered yet starts the (one-time, local) download. Ask once, then wait briefly for it.
	try {
		c.getMode({}, mode);
	} catch {
		/* ignore */
	}
	return new Promise((resolve) => {
		const started = Date.now();
		const tick = () => {
			const loaded = Object.keys(c.modes ?? {}).length > BUNDLE_LOADED;
			if (has() || loaded || Date.now() - started > 4000) resolve(has());
			else setTimeout(tick, 50);
		};
		tick();
	});
}

/**
 * One language per mode and tab size, made once: CodeMirror keeps every StreamLanguage ever
 * defined in a global table, so making one per opened file would grow memory with each file.
 */
const languages = new Map<string, Extension>();

/** Returns a CodeMirror 6 language extension for a file extension, or [] if unknown. */
export async function languageFor(ext: string, tabSize: number): Promise<Extension> {
	const c = cm5();
	if (!c) return [];
	const info = modeInfoFor(c, ext);
	if (!info) return [];
	const cacheKey = `${info.spec}|${tabSize}`;
	const known = languages.get(cacheKey);
	if (known) return known;
	if (!(await ensureLoaded(c, info.mode))) return [];
	const loaded = languages.get(cacheKey); // another editor may have made it meanwhile
	if (loaded) return loaded;
	let mode: CM5Mode;
	try {
		mode = c.getMode({ indentUnit: tabSize, tabSize }, info.spec);
	} catch {
		return [];
	}
	if (!mode || mode.name === "null" || typeof mode.token !== "function") return [];
	const parser: StreamParser<unknown> = {
		name: info.name,
		startState: () => (c.startState ? c.startState(mode) : mode.startState ? mode.startState() : true),
		token: (stream, state) => mode.token(stream, state),
		blankLine: mode.blankLine ? (state) => mode.blankLine?.(state) : undefined,
		copyState: (state) => (c.copyState ? c.copyState(mode, state) : state),
		indent: mode.indent
			? (state, textAfter) => {
					const r = mode.indent?.(state, textAfter, "");
					return typeof r === "number" ? r : null;
				}
			: undefined,
		languageData: {
			commentTokens: {
				line: mode.lineComment,
				block: mode.blockCommentStart ? { open: mode.blockCommentStart, close: mode.blockCommentEnd ?? "" } : undefined,
			},
		},
	};
	const language = [StreamLanguage.define(parser), tokenClasses];
	languages.set(cacheKey, language);
	return language;
}

// ---------- token classes (cm-keyword, cm-string, …) ----------

const markCache = new Map<string, Decoration | null>();

/** `string_url` → mark with class "cm-string cm-url". Tag-style names ("variableName.definition") get none. */
function markFor(name: string): Decoration | null {
	let mark = markCache.get(name);
	if (mark === undefined) {
		const parts = name.split("_").filter((p) => /^[a-z][a-z0-9-]*$/i.test(p) && !p.startsWith("line-"));
		mark = parts.length ? Decoration.mark({ class: parts.map((p) => `cm-${p}`).join(" ") }) : null;
		markCache.set(name, mark);
	}
	return mark;
}

class TokenClassPlugin {
	decorations: DecorationSet;
	private tree: Tree;

	constructor(view: EditorView) {
		this.tree = syntaxTree(view.state);
		this.decorations = this.build(view);
	}

	update(u: ViewUpdate): void {
		const tree = syntaxTree(u.state);
		// While the parser is still catching up, shift the old colours instead of flashing plain text.
		if (tree.length < u.view.viewport.to || u.view.compositionStarted) {
			this.decorations = this.decorations.map(u.changes);
			return;
		}
		if (tree !== this.tree || u.viewportChanged) {
			this.tree = tree;
			this.decorations = this.build(u.view);
		}
	}

	/** Only the visible part of the file is decorated, so big files stay fast. */
	private build(view: EditorView): DecorationSet {
		const builder = new RangeSetBuilder<Decoration>();
		let end = 0;
		for (const { from, to } of view.visibleRanges) {
			this.tree.iterate({
				from,
				to,
				enter: (node) => {
					if (node.type.isTop || node.from < end || node.from === node.to) return;
					const mark = markFor(node.type.name);
					if (!mark) return;
					builder.add(node.from, node.to, mark);
					end = node.to;
				},
			});
		}
		return builder.finish();
	}
}

const tokenClasses = ViewPlugin.fromClass(TokenClassPlugin, { decorations: (p) => p.decorations });

/** Highlight colours come from the active theme's code variables, so files match code blocks. */
export const themeHighlighting: Extension = syntaxHighlighting(
	HighlightStyle.define([
		{ tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier, t.definitionKeyword, t.moduleKeyword], color: "var(--code-keyword)" },
		{ tag: [t.string, t.special(t.string), t.regexp, t.character, t.escape], color: "var(--code-string)" },
		{ tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--code-comment)", fontStyle: "italic" },
		{ tag: [t.number, t.bool, t.atom, t.null, t.unit, t.literal], color: "var(--code-value)" },
		{ tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName), t.definition(t.function(t.variableName))], color: "var(--code-function)" },
		{ tag: [t.propertyName, t.attributeName], color: "var(--code-property)" },
		{ tag: [t.tagName, t.typeName, t.className, t.namespace, t.standard(t.variableName), t.special(t.variableName)], color: "var(--code-tag)" },
		{ tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.compareOperator], color: "var(--code-operator)" },
		{ tag: [t.punctuation, t.bracket, t.separator, t.brace, t.paren, t.squareBracket], color: "var(--code-punctuation)" },
		{ tag: [t.meta, t.processingInstruction, t.annotation], color: "var(--code-important)" },
		{ tag: t.heading, fontWeight: "bold", color: "var(--code-function)" },
		{ tag: t.strong, fontWeight: "bold" },
		{ tag: t.emphasis, fontStyle: "italic" },
		{ tag: t.link, textDecoration: "underline" },
		{ tag: t.invalid, color: "var(--text-error)" },
	]),
);
