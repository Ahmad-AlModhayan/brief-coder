import { App, FileSystemAdapter, Notice, PluginSettingTab, Setting } from "obsidian";
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

export class CoderSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: CoderPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl).setName(t("Code blocks")).setHeading();
		new Setting(containerEl)
			.setName(t("Show Run and Copy bar"))
			.setDesc(t("A bar under each code block with the language, Copy, Run and the program's output."))
			.addToggle((tg) => tg.setValue(s.showRunBar).onChange(async (v) => this.save({ showRunBar: v }, true)));
		new Setting(containerEl)
			.setName(t("Hide Obsidian's copy button"))
			.setDesc(t("Avoids two copy buttons on the same code block."))
			.addToggle((tg) => tg.setValue(s.hideNativeCopy).onChange(async (v) => this.save({ hideNativeCopy: v }, true)));
		new Setting(containerEl)
			.setName(t("Click inline code to copy"))
			.setDesc(t("In reading view, click any inline code to copy it."))
			.addToggle((tg) => tg.setValue(s.inlineCodeCopy).onChange(async (v) => this.save({ inlineCodeCopy: v })));

		new Setting(containerEl).setName(t("Running code")).setHeading();
		new Setting(containerEl)
			.setName(t("Trusted folders"))
			.setDesc(
				t(
					"Code in notes inside these folders runs on click; anywhere else, Brief Coder shows the code and asks first. One folder per line; / means the whole vault.",
				),
			)
			.addTextArea((ta) => {
				ta.setPlaceholder("/").setValue(s.trustedFolders).onChange(async (v) => this.save({ trustedFolders: v }));
				ta.inputEl.rows = 3;
			});
		new Setting(containerEl)
			.setName(t("Ask before running"))
			.setDesc(t("Confirm every run, wherever the note is."))
			.addToggle((tg) => tg.setValue(s.confirmBeforeRun).onChange(async (v) => this.save({ confirmBeforeRun: v })));
		new Setting(containerEl)
			.setName(t("Time limit (seconds)"))
			.setDesc(t("Stop programs that run longer than this. 0 = no limit (use Stop)."))
			.addText((tx) =>
				tx
					.setPlaceholder("0")
					.setValue(String(s.timeoutSeconds))
					.onChange(async (v) => this.save({ timeoutSeconds: Math.max(0, Number(v) || 0) })),
			);
		new Setting(containerEl)
			.setName(t("Output kept per run (KB)"))
			.setDesc(t("Older output is dropped beyond this, so endless printing can't slow Obsidian down."))
			.addText((tx) =>
				tx
					.setPlaceholder(String(DEFAULT_SETTINGS.maxOutputKB))
					.setValue(String(s.maxOutputKB))
					.onChange(async (v) => this.save({ maxOutputKB: Math.min(5000, Math.max(16, Number(v) || DEFAULT_SETTINGS.maxOutputKB)) })),
			);
		new Setting(containerEl)
			.setName(t("Working folder for code blocks"))
			.setDesc(t("Where relative paths in your code point to."))
			.addDropdown((d) =>
				d
					.addOption("note", t("The note's folder"))
					.addOption("temp", t("A temporary folder"))
					.setValue(s.blockWorkingDir)
					.onChange(async (v) => this.save({ blockWorkingDir: v as "note" | "temp" })),
			);
		new Setting(containerEl)
			.setName(t("JavaScript runs with"))
			.setDesc(
				t(
					"Auto uses Node.js when it's installed, otherwise the in-app sandbox, which runs like JavaScript in a browser tab, with no access to your files or to Obsidian. Mobile always uses the sandbox.",
				),
			)
			.addDropdown((d) =>
				d
					.addOption("auto", t("Auto"))
					.addOption("node", "Node.js")
					.addOption("in-app", t("In-app sandbox"))
					.setValue(s.jsRuntime)
					.onChange(async (v) => this.save({ jsRuntime: v as "auto" | "node" | "in-app" })),
			);

		new Setting(containerEl).setName(t("Code files")).setHeading();
		new Setting(containerEl)
			.setName(t("Open these file types in Brief Coder"))
			.setDesc(t("Comma-separated extensions. Reload Obsidian after changing this list."))
			.addTextArea((ta) => {
				ta.setValue(s.openExtensions).onChange(async (v) => this.save({ openExtensions: v }));
				ta.inputEl.rows = 3;
				ta.inputEl.addClass("coder-setting-wide");
			});
		new Setting(containerEl)
			.setName(t("Line numbers"))
			.addToggle((tg) => tg.setValue(s.editorLineNumbers).onChange(async (v) => this.save({ editorLineNumbers: v }, false, true)));
		new Setting(containerEl)
			.setName(t("Wrap long lines"))
			.addToggle((tg) => tg.setValue(s.editorWrap).onChange(async (v) => this.save({ editorWrap: v }, false, true)));
		new Setting(containerEl)
			.setName(t("Tab size"))
			.addDropdown((d) =>
				d
					.addOption("2", "2")
					.addOption("4", "4")
					.addOption("8", "8")
					.setValue(String(s.editorTabSize))
					.onChange(async (v) => this.save({ editorTabSize: Number(v) }, false, true)),
			);

		this.displayBridge(containerEl);
		this.displayLanguages(containerEl);
	}

	private displayBridge(containerEl: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(containerEl).setName(t("Agent bridge")).setHeading();
		new Setting(containerEl)
			.setName(t("Let agents read this vault"))
			.setDesc(
				t(
					"Off by default. When on, local agents such as Claude Code and Raqeeb can search and read notes in the folders below through coder-bridge.mjs, over stdio on this computer. Nothing is sent anywhere.",
				),
			)
			.addToggle((tg) =>
				tg.setValue(s.bridgeEnabled).onChange(async (v) => {
					await this.save({ bridgeEnabled: v });
					this.display();
				}),
			);
		if (!s.bridgeEnabled) return;
		new Setting(containerEl)
			.setName(t("Folders agents can read"))
			.setDesc(t("One per line; / means the whole vault. Hidden folders such as .obsidian are never shared."))
			.addTextArea((ta) => {
				ta.setPlaceholder("/").setValue(s.bridgeFolders).onChange(async (v) => this.save({ bridgeFolders: v }));
				ta.inputEl.rows = 3;
			});
		new Setting(containerEl)
			.setName(t("Folders to keep private"))
			.setDesc(t("Never shared, even inside a folder above."))
			.addTextArea((ta) => {
				ta.setValue(s.bridgeExclude).onChange(async (v) => this.save({ bridgeExclude: v }));
				ta.inputEl.rows = 2;
			});
		new Setting(containerEl)
			.setName(t("Let agents propose changes"))
			.setDesc(t("Proposed changes are held: nothing is written until you accept them in Agent changes."))
			.addToggle((tg) => tg.setValue(s.bridgeProposals).onChange(async (v) => this.save({ bridgeProposals: v })));
		const config = this.mcpConfig();
		const row = new Setting(containerEl)
			.setName(t("Connect an agent"))
			.setDesc(t("Download coder-bridge.mjs from the release, then add this to the agent's MCP settings (Claude Code: .mcp.json)."))
			.addButton((b) =>
				b.setButtonText(t("Copy config")).onClick(() => void navigator.clipboard.writeText(config).then(() => new Notice(t("Copied")))),
			);
		row.descEl.createEl("pre", { cls: "coder-bridge-config", text: config });
	}

	/** The MCP server entry for this vault, with absolute paths where they're known (desktop). */
	private mcpConfig(): string {
		const adapter = this.app.vault.adapter;
		const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "<vault folder>";
		const sep = base.includes("\\") ? "\\" : "/";
		const dir = (this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`).split("/").join(sep);
		const args = [`${base}${sep}${dir}${sep}coder-bridge.mjs`, "--vault", base];
		if (this.app.vault.configDir !== ".obsidian") args.push("--config-dir", this.app.vault.configDir);
		return JSON.stringify({ mcpServers: { "brief-coder": { command: "node", args } } }, null, 2);
	}

	private displayLanguages(containerEl: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(containerEl).setName(t("Languages")).setHeading();
		const intro = containerEl.createDiv({ cls: "setting-item-description coder-lang-intro" });
		if (!this.plugin.desktop) {
			intro.setText(t("On mobile, Brief Coder runs JavaScript and HTML inside Obsidian. Other languages run in Obsidian for desktop."));
			return;
		}
		intro.setText(
			t(
				"Brief Coder uses the languages installed on this computer. Leave a command empty for the default, or enter a full path or extra options (for example /opt/homebrew/bin/python3.12).",
			),
		);
		const statusEls = new Map<string, HTMLElement>();
		new Setting(containerEl)
			.setName(t("Check installed languages"))
			.setDesc(t("Shows which languages can run here and which program runs each one."))
			.addButton((b) =>
				b.setButtonText(t("Check")).onClick(async () => {
					b.setDisabled(true);
					b.setButtonText(t("Checking…"));
					const found = await this.plugin.detectLanguages();
					for (const [id, el] of statusEls) showStatus(el, id, found.get(id) ?? null);
					b.setDisabled(false);
					b.setButtonText(t("Check again"));
				}),
			);
		for (const lang of LANGUAGES) {
			if (!lang.process) continue;
			const recipe = lang.process;
			const defaults = (process.platform === "win32" && recipe.windowsCommands) || recipe.commands;
			const shown = recipe.compile ? recipe.compile.commands : defaults;
			const row = new Setting(containerEl).setName(lang.name).addText((tx) =>
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
			row.descEl.createDiv({ text: t("Code blocks: {list}", { list: lang.aliases.slice(0, 4).join(", ") }) });
			const status = row.descEl.createDiv({ cls: "coder-lang-status" });
			if (recipe.platforms && !recipe.platforms.includes(process.platform as "win32" | "darwin" | "linux")) {
				status.setText(t("{list} only", { list: recipe.platforms.map((p) => PLATFORM_NAMES[p]).join(" / ") }));
				status.addClass("is-missing");
			} else {
				statusEls.set(lang.id, status);
			}
		}
	}

	private async save(patch: Partial<typeof DEFAULT_SETTINGS>, refreshEditors = false, refreshCodeViews = false): Promise<void> {
		Object.assign(this.plugin.settings, patch);
		await this.plugin.saveSettings();
		this.plugin.applySettingsSideEffects(refreshEditors, refreshCodeViews);
	}
}
