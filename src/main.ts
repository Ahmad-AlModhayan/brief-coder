import { App, Editor, FileSystemAdapter, MarkdownView, Modal, Notice, Platform, Plugin, Setting, TFolder, normalizePath } from "obsidian";
import { LANGUAGES, languageForFence, normaliseFenceLanguage } from "./languages";
import { canRun, startRun } from "./run/runner";
import { RunSession, SessionStore } from "./run/session";
import { CoderSettings, DEFAULT_SETTINGS, parseExtensionList } from "./settings";
import { CodeView, VIEW_TYPE_CODE } from "./ui/codeView";
import { livePreviewExtension, refreshEffect } from "./ui/livePreview";
import { readingViewProcessor } from "./ui/readingView";
import { mountRunBar } from "./ui/runBar";
import { CoderSettingTab } from "./ui/settingsTab";
import { blockAtLine, blockKeys, findFencedBlocks, parseFenceInfo } from "./util/fence";

export interface BlockTarget {
	key: string;
	/** Vault path of the note. */
	path: string;
	/** Language token from the fence (may be empty). */
	fence: string;
	/** Full info string (for title / norun). */
	info: string;
	code: string;
}

export interface RunRequest {
	session: RunSession;
	lang: (typeof LANGUAGES)[number];
	code: string;
	filePath?: string;
	cwd?: string;
	isBlock: boolean;
}

export default class CoderPlugin extends Plugin {
	settings: CoderSettings = { ...DEFAULT_SETTINGS };
	store = new SessionStore(() => this.settings.maxOutputKB * 1024);
	codeExtensions = new Set<string>();
	/** Unmount functions of every bar on screen. */
	private mounted = new Set<() => void>();
	/** Sessions whose Run was clicked and are waiting for confirmation. */
	private starting = new Set<RunSession>();
	private warmed = false;
	private canSpawn: boolean | undefined;

	/**
	 * True when programs can be started on this device: Obsidian for desktop, where Node's
	 * child_process exists. False on phones and tablets (and in Obsidian's mobile emulation).
	 */
	get desktop(): boolean {
		if (this.canSpawn === undefined) this.canSpawn = Platform.isDesktopApp && !Platform.isMobile && hasChildProcess();
		return this.canSpawn;
	}

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_CODE, (leaf) => new CodeView(leaf, this));
		this.registerCodeExtensions();
		this.registerMarkdownPostProcessor(readingViewProcessor(this));
		this.registerEditorExtension(livePreviewExtension(this));
		this.addSettingTab(new CoderSettingTab(this.app, this));
		this.registerCommands();
	}

	onunload(): void {
		this.store.dispose();
		for (const unmount of Array.from(this.mounted)) unmount();
	}

	// ---------- settings ----------

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<CoderSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}), commands: { ...(data?.commands ?? {}) } };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	applySettingsSideEffects(refreshEditors: boolean, refreshCodeViews: boolean): void {
		if (refreshEditors) {
			this.app.workspace.iterateAllLeaves((leaf) => {
				const view = leaf.view;
				if (view instanceof MarkdownView) {
					const cm = (view.editor as unknown as { cm?: { dispatch: (t: object) => void } }).cm;
					cm?.dispatch({ effects: refreshEffect.of(null) });
					if (view.getMode() === "preview") view.previewMode.rerender(true);
				}
			});
		}
		if (refreshCodeViews) {
			this.app.workspace.getLeavesOfType(VIEW_TYPE_CODE).forEach((leaf) => (leaf.view as CodeView).refreshOptions());
		}
	}

	/**
	 * Registers all code file extensions in one call: every registration makes Obsidian refresh the
	 * file list, so 70 single calls would mean 70 refreshes at startup. Extensions another plugin
	 * (or Obsidian) already handles are left alone.
	 */
	private registerCodeExtensions(): void {
		const wanted = parseExtensionList(this.settings.openExtensions);
		const registry = (this.app as unknown as { viewRegistry?: { isExtensionRegistered?: (ext: string) => boolean } }).viewRegistry;
		const isTaken = (ext: string) => registry?.isExtensionRegistered?.(ext) ?? false;
		const free = wanted.filter((ext) => !isTaken(ext));
		const skipped = wanted.filter((ext) => isTaken(ext));
		try {
			if (free.length) this.registerExtensions(free, VIEW_TYPE_CODE);
			for (const ext of free) this.codeExtensions.add(ext);
		} catch {
			// Something claimed an extension in between: fall back to one at a time.
			for (const ext of free) {
				try {
					this.registerExtensions([ext], VIEW_TYPE_CODE);
					this.codeExtensions.add(ext);
				} catch {
					skipped.push(ext);
				}
			}
		}
		if (skipped.length) console.info(`[Obsidian Coder] Left to other viewers: ${skipped.join(", ")}`);
	}

	resetDetection(): void {
		if (!this.desktop) return;
		this.warmed = false;
		void import("./run/process").then((m) => m.resetDetection());
	}

	/**
	 * Finds the user's tools (PATH from the login shell) ahead of the first run. Called only when a
	 * run is likely (pointer over Run, or a code file opened), never at startup.
	 */
	warmUp(): void {
		if (!this.desktop || this.warmed) return;
		this.warmed = true;
		void import("./run/process").then((m) => m.runEnv()).catch(() => (this.warmed = false));
	}

	/**
	 * Which command would run each language on this computer (settings → Check).
	 * Returns a map of language id → resolved command, or null when not found.
	 */
	async detectLanguages(): Promise<Map<string, string | null>> {
		const { detect, resetDetection } = await import("./run/process");
		resetDetection();
		this.warmed = false;
		const result = new Map<string, string | null>();
		for (const lang of LANGUAGES) if (lang.process) result.set(lang.id, await detect(lang, this.settings));
		return result;
	}

	// ---------- running ----------

	async confirmRun(name: string): Promise<boolean> {
		if (!this.settings.confirmBeforeRun) return true;
		return new Promise((resolve) => new ConfirmRunModal(this.app, name, resolve).open());
	}

	async run(req: RunRequest): Promise<void> {
		await startRun({ ...req, settings: this.settings, desktop: this.desktop });
	}

	private blockCwd(notePath: string): string | undefined {
		if (!this.desktop || this.settings.blockWorkingDir !== "note") return undefined;
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return undefined;
		const folder = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
		return folder ? adapter.getFullPath(normalizePath(folder)) : adapter.getBasePath();
	}

	async runBlock(target: BlockTarget): Promise<void> {
		const lang = languageForFence(target.fence);
		if (!lang) {
			new Notice(`Obsidian Coder can't run "${target.fence || "plain"}" code blocks.`);
			return;
		}
		if (!canRun(lang, this.desktop)) {
			new Notice(`${lang.name} runs on Obsidian for desktop.`);
			return;
		}
		const session = this.store.get(target.key);
		// A second click while the first is still being confirmed or prepared is ignored.
		if (session.running || this.starting.has(session)) return;
		this.starting.add(session);
		let confirmed = false;
		try {
			confirmed = await this.confirmRun(lang.name);
		} finally {
			this.starting.delete(session);
		}
		if (!confirmed) return;
		// The bar may have been redrawn while the user confirmed: run in the session it shows now.
		await this.run({ session: this.store.get(target.key), lang, code: target.code, cwd: this.blockCwd(target.path), isBlock: true });
	}

	/**
	 * Builds the bar + output for one code block (reading view or Live Preview). Returns an unmount
	 * function; the plugin also calls it when it is disabled, so no bar outlives the plugin.
	 */
	mountBlock(host: HTMLElement, target: BlockTarget, afterUnmount?: () => void): () => void {
		const lang = languageForFence(target.fence);
		const info = parseFenceInfo(target.info);
		const runnable = !info.noRun && canRun(lang, this.desktop);
		const session = this.store.get(target.key);
		const cleanup = mountRunBar(host, {
			label: lang?.name ?? (normaliseFenceLanguage(target.fence) || "Code"),
			title: info.title,
			runnable,
			getCode: () => target.code,
			session,
			onRun: () => void this.runBlock(target),
			onStop: () => session.stop(),
			onClear: () => session.clear(),
			onWarm: () => this.warmUp(),
		});
		let mounted = true;
		const unmount = () => {
			if (!mounted) return;
			mounted = false;
			this.mounted.delete(unmount);
			cleanup();
			afterUnmount?.();
		};
		this.mounted.add(unmount);
		return unmount;
	}

	// ---------- commands ----------

	private blocksInEditor(editor: Editor, view: MarkdownView) {
		const path = view.file?.path ?? "";
		const blocks = findFencedBlocks(editor.getValue().split("\n"));
		const keys = blockKeys(path, blocks);
		return blocks.map((b, i) => ({ block: b, target: { key: keys[i], path, fence: b.lang, info: b.info, code: b.code } as BlockTarget }));
	}

	private registerCommands(): void {
		this.addCommand({
			id: "run-code-block",
			name: "Run code block at cursor",
			icon: "play",
			editorCheckCallback: (checking, editor, view) => {
				if (!(view instanceof MarkdownView)) return false;
				const line = editor.getCursor().line;
				const hit = this.blocksInEditor(editor, view).find((x) => line >= x.block.startLine && line <= x.block.endLine);
				const lang = hit ? languageForFence(hit.block.lang) : undefined;
				if (!hit || !canRun(lang, this.desktop)) return false;
				if (!checking) void this.runBlock(hit.target);
				return true;
			},
		});

		this.addCommand({
			id: "copy-code-block",
			name: "Copy code block at cursor",
			icon: "copy",
			editorCheckCallback: (checking, editor, view) => {
				if (!(view instanceof MarkdownView)) return false;
				const block = blockAtLine(findFencedBlocks(editor.getValue().split("\n")), editor.getCursor().line);
				if (!block) return false;
				if (!checking) void navigator.clipboard.writeText(block.code).then(() => new Notice("Code copied"));
				return true;
			},
		});

		this.addCommand({
			id: "run-all-code-blocks",
			name: "Run all code blocks in this note",
			icon: "play-circle",
			editorCheckCallback: (checking, editor, view) => {
				if (!(view instanceof MarkdownView)) return false;
				const runnable = this.blocksInEditor(editor, view).filter((x) => {
					const lang = languageForFence(x.block.lang);
					return x.block.closed && !parseFenceInfo(x.block.info).noRun && canRun(lang, this.desktop);
				});
				if (!runnable.length) return false;
				if (!checking) {
					void (async () => {
						const generation = this.store.stopGeneration;
						for (const x of runnable) {
							// "Stop all running code", or disabling the plugin, ends the whole sequence.
							if (this.store.stopGeneration !== generation) break;
							await this.runBlock(x.target);
						}
					})();
				}
				return true;
			},
		});

		this.addCommand({
			id: "clear-outputs",
			name: "Clear all outputs in this note",
			icon: "eraser",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) this.store.clearPath(file.path);
				return true;
			},
		});

		this.addCommand({
			id: "stop-all",
			name: "Stop all running code",
			icon: "square",
			callback: () => this.store.stopAll(),
		});

		this.addCommand({
			id: "new-code-file",
			name: "Create new code file",
			icon: "file-code",
			callback: () => new NewCodeFileModal(this.app, this).open(),
		});

		this.addCommand({
			id: "run-code-file",
			name: "Run current code file",
			icon: "play",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(CodeView);
				if (!view) return false;
				if (!checking) void view.toggleRun();
				return true;
			},
		});
	}
}

function hasChildProcess(): boolean {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const cp = require("child_process") as { spawn?: unknown } | null;
		return !!cp && typeof cp.spawn === "function";
	} catch {
		return false;
	}
}

class ConfirmRunModal extends Modal {
	private answered = false;

	constructor(app: App, private name: string, private resolve: (ok: boolean) => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(`Run this ${this.name} code?`);
		this.contentEl.createEl("p", { text: "It runs on your computer with your permissions. Only run code you trust." });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.answer(false)))
			.addButton((b) => b.setButtonText("Run").setCta().onClick(() => this.answer(true)));
		this.scope.register([], "Enter", () => {
			this.answer(true);
			return false;
		});
	}

	private answer(ok: boolean): void {
		this.answered = true;
		this.resolve(ok);
		this.close();
	}

	onClose(): void {
		if (!this.answered) this.resolve(false);
		this.contentEl.empty();
	}
}

class NewCodeFileModal extends Modal {
	constructor(app: App, private plugin: CoderPlugin) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("New code file");
		let name = "";
		const create = async () => {
			const trimmed = name.trim();
			if (!/\.[A-Za-z0-9+_-]+$/.test(trimmed)) {
				new Notice("Add an extension, e.g. script.py or app.js");
				return;
			}
			const ext = trimmed.split(".").pop()!.toLowerCase();
			if (!this.plugin.codeExtensions.has(ext)) {
				new Notice(`.${ext} files aren't opened by Coder. Add it in Settings → Obsidian Coder → Code files.`);
				return;
			}
			const active = this.app.workspace.getActiveFile();
			const folder = active?.parent ?? this.app.vault.getRoot();
			const base = folder instanceof TFolder && !folder.isRoot() ? `${folder.path}/` : "";
			const path = normalizePath(base + trimmed);
			if (this.app.vault.getAbstractFileByPath(path)) {
				new Notice(`${path} already exists.`);
				return;
			}
			try {
				const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
				if (parent && !this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
				const file = await this.app.vault.create(path, "");
				await this.app.workspace.getLeaf(true).openFile(file);
				this.close();
			} catch (e) {
				new Notice(`Couldn't create ${path}: ${e instanceof Error ? e.message : String(e)}`);
			}
		};
		new Setting(this.contentEl)
			.setName("File name")
			.setDesc("Created next to the current note. Include a folder to put it elsewhere, e.g. scripts/tool.py.")
			.addText((t) => {
				t.setPlaceholder("script.py");
				t.onChange((v) => (name = v));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						void create();
					}
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			})
			.addButton((b) => b.setButtonText("Create").setCta().onClick(() => void create()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
