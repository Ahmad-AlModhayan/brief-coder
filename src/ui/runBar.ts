import { Notice, setIcon } from "obsidian";
import type { RunSession } from "../run/session";
import { OutputView } from "./outputView";

export interface RunBarOptions {
	/** Display name of the language ("Python"), or the raw fence name for copy-only blocks. */
	label: string;
	title?: string;
	runnable: boolean;
	getCode: () => string;
	session: RunSession;
	onRun: () => void;
	onStop: () => void;
	onClear: () => void;
	/** Called once when the pointer first reaches Run, to prepare the runner early. */
	onWarm?: () => void;
}

/**
 * The bar under a code block: language, Copy, Run/Stop — and the output panel below it.
 * Returns a cleanup function that detaches all listeners.
 */
export function mountRunBar(host: HTMLElement, o: RunBarOptions): () => void {
	host.addClass("coder-block");
	const bar = host.createDiv({ cls: "coder-bar" });
	const meta = bar.createDiv({ cls: "coder-bar-meta" });
	meta.createSpan({ cls: "coder-lang", text: o.label });
	if (o.title) meta.createSpan({ cls: "coder-title", text: o.title });
	const actions = bar.createDiv({ cls: "coder-bar-actions" });

	const copyBtn = actions.createEl("button", { cls: "coder-btn", attr: { type: "button", "aria-label": "Copy code" } });
	const copyIcon = copyBtn.createSpan({ cls: "coder-btn-icon" });
	setIcon(copyIcon, "copy");
	copyBtn.createSpan({ cls: "coder-btn-label", text: "Copy" });
	let copyTimer = 0;
	copyBtn.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		navigator.clipboard.writeText(o.getCode()).then(
			() => {
				setIcon(copyIcon, "check");
				copyBtn.addClass("is-done");
				window.clearTimeout(copyTimer);
				copyTimer = window.setTimeout(() => {
					setIcon(copyIcon, "copy");
					copyBtn.removeClass("is-done");
				}, 1200);
			},
			() => new Notice("Couldn't copy to the clipboard."),
		);
	});

	let runBtn: HTMLButtonElement | null = null;
	let runIcon: HTMLElement | null = null;
	let runLabel: HTMLElement | null = null;
	if (o.runnable) {
		runBtn = actions.createEl("button", { cls: "coder-btn coder-run", attr: { type: "button" } });
		runIcon = runBtn.createSpan({ cls: "coder-btn-icon" });
		runLabel = runBtn.createSpan({ cls: "coder-btn-label" });
		runBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (o.session.running) o.onStop();
			else o.onRun();
		});
		if (o.onWarm) runBtn.addEventListener("pointerenter", o.onWarm, { once: true });
	}

	const output = new OutputView(host, o.session, { onClear: o.onClear });

	let lastRunning: boolean | null = null;
	const sync = () => {
		if (!runBtn || !runIcon || !runLabel) return;
		const running = o.session.running;
		if (running === lastRunning) return;
		lastRunning = running;
		runBtn.toggleClass("is-running", running);
		runBtn.setAttr("aria-label", running ? "Stop" : "Run code");
		setIcon(runIcon, running ? "square" : "play");
		runLabel.setText(running ? "Stop" : "Run");
	};
	const unsubscribe = o.session.subscribe(sync);
	sync();

	return () => {
		unsubscribe();
		window.clearTimeout(copyTimer);
		output.destroy();
		bar.remove();
		host.removeClass("coder-block");
	};
}
