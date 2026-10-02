import { App, PluginSettingTab, Setting } from "obsidian";
import type CoderPlugin from "../main";
import { LANGUAGES } from "../languages";
import { DEFAULT_SETTINGS } from "../settings";

const PLATFORM_NAMES: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

function showStatus(el: HTMLElement, id: string, command: string | null): void {
	el.toggleClass("is-found", !!command);
	el.toggleClass("is-missing", !command);
	if (command) el.setText(`✓ ${command}`);
	else if (id === "javascript") el.setText("Node.js not found — JavaScript runs in the in-app sandbox");
	else el.setText("Not found — install it, or enter its path");
}

export class CoderSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: CoderPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl).setName("Code blocks").setHeading();
		new Setting(containerEl)
			.setName("Show Run and Copy bar")
			.setDesc("A bar under each code block with the language, Copy, Run and the program's output.")
			.addToggle((t) => t.setValue(s.showRunBar).onChange(async (v) => this.save({ showRunBar: v }, true)));
		new Setting(containerEl)
			.setName("Hide Obsidian's copy button")
			.setDesc("Avoids two copy buttons on the same code block.")
			.addToggle((t) => t.setValue(s.hideNativeCopy).onChange(async (v) => this.save({ hideNativeCopy: v }, true)));
		new Setting(containerEl)
			.setName("Click inline code to copy")
			.setDesc("In reading view, click any inline code to copy it.")
			.addToggle((t) => t.setValue(s.inlineCodeCopy).onChange(async (v) => this.save({ inlineCodeCopy: v })));

		new Setting(containerEl).setName("Running code").setHeading();
		new Setting(containerEl)
			.setName("Ask before running")
			.setDesc("Confirm every run. Useful if your vault contains notes from other people.")
			.addToggle((t) => t.setValue(s.confirmBeforeRun).onChange(async (v) => this.save({ confirmBeforeRun: v })));
		new Setting(containerEl)
			.setName("Time limit (seconds)")
			.setDesc("Stop programs that run longer than this. 0 = no limit (use Stop).")
			.addText((t) =>
				t
					.setPlaceholder("0")
					.setValue(String(s.timeoutSeconds))
					.onChange(async (v) => this.save({ timeoutSeconds: Math.max(0, Number(v) || 0) })),
			);
		new Setting(containerEl)
			.setName("Output kept per run (KB)")
			.setDesc("Older output is dropped beyond this, so endless printing can't slow Obsidian down.")
			.addText((t) =>
				t
					.setPlaceholder(String(DEFAULT_SETTINGS.maxOutputKB))
					.setValue(String(s.maxOutputKB))
					.onChange(async (v) => this.save({ maxOutputKB: Math.min(5000, Math.max(16, Number(v) || DEFAULT_SETTINGS.maxOutputKB)) })),
			);
		new Setting(containerEl)
			.setName("Working folder for code blocks")
			.setDesc("Where relative paths in your code point to.")
			.addDropdown((d) =>
				d
					.addOption("note", "The note's folder")
					.addOption("temp", "A temporary folder")
					.setValue(s.blockWorkingDir)
					.onChange(async (v) => this.save({ blockWorkingDir: v as "note" | "temp" })),
			);
		new Setting(containerEl)
			.setName("JavaScript runs with")
			.setDesc("Auto uses Node.js when it's installed, otherwise the in-app sandbox, which runs like JavaScript in a browser tab, with no access to your files or to Obsidian. Mobile always uses the sandbox.")
			.addDropdown((d) =>
				d
					.addOption("auto", "Auto")
					.addOption("node", "Node.js")
					.addOption("in-app", "In-app sandbox")
					.setValue(s.jsRuntime)
					.onChange(async (v) => this.save({ jsRuntime: v as "auto" | "node" | "in-app" })),
			);

		new Setting(containerEl).setName("Code files").setHeading();
		new Setting(containerEl)
			.setName("Open these file types in Coder")
			.setDesc("Comma-separated extensions. Reload Obsidian after changing this list.")
			.addTextArea((t) => {
				t.setValue(s.openExtensions).onChange(async (v) => this.save({ openExtensions: v }));
				t.inputEl.rows = 3;
				t.inputEl.addClass("coder-setting-wide");
			});
		new Setting(containerEl)
			.setName("Line numbers")
			.addToggle((t) => t.setValue(s.editorLineNumbers).onChange(async (v) => this.save({ editorLineNumbers: v }, false, true)));
		new Setting(containerEl)
			.setName("Wrap long lines")
			.addToggle((t) => t.setValue(s.editorWrap).onChange(async (v) => this.save({ editorWrap: v }, false, true)));
		new Setting(containerEl)
			.setName("Tab size")
			.addDropdown((d) =>
				d
					.addOption("2", "2")
					.addOption("4", "4")
					.addOption("8", "8")
					.setValue(String(s.editorTabSize))
					.onChange(async (v) => this.save({ editorTabSize: Number(v) }, false, true)),
			);

		new Setting(containerEl).setName("Languages").setHeading();
		const intro = containerEl.createDiv({ cls: "setting-item-description coder-lang-intro" });
		if (!this.plugin.desktop) {
			intro.setText("On mobile, Coder runs JavaScript and HTML inside Obsidian. Other languages run in Obsidian for desktop.");
			return;
		}
		intro.setText(
			"Coder uses the languages installed on this computer. Leave a command empty for the default, or enter a full path or extra options (for example /opt/homebrew/bin/python3.12).",
		);
		const statusEls = new Map<string, HTMLElement>();
		new Setting(containerEl)
			.setName("Check installed languages")
			.setDesc("Shows which languages can run here and which program runs each one.")
			.addButton((b) =>
				b.setButtonText("Check").onClick(async () => {
					b.setDisabled(true);
					b.setButtonText("Checking…");
					const found = await this.plugin.detectLanguages();
					for (const [id, el] of statusEls) showStatus(el, id, found.get(id) ?? null);
					b.setDisabled(false);
					b.setButtonText("Check again");
				}),
			);
		for (const lang of LANGUAGES) {
			if (!lang.process) continue;
			const recipe = lang.process;
			const defaults = (process.platform === "win32" && recipe.windowsCommands) || recipe.commands;
			const shown = recipe.compile ? recipe.compile.commands : defaults;
			const row = new Setting(containerEl).setName(lang.name).addText((t) =>
				t
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
			row.descEl.createDiv({ text: `Code blocks: ${lang.aliases.slice(0, 4).join(", ")}` });
			const status = row.descEl.createDiv({ cls: "coder-lang-status" });
			if (recipe.platforms && !recipe.platforms.includes(process.platform as "win32" | "darwin" | "linux")) {
				status.setText(`${recipe.platforms.map((p) => PLATFORM_NAMES[p]).join(" / ")} only`);
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
