import { App, FileSystemAdapter, Notice, PluginSettingTab, requireApiVersion, Setting, type SettingDefinitionItem } from "obsidian";
import type CoderPlugin from "../main";
import { t } from "../i18n";
import { LANGUAGES } from "../languages";
import { DEFAULT_SETTINGS } from "../settings";

const PLATFORM_NAMES: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

function showStatus(el: HTMLElement, id: string, command: string | null): void {
	el.toggleClass("is-found", !!command);
	el.toggleClass("is-missing", !command);
	if (command) el.setText(`✓ ${command}`);
	else if (id === "javascript") el.setText(t("Node.js not found — JavaScript runs in the in-app sandbox"));
	else el.setText(t("Not found — install it, or enter its path"));
}

/** One settings row: its name and description (also what settings search matches) and its controls. */
interface Row {
	name: string;
	desc?: string;
	/** A row of explanatory text only, kept out of settings search. */
	note?: boolean;
	visible?: () => boolean;
	/** Adds the controls. Its result is ignored (Setting's chaining methods return the Setting). */
	build?: (setting: Setting) => unknown;
}

interface Section {
	heading: string;
	rows: Row[];
}

/**
 * The rows are written once and rendered two ways: from getSettingDefinitions() on Obsidian 1.13
 * and later, which also puts them in settings search, and from display() on older versions.
 */
export class CoderSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: CoderPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return this.sections().map((section) => ({
			type: "group",
			heading: section.heading,
			items: section.rows.map((row) => ({
				name: row.name,
				desc: row.desc,
				searchable: !row.note,
				visible: row.visible,
				render: (setting: Setting) => this.renderRow(setting, row),
			})),
		}));
	}

	/** The settings tab for Obsidian before 1.13, which has no getSettingDefinitions(). */
	display(): void {
		this.renderLegacy();
	}

	private renderLegacy(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const section of this.sections()) {
			new Setting(containerEl).setName(section.heading).setHeading();
			for (const row of section.rows) {
				if (row.visible && !row.visible()) continue;
				if (row.note) containerEl.createDiv({ cls: "setting-item-description coder-lang-intro", text: row.desc });
				else this.renderRow(new Setting(containerEl), row);
			}
		}
	}

	private renderRow(setting: Setting, row: Row): void {
		setting.setName(row.name);
		if (row.desc) setting.setDesc(row.desc);
		if (row.note) setting.setClass("coder-lang-intro");
		row.build?.(setting);
	}

	/** Shows or hides the rows that depend on a setting that just changed. */
	private refresh(): void {
		// update() re-reads the definitions, so rows hidden at the first render are built too.
		if (requireApiVersion("1.13.0")) {
			this.update();
			this.refreshDomState();
		} else this.renderLegacy();
	}

	private sections(): Section[] {
		const s = this.plugin.settings;
		return [
			{
				heading: t("Code blocks"),
				rows: [
					{
						name: t("Show Run and Copy bar"),
						desc: t("A bar under each code block with the language, Copy, Run and the program's output."),
						build: (row) => row.addToggle((tg) => tg.setValue(s.showRunBar).onChange(async (v) => this.save({ showRunBar: v }, true))),
					},
					{
						name: t("Hide Obsidian's copy button"),
						desc: t("Avoids two copy buttons on the same code block."),
						build: (row) => row.addToggle((tg) => tg.setValue(s.hideNativeCopy).onChange(async (v) => this.save({ hideNativeCopy: v }, true))),
					},
					{
						name: t("Click inline code to copy"),
						desc: t("In reading view, click any inline code to copy it."),
						build: (row) => row.addToggle((tg) => tg.setValue(s.inlineCodeCopy).onChange(async (v) => this.save({ inlineCodeCopy: v }))),
					},
				],
			},
			{
				heading: t("Running code"),
				rows: [
					{
						name: t("Trusted folders"),
						desc: t(
							"Code in notes inside these folders runs on click; anywhere else, Brief Coder shows the code and asks first. One folder per line; / means the whole vault.",
						),
						build: (row) =>
							row.addTextArea((ta) => {
								ta.setPlaceholder("/").setValue(s.trustedFolders).onChange(async (v) => this.save({ trustedFolders: v }));
								ta.inputEl.rows = 3;
							}),
					},
					{
						name: t("Ask before running"),
						desc: t("Confirm every run, wherever the note is."),
						build: (row) => row.addToggle((tg) => tg.setValue(s.confirmBeforeRun).onChange(async (v) => this.save({ confirmBeforeRun: v }))),
					},
					{
						name: t("Time limit (seconds)"),
						desc: t("Stop programs that run longer than this. 0 = no limit (use Stop)."),
						build: (row) =>
							row.addText((tx) =>
								tx
									.setPlaceholder("0")
									.setValue(String(s.timeoutSeconds))
									.onChange(async (v) => this.save({ timeoutSeconds: Math.max(0, Number(v) || 0) })),
							),
					},
					{
						name: t("Output kept per run (KB)"),
						desc: t("Older output is dropped beyond this, so endless printing can't slow Obsidian down."),
						build: (row) =>
							row.addText((tx) =>
								tx
									.setPlaceholder(String(DEFAULT_SETTINGS.maxOutputKB))
									.setValue(String(s.maxOutputKB))
									.onChange(async (v) => this.save({ maxOutputKB: Math.min(5000, Math.max(16, Number(v) || DEFAULT_SETTINGS.maxOutputKB)) })),
							),
					},
					{
						name: t("Working folder for code blocks"),
						desc: t("Where relative paths in your code point to."),
						build: (row) =>
							row.addDropdown((d) =>
								d
									.addOption("note", t("The note's folder"))
									.addOption("temp", t("A temporary folder"))
									.setValue(s.blockWorkingDir)
									.onChange(async (v) => this.save({ blockWorkingDir: v as "note" | "temp" })),
							),
					},
					{
						name: t("JavaScript runs with"),
						desc: t(
							"Auto uses Node.js when it's installed, otherwise the in-app sandbox, which runs like JavaScript in a browser tab, with no access to your files or to Obsidian. Mobile always uses the sandbox.",
						),
						build: (row) =>
							row.addDropdown((d) =>
								d
									.addOption("auto", t("Auto"))
									.addOption("node", "Node.js")
									.addOption("in-app", t("In-app sandbox"))
									.setValue(s.jsRuntime)
									.onChange(async (v) => this.save({ jsRuntime: v as "auto" | "node" | "in-app" })),
							),
					},
				],
			},
			{
				heading: t("Code files"),
				rows: [
					{
						name: t("Open these file types in Brief Coder"),
						desc: t("Comma-separated extensions. Reload Obsidian after changing this list."),
						build: (row) =>
							row.addTextArea((ta) => {
								ta.setValue(s.openExtensions).onChange(async (v) => this.save({ openExtensions: v }));
								ta.inputEl.rows = 3;
								ta.inputEl.addClass("coder-setting-wide");
							}),
					},
					{
						name: t("Line numbers"),
						build: (row) => row.addToggle((tg) => tg.setValue(s.editorLineNumbers).onChange(async (v) => this.save({ editorLineNumbers: v }, false, true))),
					},
					{
						name: t("Wrap long lines"),
						build: (row) => row.addToggle((tg) => tg.setValue(s.editorWrap).onChange(async (v) => this.save({ editorWrap: v }, false, true))),
					},
					{
						name: t("Wrap text files"),
						build: (row) => row.addToggle((tg) => tg.setValue(s.textWrap).onChange(async (v) => this.save({ textWrap: v }, false, true))),
					},
					{
						name: t("Tab size"),
						build: (row) =>
							row.addDropdown((d) =>
								d
									.addOption("2", "2")
									.addOption("4", "4")
									.addOption("8", "8")
									.setValue(String(s.editorTabSize))
									.onChange(async (v) => this.save({ editorTabSize: Number(v) }, false, true)),
							),
					},
				],
			},
			{ heading: t("Agent bridge"), rows: this.bridgeRows() },
			{ heading: t("Languages"), rows: this.languageRows() },
		];
	}

	private bridgeRows(): Row[] {
		const s = this.plugin.settings;
		const enabled = () => this.plugin.settings.bridgeEnabled;
		return [
			{
				name: t("Let agents read this vault"),
				desc: t(
					"Off by default. When on, local agents such as Claude Code and Raqeeb can search and read notes in the folders below through coder-bridge.mjs, over stdio on this computer. Nothing is sent anywhere.",
				),
				build: (row) =>
					row.addToggle((tg) =>
						tg.setValue(s.bridgeEnabled).onChange(async (v) => {
							await this.save({ bridgeEnabled: v });
							this.refresh();
						}),
					),
			},
			{
				name: t("Folders agents can read"),
				desc: t("One per line; / means the whole vault. Hidden folders, such as Obsidian's configuration folder, are never shared."),
				visible: enabled,
				build: (row) =>
					row.addTextArea((ta) => {
						ta.setPlaceholder("/").setValue(s.bridgeFolders).onChange(async (v) => this.save({ bridgeFolders: v }));
						ta.inputEl.rows = 3;
					}),
			},
			{
				name: t("Folders to keep private"),
				desc: t("Never shared, even inside a folder above."),
				visible: enabled,
				build: (row) =>
					row.addTextArea((ta) => {
						ta.setValue(s.bridgeExclude).onChange(async (v) => this.save({ bridgeExclude: v }));
						ta.inputEl.rows = 2;
					}),
			},
			{
				name: t("Let agents propose changes"),
				desc: t("Proposed changes are held: nothing is written until you accept them in Agent changes."),
				visible: enabled,
				build: (row) => row.addToggle((tg) => tg.setValue(s.bridgeProposals).onChange(async (v) => this.save({ bridgeProposals: v }))),
			},
			{
				name: t("Connect an agent"),
				desc: t("Download coder-bridge.mjs from the release, then add this to the agent's MCP settings (Claude Code: .mcp.json)."),
				visible: enabled,
				build: (row) => {
					const config = this.mcpConfig();
					row.addButton((b) =>
						b.setButtonText(t("Copy config")).onClick(() => void navigator.clipboard.writeText(config).then(() => new Notice(t("Copied")))),
					);
					row.descEl.createEl("pre", { cls: "coder-bridge-config", text: config });
				},
			},
		];
	}

	/** The MCP server entry for this vault, with absolute paths where they're known (desktop). */
	private mcpConfig(): string {
		const adapter = this.app.vault.adapter;
		const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "<vault folder>";
		const sep = base.includes("\\") ? "\\" : "/";
		const dir = (this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`).split("/").join(sep);
		const args = [`${base}${sep}${dir}${sep}coder-bridge.mjs`, "--vault", base, "--config-dir", this.app.vault.configDir];
		return JSON.stringify({ mcpServers: { "brief-coder": { command: "node", args } } }, null, 2);
	}

	private languageRows(): Row[] {
		const s = this.plugin.settings;
		if (!this.plugin.desktop) {
			return [
				{
					name: "",
					note: true,
					desc: t("On mobile, Brief Coder runs JavaScript and HTML inside Obsidian. Other languages run in Obsidian for desktop."),
				},
			];
		}
		const statusEls = new Map<string, HTMLElement>();
		const rows: Row[] = [
			{
				name: "",
				note: true,
				desc: t(
					"Brief Coder uses the languages installed on this computer. Leave a command empty for the default, or enter a full path or extra options (for example /opt/homebrew/bin/python3.12).",
				),
			},
			{
				name: t("Check installed languages"),
				desc: t("Shows which languages can run here and which program runs each one."),
				build: (row) =>
					row.addButton((b) =>
						b.setButtonText(t("Check")).onClick(async () => {
							b.setDisabled(true);
							b.setButtonText(t("Checking…"));
							const found = await this.plugin.detectLanguages();
							for (const [id, el] of statusEls) showStatus(el, id, found.get(id) ?? null);
							b.setDisabled(false);
							b.setButtonText(t("Check again"));
						}),
					),
			},
		];
		for (const lang of LANGUAGES) {
			if (!lang.process) continue;
			const recipe = lang.process;
			const defaults = (process.platform === "win32" && recipe.windowsCommands) || recipe.commands;
			const shown = recipe.compile ? recipe.compile.commands : defaults;
			rows.push({
				name: lang.name,
				desc: t("Code blocks: {list}", { list: lang.aliases.slice(0, 4).join(", ") }),
				build: (row) => {
					row.addText((tx) =>
						tx
							.setPlaceholder(shown[0])
							.setValue(s.commands[lang.id] ?? "")
							.onChange(async (v) => {
								const commands = { ...this.plugin.settings.commands };
								if (v.trim()) commands[lang.id] = v.trim();
								else delete commands[lang.id];
								await this.save({ commands });
								this.plugin.resetDetection();
							}),
					);
					const status = row.descEl.createDiv({ cls: "coder-lang-status" });
					if (recipe.platforms && !recipe.platforms.includes(process.platform as "win32" | "darwin" | "linux")) {
						status.setText(t("{list} only", { list: recipe.platforms.map((p) => PLATFORM_NAMES[p]).join(" / ") }));
						status.addClass("is-missing");
					} else {
						statusEls.set(lang.id, status);
					}
				},
			});
		}
		return rows;
	}

	private async save(patch: Partial<typeof DEFAULT_SETTINGS>, refreshEditors = false, refreshCodeViews = false): Promise<void> {
		Object.assign(this.plugin.settings, patch);
		await this.plugin.saveSettings();
		this.plugin.applySettingsSideEffects(refreshEditors, refreshCodeViews);
	}
}
