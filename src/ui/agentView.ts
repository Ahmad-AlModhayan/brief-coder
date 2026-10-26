import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type CoderPlugin from "../main";
import { Changeset, acceptChangeset, agentName, hunks, lineDiff, rejectChangeset, revertChangeset } from "../agent/changes";
import { t } from "../i18n";

export const VIEW_TYPE_AGENT = "brief-coder-agent-changes";

/** Lists the changesets agents proposed through the bridge, with Accept / Reject / Revert and a diff. */
export class AgentChangesView extends ItemView {
	private open = new Set<string>();
	private busy = false;

	constructor(leaf: WorkspaceLeaf, private plugin: CoderPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_AGENT;
	}

	getDisplayText(): string {
		return t("Agent changes");
	}

	getIcon(): string {
		return "bot";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("coder-agent-view");
		await this.refresh();
	}

	async refresh(): Promise<void> {
		const list = await this.plugin.loadChangesets();
		const el = this.contentEl;
		el.empty();
		const head = el.createDiv({ cls: "coder-agent-head" });
		head.createEl("h4", { text: t("Agent changes") });
		this.button(head, "refresh-cw", t("Refresh"), () => void this.refresh(), "clickable-icon");
		if (!list.length) {
			el.createDiv({ cls: "coder-agent-empty", text: t("No agent changes yet.") });
			return;
		}
		for (const c of list) this.renderChangeset(el, c);
	}

	private renderChangeset(parent: HTMLElement, c: Changeset): void {
		const card = parent.createDiv({ cls: `coder-agent-card is-${c.status}` });
		const top = card.createDiv({ cls: "coder-agent-top" });
		top.createSpan({ cls: "coder-agent-actor", text: agentName(c.actor) });
		top.createSpan({ cls: "coder-agent-status", text: t(c.status) });
		top.createSpan({ cls: "coder-agent-time", text: new Date(c.createdAt).toLocaleString() });
		if (c.label) card.createDiv({ cls: "coder-agent-label", text: c.label, attr: { dir: "auto" } });
		const files = card.createEl("ul", { cls: "coder-agent-files" });
		for (const e of c.entries) {
			const li = files.createEl("li");
			li.createSpan({ cls: `coder-agent-kind is-${e.kind}`, text: t(e.kind) });
			li.createSpan({ cls: "coder-agent-path", text: e.path, attr: { dir: "auto" } });
			if (e.outcome) li.createSpan({ cls: "coder-agent-outcome", text: t(e.outcome) });
		}
		const actions = card.createDiv({ cls: "coder-agent-actions" });
		const shown = this.open.has(c.id);
		this.button(actions, shown ? "chevron-up" : "chevron-down", shown ? t("Hide changes") : t("Show changes"), () => {
			if (shown) this.open.delete(c.id);
			else this.open.add(c.id);
			void this.refresh();
		});
		if (c.status === "held") {
			this.button(actions, "x", t("Reject"), () => void this.decide(c, "reject"));
			this.button(actions, "check", t("Accept"), () => void this.decide(c, "accept"), "mod-cta");
		} else if (c.status === "accepted" || c.status === "partly_accepted") {
			this.button(actions, "undo-2", t("Revert"), () => void this.decide(c, "revert"));
		}
		if (shown) this.renderDiff(card, c);
	}

	private renderDiff(card: HTMLElement, c: Changeset): void {
		for (const e of c.entries) {
			const box = card.createDiv({ cls: "coder-agent-diff" });
			box.createDiv({ cls: "coder-agent-diff-path", text: e.path, attr: { dir: "auto" } });
			const pre = box.createEl("pre");
			for (const line of hunks(lineDiff(e.before, e.after))) {
				if (!line) {
					pre.createDiv({ cls: "coder-diff-gap", text: "⋯" });
					continue;
				}
				const [op, text] = line;
				pre.createDiv({ cls: op === "+" ? "coder-diff-add" : op === "-" ? "coder-diff-del" : "coder-diff-ctx", text: `${op} ${text}`, attr: { dir: "auto" } });
			}
		}
	}

	private button(parent: HTMLElement, icon: string, label: string, onClick: () => void, cls = ""): void {
		const b = parent.createEl("button", { cls: `coder-agent-btn ${cls}`, attr: { type: "button", "aria-label": label } });
		setIcon(b.createSpan(), icon);
		if (!cls.includes("clickable-icon")) b.createSpan({ text: label });
		b.addEventListener("click", onClick);
	}

	private async decide(c: Changeset, what: "accept" | "reject" | "revert"): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			const io = this.plugin.vaultIO();
			if (what === "reject") rejectChangeset(c);
			else {
				const r = what === "accept" ? await acceptChangeset(c, io) : await revertChangeset(c, io);
				const n = r.ok + r.skipped;
				if (r.skipped)
					new Notice(
						what === "accept"
							? t("Accepted {ok} of {n}. {skipped} skipped: the file changed after the proposal.", { ...r, n })
							: t("Reverted {ok} of {n}. {skipped} skipped: you changed them after accepting.", { ...r, n }),
					);
			}
			await this.plugin.saveChangeset(c);
		} finally {
			this.busy = false;
			await this.refresh();
		}
	}
}
