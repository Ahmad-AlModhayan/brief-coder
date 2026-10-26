import { setIcon } from "obsidian";
import { t } from "../i18n";
import { DrawState, drawIncrementally } from "../run/output";
import { PagedText } from "./pagedText";
import type { RunSession } from "../run/session";
import { previewDocument } from "../run/inapp";
import { formatDuration } from "../util/text";

interface Parts {
	el: HTMLElement;
	statusEl: HTMLElement;
	bodyEl: HTMLElement;
	noticeEl: HTMLElement;
	preEl: HTMLElement;
	stdinRow: HTMLElement;
}

/**
 * Renders a RunSession: status line, streamed output (incremental, capped), stdin box while
 * running, and a sandboxed preview for HTML. Shared by code blocks and the code file view.
 *
 * Cheap by design: nothing is built until the block has output (a note with 50 code blocks adds
 * no hidden panels), and layout is never read while rendering, so many blocks can't cause reflows.
 */
export class OutputView {
	private parts: Parts | null = null;
	private previewWrap: HTMLElement | null = null;
	private previewHtml: string | null = null;
	/** Waits for a preview's panel to come on screen before loading the page. */
	private previewObserver: IntersectionObserver | null = null;
	private messageHandler: ((e: MessageEvent) => void) | null = null;
	private messageWin: Window | null = null;
	private unsubscribe: () => void;
	private ticker = 0;
	private drawState = new DrawState();
	private text: PagedText | null = null;
	/** Adaptive throttle: a costly redraw (huge output) postpones the next one, so floods can't hog Obsidian. */
	private nextDrawAt = 0;
	private drawTimer = 0;
	private lastStatus = "";
	/** Follow new output unless the user scrolled up to read. Updated only on scroll. */
	private stickToBottom = true;

	constructor(private parent: HTMLElement, private session: RunSession, private hooks: { onClear: () => void }) {
		this.unsubscribe = session.subscribe(() => this.update());
		this.update();
	}

	destroy(): void {
		this.unsubscribe();
		this.stopTicker();
		window.clearTimeout(this.drawTimer);
		this.drawTimer = 0;
		this.removePreview();
		this.parts?.el.remove();
		this.parts = null;
	}

	private build(): Parts {
		const el = this.parent.createDiv({ cls: "coder-output" });
		const header = el.createDiv({ cls: "coder-output-header" });
		const statusEl = header.createDiv({ cls: "coder-output-status", attr: { role: "status", "aria-live": "polite" } });
		const actionsEl = header.createDiv({ cls: "coder-output-actions" });
		this.iconButton(actionsEl, "copy", t("Copy output"), () => void navigator.clipboard.writeText(this.session.buffer.toString()));
		this.iconButton(actionsEl, "x", t("Clear output"), () => this.hooks.onClear());
		const bodyEl = el.createDiv({ cls: "coder-output-body" });
		bodyEl.addEventListener(
			"scroll",
			() => (this.stickToBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 24),
			{ passive: true },
		);
		const noticeEl = bodyEl.createDiv({ cls: "coder-output-trimmed is-hidden" });
		const preEl = bodyEl.createEl("pre", { cls: "coder-output-text" });
		const stdinRow = el.createDiv({ cls: "coder-stdin is-hidden" });
		const stdinInput = stdinRow.createEl("input", {
			cls: "coder-stdin-input",
			attr: { type: "text", placeholder: t("Type input for the program, then press Enter"), "aria-label": t("Input for the program"), spellcheck: "false", dir: "auto" },
		});
		stdinInput.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			const text = stdinInput.value;
			stdinInput.value = "";
			this.session.write("info", text + "\n");
			this.session.handle?.writeStdin?.(text + "\n");
		});
		return { el, statusEl, bodyEl, noticeEl, preEl, stdinRow };
	}

	private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
		const b = parent.createEl("button", { cls: "coder-icon-btn clickable-icon", attr: { "aria-label": label, type: "button" } });
		setIcon(b, icon);
		b.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			onClick();
		});
	}

	update(): void {
		const s = this.session;
		if (!this.parts) {
			if (!s.hasContent) return; // never ran: no DOM at all
			this.parts = this.build();
		}
		const p = this.parts;
		p.el.toggleClass("is-hidden", !s.hasContent);
		p.el.toggleClass("is-running", s.running);
		p.el.toggleClass("is-failed", s.status === "failed");
		this.renderStatus(p);
		if (s.running) this.startTicker();
		else this.stopTicker();
		p.stdinRow.toggleClass("is-hidden", !(s.running && !!s.handle?.writeStdin));
		this.renderOutput(p);
		this.renderPreview(p);
	}

	private renderStatus(p: Parts): void {
		const s = this.session;
		let text: string;
		let cls: string;
		switch (s.status) {
			case "running":
				text = t("Running {name}… {time}", { name: s.label, time: formatDuration(Date.now() - s.startedAt) });
				cls = "running";
				break;
			case "done":
				text = s.html !== null ? t("{name} preview", { name: s.label }) : t("Finished · {time}", { time: formatDuration(s.durationMs) });
				cls = "done";
				break;
			case "stopped":
				text = t("Stopped · {time}", { time: formatDuration(s.durationMs) });
				cls = "stopped";
				break;
			case "failed":
				text =
					s.exit?.error && s.exit.code === null
						? t("Couldn't run")
						: t("Exit code {code} · {time}", { code: String(s.exit?.code ?? s.exit?.signal ?? "?"), time: formatDuration(s.durationMs) });
				cls = "failed";
				break;
			default:
				text = "";
				cls = "idle";
		}
		const key = `${cls}|${text}`;
		if (key === this.lastStatus) return;
		this.lastStatus = key;
		p.statusEl.empty();
		p.statusEl.createSpan({ cls: `coder-dot is-${cls}`, attr: { "aria-hidden": "true" } });
		p.statusEl.createSpan({ text });
		if (s.command) p.statusEl.setAttr("aria-label", s.command);
	}

	/** Draws only what changed since the last frame (see drawIncrementally and PagedText). */
	private renderOutput(p: Parts): void {
		const now = performance.now();
		if (this.session.running && now < this.nextDrawAt) {
			if (!this.drawTimer) {
				this.drawTimer = window.setTimeout(() => {
					this.drawTimer = 0;
					if (this.parts) this.renderOutput(this.parts);
				}, this.nextDrawAt - now);
			}
			return;
		}
		const buf = this.session.buffer;
		this.text ??= new PagedText(p.preEl);
		const changed = drawIncrementally(buf, this.drawState, this.text);
		if (!changed) return;
		p.noticeEl.setText(buf.trimmed ? t("… {n} earlier characters dropped (output limit in settings)", { n: buf.trimmed.toLocaleString() }) : "");
		p.noticeEl.toggleClass("is-hidden", !buf.trimmed);
		p.preEl.toggleClass("is-hidden", buf.size === 0);
		if (buf.size === 0) this.stickToBottom = true;
		else if (this.stickToBottom) p.bodyEl.scrollTop = p.bodyEl.scrollHeight;
		const cost = performance.now() - now;
		this.nextDrawAt = cost > 8 ? performance.now() + Math.min(500, cost * 4) : 0;
	}

	private renderPreview(p: Parts): void {
		const html = this.session.html;
		if (html === this.previewHtml) return;
		this.removePreview();
		this.previewHtml = html;
		if (html === null) return;
		const wrap = (this.previewWrap = p.el.createDiv({ cls: "coder-preview" }));
		// The page loads once its panel is on screen. A note's Reading view and its hidden editor both
		// show this output; without this, the page would load (and log) twice.
		const win = wrap.ownerDocument.defaultView ?? window;
		const observer = (this.previewObserver = new win.IntersectionObserver((entries) => {
			if (!entries.some((e) => e.isIntersecting) || this.previewWrap !== wrap) return;
			observer.disconnect();
			this.previewObserver = null;
			this.loadPreview(wrap, html);
		}));
		observer.observe(wrap);
	}

	private loadPreview(wrap: HTMLElement, html: string): void {
		const token = Math.random().toString(36).slice(2);
		const frame = wrap.createEl("iframe", {
			cls: "coder-preview-frame",
			attr: { sandbox: "allow-scripts allow-forms allow-modals", title: t("HTML preview"), loading: "lazy" },
		});
		frame.srcdoc = previewDocument(html, token);
		// The preview grows to fit the page (60–600 px) until the user drags its edge.
		let autoHeight = true;
		wrap.addEventListener("pointerdown", (e) => {
			if (e.clientY > wrap.getBoundingClientRect().bottom - 18) autoHeight = false;
		});
		this.messageHandler = (e: MessageEvent) => {
			const d = e.data as { __coder?: string; k?: string; b?: Array<[string, string]>; h?: number } | null;
			if (!d || d.__coder !== token || e.source !== frame.contentWindow) return;
			if (d.k === "h") {
				if (autoHeight && typeof d.h === "number") {
					const border = wrap.offsetHeight - wrap.clientHeight;
					wrap.style.height = `${Math.min(600, Math.max(60, Math.round(d.h))) + border}px`;
				}
			} else if (d.k === "b" && Array.isArray(d.b)) {
				// Console output arrives in batches (see htmlBridgeScript).
				for (const [kind, text] of d.b) this.session.write(kind === "err" ? "err" : "out", String(text));
			}
		};
		// The frame's parent is the window this panel lives in (a popout window, possibly).
		this.messageWin = wrap.ownerDocument.defaultView ?? window;
		this.messageWin.addEventListener("message", this.messageHandler);
	}

	private removePreview(): void {
		this.previewObserver?.disconnect();
		this.previewObserver = null;
		if (this.messageHandler) this.messageWin?.removeEventListener("message", this.messageHandler);
		this.messageHandler = null;
		this.messageWin = null;
		this.previewWrap?.remove();
		this.previewWrap = null;
		this.previewHtml = null;
	}

	private startTicker(): void {
		if (this.ticker || !this.parts) return;
		const p = this.parts;
		this.ticker = window.setInterval(() => this.renderStatus(p), 250);
	}

	private stopTicker(): void {
		if (!this.ticker) return;
		window.clearInterval(this.ticker);
		this.ticker = 0;
	}
}
