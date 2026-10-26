import { App, Editor, FileSystemAdapter, MarkdownView, Modal, Notice, Platform, Plugin, Setting, TFile, TFolder, normalizePath } from "obsidian";
import { CHANGES_DIR, ChangeIO, Changeset, agentName, parseChangeset } from "./agent/changes";
import { t } from "./i18n";
import { LANGUAGES, languageForFence, normaliseFenceLanguage } from "./languages";
import { canRun, startRun } from "./run/runner";
import { RunSession, SessionStore } from "./run/session";
import { CoderSettings, DEFAULT_SETTINGS, parseExtensionList } from "./settings";
import { AgentChangesView, VIEW_TYPE_AGENT } from "./ui/agentView";
import { CodeView, VIEW_TYPE_CODE } from "./ui/codeView";
import { livePreviewExtension, refreshEffect } from "./ui/livePreview";
import { readingViewProcessor } from "./ui/readingView";
import { mountRunBar } from "./ui/runBar";
import { CoderSettingTab } from "./ui/settingsTab";
import { blockAtLine, blockKeys, findFencedBlocks, parseFenceInfo } from "./util/fence";
import { inFolders, parseFolders } from "./util/folders";

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

/** The plugin's ID before it was renamed to Brief Coder; its settings are imported once. */
const OLD_ID = "coder-studio";

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
	/** Held changesets already announced, so each proposal gets one notice. */
	private announced = new Set<string>();

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
		this.registerView(VIEW_TYPE_AGENT, (leaf) => new AgentChangesView(leaf, this));
		this.registerCodeExtensions();
		this.registerMarkdownPostProcessor(readingViewProcessor(this));
		this.registerEditorExtension(livePreviewExtension(this));
		this.addSettingTab(new CoderSettingTab(this.app, this));
		this.registerCommands();
		this.app.workspace.onLayoutReady(() => {
			void this.writeBridgeConfig();
			void this.checkAgentChanges();
		});
		// New proposals are noticed when you come back to Obsidian: no timers or watchers while idle.
		this.registerDomEvent(window, "focus", () => void this.checkAgentChanges());
	}

	onunload(): void {
		this.store.dispose();
		for (const unmount of Array.from(this.mounted)) unmount();
	}

	// ---------- settings ----------

	async loadSettings(): Promise<void> {
		let data = (await this.loadData()) as Partial<CoderSettings> | null;
		if (!data) data = await this.importOldSettings();
		this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}), commands: { ...(data?.commands ?? {}) } };
	}

	/** Brings over settings from the plugin's earlier ID (coder-studio), once. */
	private async importOldSettings(): Promise<Partial<CoderSettings> | null> {
		const path = normalizePath(`${this.app.vault.configDir}/plugins/${OLD_ID}/data.json`);
		try {
			if (!(await this.app.vault.adapter.exists(path))) return null;
			const data = JSON.parse(await this.app.vault.adapter.read(path)) as Partial<CoderSettings>;
			await this.saveData({ ...DEFAULT_SETTINGS, ...data });
			new Notice(t("Settings from Coder Studio were imported. You can remove the old coder-studio plugin."), 10000);
			return data;
		} catch {
			return null;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		await this.writeBridgeConfig();
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
					/* left to the other viewer */
				}
			}
		}
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

	/** Code from notes outside the trusted folders (or every run, with "Ask before running") is shown before it runs. */
	needsConfirm(path: string): boolean {
		return this.settings.confirmBeforeRun || !inFolders(path, parseFolders(this.settings.trustedFolders));
	}

	/** Asks before a run when needed. `code` is shown in the dialog (code blocks; a code file is already on screen). */
	async confirmRun(name: string, path: string, code?: string): Promise<boolean> {
		if (!this.needsConfirm(path)) return true;
		return ask(this.app, t("Run this {lang} code?", { lang: name }), t("From {path}. It runs on your computer with your permissions. Only run code you trust.", { path }), t("Run"), code);
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

	async runBlock(target: BlockTarget, confirmed = false): Promise<void> {
		const lang = languageForFence(target.fence);
		if (!lang) {
			new Notice(t('Brief Coder can\'t run "{lang}" code blocks.', { lang: target.fence || "plain" }));
			return;
		}
		if (!canRun(lang, this.desktop)) {
			new Notice(t("{lang} runs on Obsidian for desktop.", { lang: lang.name }));
			return;
		}
		const session = this.store.get(target.key);
		// A second click while the first is still being confirmed or prepared is ignored.
		if (session.running || this.starting.has(session)) return;
		if (!confirmed) {
			this.starting.add(session);
			try {
				confirmed = await this.confirmRun(lang.name, target.path, target.code);
			} finally {
				this.starting.delete(session);
			}
			if (!confirmed) return;
		}
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

	// ---------- agent bridge ----------

	/**
	 * Writes bridge.json next to the plugin, which coder-bridge.mjs reads on every request.
	 * Written only when it changes; with the bridge off it says so, and the server refuses every call.
	 */
	async writeBridgeConfig(): Promise<void> {
		const s = this.settings;
		const list = (text: string) => {
			const f = parseFolders(text);
			return f.includes("") ? [] : f;
		};
		const config = {
			enabled: s.bridgeEnabled,
			folders: list(s.bridgeFolders),
			exclude: parseFolders(s.bridgeExclude).filter(Boolean),
			allowProposals: s.bridgeProposals,
		};
		const path = normalizePath(`${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/bridge.json`);
		const text = JSON.stringify(config, null, "\t");
		const adapter = this.app.vault.adapter;
		try {
			if ((await adapter.exists(path)) && (await adapter.read(path)) === text) return;
			if (!s.bridgeEnabled && !(await adapter.exists(path))) return;
			await adapter.write(path, text);
		} catch (e) {
			console.error("[Brief Coder] bridge.json", e);
		}
	}

	/** Every changeset agents proposed, newest first. */
	async loadChangesets(): Promise<Changeset[]> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(CHANGES_DIR))) return [];
		const files = (await adapter.list(CHANGES_DIR)).files.filter((f) => f.endsWith(".json"));
		const out: Changeset[] = [];
		for (const f of files) {
			const c = parseChangeset(await adapter.read(f).catch(() => ""));
			if (c) out.push(c);
		}
		return out.sort((a, b) => (a.id < b.id ? 1 : -1));
	}

	async saveChangeset(c: Changeset): Promise<void> {
		if (!/^[\w-]+$/.test(c.id)) throw new Error(`Bad changeset id: ${c.id}`);
		await this.app.vault.adapter.write(`${CHANGES_DIR}/${c.id}.json`, JSON.stringify(c, null, 2));
	}

	/** Notes as the changeset code sees them: written through the vault, deletions go to the trash. */
	vaultIO(): ChangeIO {
		const vault = this.app.vault;
		const fileAt = (p: string) => {
			const f = vault.getAbstractFileByPath(normalizePath(p));
			return f instanceof TFile ? f : null;
		};
		return {
			read: async (p) => {
				const f = fileAt(p);
				return f ? vault.read(f) : null;
			},
			write: async (p, text) => {
				const f = fileAt(p);
				if (f) return vault.modify(f, text);
				const path = normalizePath(p);
				const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
				if (parent && !vault.getAbstractFileByPath(parent)) await vault.createFolder(parent);
				await vault.create(path, text);
			},
			remove: async (p) => {
				const f = fileAt(p);
				if (!f) return;
				// trashFile (1.6.6+) follows the user's "deleted files" setting; older Obsidian gets the system trash.
				const fm = this.app.fileManager as { trashFile?: (f: TFile) => Promise<void> };
				if (fm.trashFile) await fm.trashFile(f);
				else await vault.trash(f, true);
			},
		};
	}

	/** One notice per new held changeset, which opens Agent changes when clicked. */
	async checkAgentChanges(): Promise<void> {
		if (!this.settings.bridgeEnabled) return;
		const fresh = (await this.loadChangesets()).filter((c) => c.status === "held" && !this.announced.has(c.id));
		for (const c of fresh) {
			this.announced.add(c.id);
			const notice = new Notice(t("{agent} proposed {n} changes. Review them in Agent changes.", { agent: agentName(c.actor), n: c.entries.length }), 10000);
			notice.noticeEl.addEventListener("click", () => void this.openAgentChanges());
		}
		this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT).forEach((l) => void (l.view as AgentChangesView).refresh());
	}

	async openAgentChanges(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT)[0];
		const leaf = existing ?? this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
		if (!existing) await leaf.setViewState({ type: VIEW_TYPE_AGENT, active: true });
		await this.app.workspace.revealLeaf(leaf);
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
			name: t("Run code block at cursor"),
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
			name: t("Copy code block at cursor"),
			icon: "copy",
			editorCheckCallback: (checking, editor, view) => {
				if (!(view instanceof MarkdownView)) return false;
				const block = blockAtLine(findFencedBlocks(editor.getValue().split("\n")), editor.getCursor().line);
				if (!block) return false;
				if (!checking) void navigator.clipboard.writeText(block.code).then(() => new Notice(t("Code copied")));
				return true;
			},
		});

		this.addCommand({
			id: "run-all-code-blocks",
			name: t("Run all code blocks in this note"),
			icon: "play-circle",
			editorCheckCallback: (checking, editor, view) => {
				if (!(view instanceof MarkdownView)) return false;
				const runnable = this.blocksInEditor(editor, view).filter((x) => {
					const lang = languageForFence(x.block.lang);
					return x.block.closed && !parseFenceInfo(x.block.info).noRun && canRun(lang, this.desktop);
				});
				if (!runnable.length) return false;
				if (!checking) void this.runAll(runnable.map((x) => x.target));
				return true;
			},
		});

		this.addCommand({
			id: "clear-outputs",
			name: t("Clear all outputs in this note"),
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
			name: t("Stop all running code"),
			icon: "square",
			callback: () => this.store.stopAll(),
		});

		this.addCommand({
			id: "new-code-file",
			name: t("Create new code file"),
			icon: "file-code",
			callback: () => new NewCodeFileModal(this.app, this).open(),
		});

		this.addCommand({
			id: "run-code-file",
			name: t("Run current code file"),
			icon: "play",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(CodeView);
				if (!view) return false;
				if (!checking) void view.toggleRun();
				return true;
			},
		});

		this.addCommand({
			id: "review-agent-changes",
			name: t("Review agent changes"),
			icon: "bot",
			callback: () => void this.openAgentChanges(),
		});
	}

	/** "Run all" always asks once, naming what will run; untrusted notes also show every block's code. */
	private async runAll(targets: BlockTarget[]): Promise<void> {
		const counts = new Map<string, number>();
		for (const x of targets) {
			const name = languageForFence(x.fence)?.name ?? x.fence;
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}
		const list = Array.from(counts, ([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", ");
		const path = targets[0].path;
		const code = this.needsConfirm(path) ? targets.map((x) => x.code).join("\n\n────────\n\n") : undefined;
		const ok = await ask(
			this.app,
			t("Run {n} code blocks in this note?", { n: targets.length }),
			t("They run one after another: {list}. Stop all running code ends the sequence.", { list }),
			t("Run all"),
			code,
		);
		if (!ok) return;
		const generation = this.store.stopGeneration;
		for (const x of targets) {
			// "Stop all running code", or disabling the plugin, ends the whole sequence.
			if (this.store.stopGeneration !== generation) break;
			await this.runBlock(x, true);
		}
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

function ask(app: App, title: string, text: string, action: string, code?: string): Promise<boolean> {
	return new Promise((resolve) => new ConfirmRunModal(app, title, text, action, code, resolve).open());
}

class ConfirmRunModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private title: string,
		private text: string,
		private action: string,
		private code: string | undefined,
		private resolve: (ok: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.title);
		this.contentEl.createEl("p", { text: this.text });
		if (this.code !== undefined) {
			const shown = this.code.length > 20000 ? `${this.code.slice(0, 20000)}\n…` : this.code;
			this.contentEl.createEl("pre", { cls: "coder-confirm-code", text: shown });
		}
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(t("Cancel")).onClick(() => this.answer(false)))
			.addButton((b) => b.setButtonText(this.action).setCta().onClick(() => this.answer(true)));
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
		this.titleEl.setText(t("New code file"));
		let name = "";
		const create = async () => {
			const trimmed = name.trim();
			if (!/\.[A-Za-z0-9+_-]+$/.test(trimmed)) {
				new Notice(t("Add an extension, e.g. script.py or app.js"));
				return;
			}
			const ext = trimmed.split(".").pop()!.toLowerCase();
			if (!this.plugin.codeExtensions.has(ext)) {
				new Notice(t(".{ext} files aren't opened by Brief Coder. Add it in Settings → Brief Coder → Code files.", { ext }));
				return;
			}
			const active = this.app.workspace.getActiveFile();
			const folder = active?.parent ?? this.app.vault.getRoot();
			const base = folder instanceof TFolder && !folder.isRoot() ? `${folder.path}/` : "";
			const path = normalizePath(base + trimmed);
			if (this.app.vault.getAbstractFileByPath(path)) {
				new Notice(t("{path} already exists.", { path }));
				return;
			}
			try {
				const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
				if (parent && !this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
				const file = await this.app.vault.create(path, "");
				await this.app.workspace.getLeaf(true).openFile(file);
				this.close();
			} catch (e) {
				new Notice(t("Couldn't create {path}: {error}", { path, error: e instanceof Error ? e.message : String(e) }));
			}
		};
		new Setting(this.contentEl)
			.setName(t("File name"))
			.setDesc(t("Created next to the current note. Include a folder to put it elsewhere, e.g. scripts/tool.py."))
			.addText((tx) => {
				tx.setPlaceholder("script.py");
				tx.onChange((v) => (name = v));
				tx.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						void create();
					}
				});
				window.setTimeout(() => tx.inputEl.focus(), 0);
			})
			.addButton((b) => b.setButtonText(t("Create")).setCta().onClick(() => void create()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
