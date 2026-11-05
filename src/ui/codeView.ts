import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { t } from "../i18n";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Extension, Transaction } from "@codemirror/state";
import {
	EditorView,
	drawSelection,
	dropCursor,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
	rectangularSelection,
} from "@codemirror/view";
import { FileSystemAdapter, Notice, Scope, TextFileView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type CoderPlugin from "../main";
import { LanguageDef, languageForExtension } from "../languages";
import { canRun } from "../run/runner";
import { isLargeFile, wrapsLines } from "../settings";
import { RunSession } from "../run/session";
import { editorTheme, languageFor, themeHighlighting } from "./highlight";
import { OutputView } from "./outputView";

export const VIEW_TYPE_CODE = "coder-code-view";

/** Opens code files (.py, .js, .go, …) inside Obsidian with an editor, Run and an output panel. */
export class CodeView extends TextFileView {
	private editor: EditorView | null = null;
	private languageConf = new Compartment();
	private optionsConf = new Compartment();
	private lang: LanguageDef | undefined;
	private session: RunSession | null = null;
	private output: OutputView | null = null;
	private editorHost!: HTMLElement;
	private outputHost!: HTMLElement;
	private runAction: HTMLElement | null = null;
	private unsubscribe: (() => void) | null = null;
	private settingData = false;
	private langLoadId = 0;
	/** Run was pressed and is waiting for confirmation or the save. */
	private starting = false;
	/** The open file is too large to edit smoothly: no typing, and nothing is ever written back. */
	readOnly = false;

	constructor(leaf: WorkspaceLeaf, private plugin: CoderPlugin) {
		super(leaf);
		this.allowNoFile = false;
		// Obsidian's global hotkeys claim Ctrl/Cmd+Enter before the editor sees it, so bind it on the view.
		this.scope = new Scope(this.app.scope);
		this.scope.register(["Mod"], "Enter", () => {
			void this.toggleRun();
			return false;
		});
	}

	getViewType(): string {
		return VIEW_TYPE_CODE;
	}

	getDisplayText(): string {
		return this.file?.name ?? "Code";
	}

	getIcon(): string {
		return "file-code";
	}

	canAcceptExtension(extension: string): boolean {
		return this.plugin.codeExtensions.has(extension.toLowerCase());
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("coder-view");
		this.editorHost = this.contentEl.createDiv({ cls: "coder-view-editor" });
		this.outputHost = this.contentEl.createDiv({ cls: "coder-view-output" });
		this.runAction = this.addAction("play", t("Run file (Ctrl/Cmd + Enter)"), () => void this.toggleRun());
		this.addAction("copy", t("Copy file contents"), () => void navigator.clipboard.writeText(this.getViewData()));
	}

	async onClose(): Promise<void> {
		this.detachSession();
		this.editor?.destroy();
		this.editor = null;
	}

	async onLoadFile(file: TFile): Promise<void> {
		this.lang = languageForExtension(file.extension);
		this.readOnly = isLargeFile(file.stat.size);
		if (this.readOnly) new Notice(t("{file} is over 5 MB: read-only.", { file: file.name }));
		this.attachSession(file);
		this.updateRunAction();
		if (this.lang?.process) this.plugin.warmUp();
		await super.onLoadFile(file);
	}

	async onUnloadFile(file: TFile): Promise<void> {
		await super.onUnloadFile(file);
		this.detachSession();
	}

	/**
	 * Everything that writes the file comes through here, Run and Obsidian's own saves included,
	 * and the editor's text can differ from the file without an edit (it turns CRLF into LF).
	 */
	async save(clear?: boolean): Promise<void> {
		if (!this.readOnly) return super.save(clear);
		if (clear) this.clear();
	}

	getViewData(): string {
		return this.editor ? this.editor.state.doc.toString() : this.data;
	}

	setViewData(data: string, clear: boolean): void {
		if (!this.editor || clear) {
			this.createEditor(data);
			return;
		}
		const current = this.editor.state.doc.toString();
		if (current === data) return;
		// The file changed outside this editor (sync, another app): replace only the part that
		// differs, so the cursor and scroll position stay where they were.
		let start = 0;
		const min = Math.min(current.length, data.length);
		while (start < min && current.charCodeAt(start) === data.charCodeAt(start)) start++;
		let endCur = current.length;
		let endNew = data.length;
		while (endCur > start && endNew > start && current.charCodeAt(endCur - 1) === data.charCodeAt(endNew - 1)) {
			endCur--;
			endNew--;
		}
		this.settingData = true;
		this.editor.dispatch({
			changes: { from: start, to: endCur, insert: data.slice(start, endNew) },
			annotations: Transaction.addToHistory.of(false),
		});
		this.settingData = false;
	}

	clear(): void {
		this.editor?.destroy();
		this.editor = null;
		this.editorHost?.empty();
	}

	/** Re-applies settings (line numbers, wrap, tab size) to an open editor. */
	refreshOptions(): void {
		this.editor?.dispatch({ effects: this.optionsConf.reconfigure(this.optionsExtension()) });
	}

	private optionsExtension(): Extension {
		const s = this.plugin.settings;
		const ext: Extension[] = [
			EditorState.tabSize.of(s.editorTabSize),
			indentUnit.of(" ".repeat(Math.max(1, s.editorTabSize))),
		];
		if (s.editorLineNumbers) ext.push(lineNumbers(), foldGutter(), highlightActiveLineGutter());
		if (wrapsLines(this.file?.extension ?? "", s)) ext.push(EditorView.lineWrapping);
		if (this.readOnly) ext.push(EditorState.readOnly.of(true));
		return ext;
	}

	private createEditor(doc: string): void {
		this.editor?.destroy();
		this.editorHost.empty();
		const state = EditorState.create({
			doc,
			extensions: [
				this.optionsConf.of(this.optionsExtension()),
				this.languageConf.of([]),
				highlightSpecialChars(),
				history(),
				drawSelection(),
				dropCursor(),
				EditorState.allowMultipleSelections.of(true),
				indentOnInput(),
				bracketMatching(),
				closeBrackets(),
				rectangularSelection(),
				highlightActiveLine(),
				highlightSelectionMatches(),
				themeHighlighting,
				editorTheme,
				keymap.of([
					{ key: "Mod-Enter", run: () => (void this.toggleRun(), true) },
					...closeBracketsKeymap,
					...defaultKeymap,
					...searchKeymap,
					...historyKeymap,
					...foldKeymap,
					indentWithTab,
				]),
				EditorView.updateListener.of((u) => {
					if (u.docChanged && !this.settingData) this.requestSave();
				}),
			],
		});
		this.editor = new EditorView({ state, parent: this.editorHost });
		void this.loadLanguage();
	}

	private async loadLanguage(): Promise<void> {
		const file = this.file;
		if (!file || !this.editor) return;
		const id = ++this.langLoadId;
		const ext = await languageFor(file.extension, this.plugin.settings.editorTabSize);
		if (id !== this.langLoadId || !this.editor) return; // a newer file was opened meanwhile
		this.editor.dispatch({ effects: this.languageConf.reconfigure(ext) });
	}

	private attachSession(file: TFile): void {
		this.detachSession();
		const session = this.plugin.store.get(`${file.path}|file`);
		this.session = session;
		this.output = new OutputView(this.outputHost, session, { onClear: () => session.clear() });
		this.unsubscribe = session.subscribe(() => this.updateRunAction());
	}

	private detachSession(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.output?.destroy();
		this.output = null;
		this.session = null;
	}

	private updateRunAction(): void {
		if (!this.runAction) return;
		const runnable = canRun(this.lang, this.plugin.desktop);
		this.runAction.toggleClass("is-hidden", !runnable);
		const running = !!this.session?.running;
		setIcon(this.runAction, running ? "square" : "play");
		this.runAction.setAttr("aria-label", running ? t("Stop") : t("Run file (Ctrl/Cmd + Enter)"));
		this.runAction.toggleClass("coder-is-running", running);
	}

	async toggleRun(): Promise<void> {
		const session = this.session;
		const file = this.file;
		if (!session || !file || this.starting) return;
		if (session.running) {
			session.stop();
			return;
		}
		const lang = this.lang;
		if (!lang || !canRun(lang, this.plugin.desktop)) return;
		this.starting = true;
		try {
			if (!(await this.plugin.confirmRun(lang.name, file.path))) return;
			await this.save();
		} finally {
			this.starting = false;
		}
		const adapter = this.app.vault.adapter;
		const desktopPath = this.plugin.desktop && adapter instanceof FileSystemAdapter ? adapter.getFullPath(file.path) : undefined;
		await this.plugin.run({
			session,
			lang,
			code: this.getViewData(),
			filePath: desktopPath,
			cwd: undefined,
			isBlock: false,
		});
	}
}
