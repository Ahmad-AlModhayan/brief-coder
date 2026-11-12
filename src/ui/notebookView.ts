import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Component, FileView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { sha256 } from "../agent/changes";
import { isArabic, t } from "../i18n";
import { languageForFence } from "../languages";
import type CoderPlugin from "../main";
import { markdownTooLarge, parseMarkdown } from "../notebook/markdown";
import { imageSource, isHeldBack, planOutput } from "../notebook/outputs";
import { MimeBundle, Notebook, NotebookCell, ParseResult, parseNotebook } from "../notebook/parse";
import { isNotebookTrusted, revokeNotebook, trustNotebook } from "../notebook/trust";
import { previewDocument } from "../run/inapp";
import { editorTheme, languageFor, themeHighlighting } from "./highlight";
import { drawMarkdownTree } from "./notebookMarkdown";

export const VIEW_TYPE_NOTEBOOK = "coder-notebook-view";

/** Beyond this a file isn't read at all: the string and its parse would strain a phone. */
const MAX_FILE_BYTES = 256 * 1024 * 1024;
/** Cells this far from the screen are drawn in advance, and removed again further away. */
const DRAW_MARGIN = "800px 0px";
const LINE_PX = 21;
const SAFE_LINK = /^(?:https?:|mailto:)/i;
const STRIPPED = "script,iframe,frame,frameset,object,embed,applet,portal,style,link,meta,base,form,video,audio,source,track";

interface CellSlot {
	cell: NotebookCell;
	el: HTMLElement;
	/** Set while the cell is drawn; unloading it removes everything the cell created. */
	drawn: Component | null;
}

/**
 * Shows a Jupyter notebook. A FileView, not a TextFileView: it has no save path at all, so nothing here
 * (autosave, closing, a reload, an agent's change elsewhere) can write to the file. The same code runs on
 * desktop and mobile. Cells are drawn only near the screen, so a large notebook opens and scrolls smoothly.
 */
export class NotebookView extends FileView {
	private slots: CellSlot[] = [];
	private observer: IntersectionObserver | null = null;
	private notebook: Notebook | null = null;
	/** Hash of the text on screen; pressing Trust trusts exactly this. */
	private hash = "";
	private loadId = 0;
	private bySlot = new WeakMap<Element, CellSlot>();

	constructor(leaf: WorkspaceLeaf, private plugin: CoderPlugin) {
		super(leaf);
		this.allowNoFile = false;
	}

	getViewType(): string {
		return VIEW_TYPE_NOTEBOOK;
	}

	getDisplayText(): string {
		return this.file?.basename ?? t("Notebook");
	}

	getIcon(): string {
		return "book-open";
	}

	canAcceptExtension(extension: string): boolean {
		return extension.toLowerCase() === "ipynb";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("coder-nb");
		// Links in rendered markdown never navigate the app; web links go to the browser.
		this.registerDomEvent(this.contentEl, "click", (e) => {
			const link = (e.target as HTMLElement).closest?.("a");
			if (!link) return;
			e.preventDefault();
			const href = link.getAttribute("href") ?? "";
			if (SAFE_LINK.test(href)) window.open(href, "_blank", "noopener");
		});
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file === this.file && file instanceof TFile) void this.loadNotebook(file);
			}),
		);
	}

	async onClose(): Promise<void> {
		this.teardown();
	}

	async onLoadFile(file: TFile): Promise<void> {
		await this.loadNotebook(file);
	}

	async onUnloadFile(): Promise<void> {
		this.loadId++;
		this.teardown();
		this.contentEl.empty();
	}

	private async loadNotebook(file: TFile): Promise<void> {
		const id = ++this.loadId;
		if (file.stat.size > MAX_FILE_BYTES) {
			this.showRefusal(t("This file is too large to open as a notebook."));
			return;
		}
		const text = await this.app.vault.cachedRead(file);
		const hash = await sha256(text);
		const parsed = parseNotebook(text);
		if (id !== this.loadId) return;
		this.hash = hash;
		if (!parsed.ok) {
			this.showRefusal(refusalText(parsed));
			return;
		}
		this.notebook = parsed.notebook;
		this.draw();
	}

	/** Trust changed somewhere, or the file did: draw again, keeping the place. */
	refresh(): void {
		if (!this.notebook) return;
		const top = this.contentEl.scrollTop;
		this.draw();
		this.contentEl.scrollTop = top;
	}

	private teardown(): void {
		this.observer?.disconnect();
		this.observer = null;
		for (const slot of this.slots) slot.drawn?.unload();
		this.slots = [];
		this.notebook = null;
	}

	private showRefusal(reason: string): void {
		this.teardown();
		this.contentEl.empty();
		const box = this.contentEl.createDiv({ cls: "coder-nb-refusal", attr: { role: "alert", dir: isArabic() ? "rtl" : "ltr" } });
		box.createEl("strong", { text: t("This notebook can't be shown.") });
		box.createEl("p", { text: reason, attr: { dir: "auto" } });
		box.createEl("p", { text: t("The file hasn't been changed.") });
	}

	private get trusted(): boolean {
		const path = this.file?.path;
		return !!path && isNotebookTrusted(this.plugin.settings.trustedNotebooks, path, this.hash);
	}

	private draw(): void {
		const notebook = this.notebook;
		if (!notebook) return;
		this.observer?.disconnect();
		for (const slot of this.slots) slot.drawn?.unload();
		this.slots = [];
		this.contentEl.empty();
		this.drawBanner(notebook);
		if (!notebook.cells.length) note(this.contentEl, t("This notebook has no cells."));
		const win = this.contentEl.ownerDocument.defaultView ?? window;
		this.observer = new win.IntersectionObserver((entries) => this.onScrollNear(entries), { root: this.contentEl, rootMargin: DRAW_MARGIN });
		for (const cell of notebook.cells) {
			const el = this.contentEl.createDiv({ cls: `coder-nb-cell is-${cell.kind}` });
			el.setCssProps({ "--coder-nb-height": `${estimateHeight(cell)}px` });
			const slot: CellSlot = { cell, el, drawn: null };
			this.slots.push(slot);
			this.bySlot.set(el, slot);
			this.observer.observe(el);
		}
	}

	private onScrollNear(entries: IntersectionObserverEntry[]): void {
		for (const entry of entries) {
			const slot = this.bySlot.get(entry.target);
			if (!slot) continue;
			if (entry.isIntersecting && !slot.drawn) {
				slot.el.removeClass("is-waiting");
				this.drawCell(slot);
			} else if (!entry.isIntersecting && slot.drawn) {
				// Keep its height so the page doesn't jump, and free what it used.
				slot.el.setCssProps({ "--coder-nb-height": `${slot.el.offsetHeight}px` });
				slot.el.addClass("is-waiting");
				slot.drawn.unload();
				slot.drawn = null;
				slot.el.empty();
			}
		}
	}

	private drawBanner(notebook: Notebook): void {
		const file = this.file;
		if (!file) return;
		let held = 0;
		for (const cell of notebook.cells) if (cell.kind === "code") held += cell.outputs.filter(isHeldBack).length;
		if (!held) return;
		const store = () => this.plugin.settings.trustedNotebooks;
		const banner = this.contentEl.createDiv({ cls: "coder-nb-banner", attr: { dir: isArabic() ? "rtl" : "ltr" } });
		const text = banner.createDiv({ cls: "coder-nb-banner-text" });
		const save = async (next: Record<string, string>) => {
			this.plugin.settings.trustedNotebooks = next;
			await this.plugin.saveSettings();
			this.plugin.refreshNotebooks();
		};
		const button = banner.createEl("button", { attr: { type: "button" } });
		if (this.trusted) {
			text.createDiv({ text: t("You trust this notebook. Its HTML and scripts show in a sandbox, cut off from your vault and from Obsidian.") });
			button.setText(t("Revoke trust"));
			button.addEventListener("click", () => void save(revokeNotebook(store(), file.path)));
			return;
		}
		if (file.path in store()) text.createDiv({ text: t("This notebook changed after you trusted it, so its HTML and scripts are blocked again.") });
		text.createDiv({ text: t("Outputs blocked for having HTML or scripts: {n}. Text and images show.", { n: held }) });
		text.createDiv({ cls: "coder-nb-banner-more", text: t("Trusting shows them in a sandbox, cut off from your vault and from Obsidian. They can still reach the internet. Your code doesn't run.") });
		button.setText(t("Trust this notebook"));
		button.addClass("mod-cta");
		button.addEventListener("click", () => void save(trustNotebook(store(), file.path, this.hash)));
	}

	private drawCell(slot: CellSlot): void {
		const drawn = new Component();
		drawn.load();
		slot.drawn = drawn;
		const { cell, el } = slot;
		switch (cell.kind) {
			case "code":
				this.drawCode(cell, el, drawn);
				break;
			case "markdown":
				void this.drawMarkdown(cell.source, el.createDiv({ cls: "coder-nb-md markdown-rendered", attr: { dir: "auto" } }), cell.attachments, drawn);
				break;
			case "raw":
				el.createEl("pre", { cls: "coder-nb-raw", text: cell.source, attr: { dir: "auto" } });
				break;
			default:
				note(el, t("This cell's type isn't supported."));
				if (cell.source) el.createEl("pre", { cls: "coder-nb-raw", text: cell.source, attr: { dir: "auto" } });
		}
	}

	private drawCode(cell: Extract<NotebookCell, { kind: "code" }>, el: HTMLElement, drawn: Component): void {
		const head = el.createDiv({ cls: "coder-nb-cell-head", attr: { dir: "ltr" } });
		head.createSpan({ cls: "coder-nb-count", text: cell.executionCount === null ? "[ ]" : `[${cell.executionCount}]` });
		const copy = head.createEl("button", { cls: "coder-icon-btn clickable-icon", attr: { type: "button", "aria-label": t("Copy code") } });
		setIcon(copy, "copy");
		copy.addEventListener("click", () => void navigator.clipboard.writeText(cell.source).then(() => new Notice(t("Code copied"))));
		this.mountCode(el.createDiv({ cls: "coder-nb-code", attr: { dir: "ltr" } }), cell.source, this.notebook?.language ?? "py", drawn);
		if (!cell.outputs.length) return;
		const outputs = el.createDiv({ cls: "coder-nb-outputs" });
		const trusted = this.trusted;
		for (const output of cell.outputs) {
			for (const part of planOutput(output, trusted)) {
				switch (part.kind) {
					case "text":
						outputs.createEl("pre", { cls: `coder-nb-text is-${part.tone}`, text: part.text });
						if (part.dropped) note(outputs, t("… {n} more characters not shown.", { n: part.dropped.toLocaleString() }));
						break;
					case "image":
						outputs.createEl("img", { cls: "coder-nb-image", attr: { src: part.src, alt: t("Output image"), decoding: "async" } });
						break;
					case "markdown":
						void this.drawMarkdown(part.source, outputs.createDiv({ cls: "coder-nb-md markdown-rendered", attr: { dir: "auto" } }), {}, drawn);
						break;
					case "frame":
						this.mountFrame(outputs, part.html, drawn);
						break;
					case "blocked":
						note(outputs, t("HTML or a script is blocked in this output.")).addClass("is-blocked");
						break;
					case "unshown":
						note(outputs, part.mime ? t("This output can't be shown ({type}).", { type: part.mime }) : t("This output's type isn't supported."));
				}
			}
		}
	}

	/** Read-only CodeMirror with the same colours as the code editor. */
	private mountCode(host: HTMLElement, code: string, extension: string, drawn: Component): void {
		const language = new Compartment();
		const settings = this.plugin.settings;
		const view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: code,
				extensions: [
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					EditorState.tabSize.of(settings.editorTabSize),
					settings.editorWrap ? EditorView.lineWrapping : [],
					language.of([]),
					themeHighlighting,
					editorTheme,
				],
			}),
		});
		let live = true;
		drawn.register(() => {
			live = false;
			view.destroy();
		});
		void languageFor(extension, settings.editorTabSize).then((ext) => {
			if (live) view.dispatch({ effects: language.reconfigure(ext) });
		});
	}

	/** Never Obsidian's markdown renderer, trusted or not: it would run other plugins' processors on this text. */
	private async drawMarkdown(source: string, host: HTMLElement, attachments: Record<string, MimeBundle>, drawn: Component): Promise<void> {
		const plain = (reason: string) => {
			host.empty();
			note(host, reason);
			host.createEl("pre", { cls: "coder-nb-raw", text: source.slice(0, 200_000) });
		};
		if (markdownTooLarge(source)) return plain(t("This markdown is too large to format, so it shows as plain text."));
		try {
			await drawMarkdownTree(host, parseMarkdown(source), {
				code: (code, language) => {
					const box = host.ownerDocument.createElement("div");
					box.className = "coder-nb-code";
					box.setAttribute("dir", "ltr");
					this.mountCode(box, code, languageForFence(language)?.extensions[0] ?? language, drawn);
					return box;
				},
				attachment: (name, alt) => this.attachmentNode(host.ownerDocument, name, alt, attachments),
				cleanMath: sweep,
			});
		} catch {
			plain(t("This markdown is too large to format, so it shows as plain text."));
		}
	}

	private attachmentNode(doc: Document, name: string, alt: string, attachments: Record<string, MimeBundle>): Node {
		const bundle = attachments[name];
		for (const mime of bundle ? Object.keys(bundle) : []) {
			const src = imageSource(mime, bundle[mime]);
			if (!src) continue;
			const img = doc.createElement("img");
			img.className = "coder-nb-image";
			img.alt = alt;
			img.src = src;
			return img;
		}
		return doc.createTextNode(alt || name);
	}

	/** A trusted output, in a frame with no same-origin access: it can't reach the vault, the page or Obsidian's API. */
	private mountFrame(parent: HTMLElement, html: string, drawn: Component): void {
		const wrap = parent.createDiv({ cls: "coder-preview" });
		const frame = wrap.createEl("iframe", { cls: "coder-preview-frame", attr: { sandbox: "allow-scripts", title: t("Notebook output") } });
		const token = Math.random().toString(36).slice(2);
		frame.srcdoc = previewDocument(html, token);
		const win = wrap.ownerDocument.defaultView ?? window;
		const onMessage = (e: MessageEvent) => {
			const d = e.data as { __coder?: string; k?: string; h?: number } | null;
			if (!d || d.__coder !== token || e.source !== frame.contentWindow || d.k !== "h" || typeof d.h !== "number") return;
			const border = wrap.offsetHeight - wrap.clientHeight;
			wrap.setCssProps({ "--coder-preview-height": `${Math.min(600, Math.max(60, Math.round(d.h))) + border}px` });
		};
		win.addEventListener("message", onMessage);
		drawn.register(() => win.removeEventListener("message", onMessage));
	}
}

function note(parent: HTMLElement, text: string): HTMLElement {
	return parent.createDiv({ cls: "coder-nb-note", text, attr: { dir: isArabic() ? "rtl" : "ltr" } });
}

function refusalText(parsed: Extract<ParseResult, { ok: false }>): string {
	switch (parsed.code) {
		case "json":
			return t("It isn't valid JSON: {reason}", { reason: parsed.reason });
		case "version":
			return t("It uses notebook format {version}. Brief Coder reads format 4.", { version: parsed.version });
		default:
			return t("It's JSON, but not a Jupyter notebook.");
	}
}

/** The last look at what MathJax made: only inert elements and plain web links stay. */
function sweep(host: HTMLElement): void {
	host.querySelectorAll(STRIPPED).forEach((el) => el.remove());
	host.querySelectorAll("*").forEach((el) => {
		for (const name of el.getAttributeNames()) {
			// MathJax lays out its own output with style attributes.
			if (/^on|^srcset$|^srcdoc$|^formaction$/i.test(name) || (name === "style" && !el.closest("mjx-container"))) el.removeAttribute(name);
		}
		if (el.tagName === "A" && !SAFE_LINK.test(el.getAttribute("href") ?? "")) el.removeAttribute("href");
		if (el.tagName === "IMG" && !/^data:image\//i.test(el.getAttribute("src") ?? "")) el.remove();
	});
}

function estimateHeight(cell: NotebookCell): number {
	const lines = (s: string) => Math.min(400, s.split("\n").length);
	let px = 16 + lines(cell.source) * LINE_PX;
	if (cell.kind === "code") {
		px += 28;
		for (const o of cell.outputs) px += o.kind === "stream" ? lines(o.text) * LINE_PX : o.kind === "error" ? lines(o.traceback) * LINE_PX : o.kind === "data" && Object.keys(o.data).some((m) => m.startsWith("image/")) ? 300 : 60;
	}
	return px;
}
