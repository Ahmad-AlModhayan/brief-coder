import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type CoderPlugin from "../main";
import { Changeset, acceptChangeset, agentName, hunks, lineDiff, rejectChangeset, revertChangeset } from "../agent/changes";
import { t } from "../i18n";

export const VIEW_TYPE_AGENT = "brief-coder-agent-changes";

/** Words shown for statuses, kinds and outcomes (the stored values are codes). */
function label(code: string, error?: string): string {
	switch (code) {
		case "held": return t("Held");
		case "accepted": return t("Accepted");
		case "partly_accepted": return t("Partly accepted");
		case "rejected": return t("Rejected");
		case "reverted": return t("Reverted");
		case "partly_reverted": return t("Partly reverted");
		case "added": return t("Added");
		case "changed": return t("Changed");
		case "deleted": return t("Deleted");
		case "applied": return t("Applied");
		case "conflict": return t("Skipped: the file changed after the proposal");
		case "skipped_changed": return t("Skipped: you edited it after accepting");
		default: return error?.startsWith("outside") ? t("Not allowed: outside the folders agents may change") : t("Failed");
	}
}

/** Lists the changesets agents proposed through the bridge, with Accept / Reject / Revert and a diff. */
export class AgentChangesView extends ItemView {
	/** Changesets whose diff is shown. (Not "open": that would replace View.open().) */
	private expanded = new Set<string>();
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
		top.createSpan({ cls: "coder-agent-status", text: label(c.status) });
		top.createSpan({ cls: "coder-agent-time", text: new Date(c.createdAt).toLocaleString(), attr: { dir: "auto" } });
		if (c.label) card.createDiv({ cls: "coder-agent-label", text: c.label, attr: { dir: "auto" } });
		const files = card.createEl("ul", { cls: "coder-agent-files" });
		for (const e of c.entries) {
			const li = files.createEl("li");
			li.createSpan({ cls: `coder-agent-kind is-${e.kind}`, text: label(e.kind) });
			li.createSpan({ cls: "coder-agent-path", text: e.path, attr: { dir: "auto" } });
			if (e.outcome) li.createSpan({ cls: "coder-agent-outcome", text: label(e.outcome, e.error) });
		}
		const actions = card.createDiv({ cls: "coder-agent-actions" });
		const shown = this.expanded.has(c.id);
		this.button(actions, shown ? "chevron-up" : "chevron-down", shown ? t("Hide changes") : t("Show changes"), () => {
			if (shown) this.expanded.delete(c.id);
			else this.expanded.add(c.id);
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
				// The +/- marker stays at the start; only the line's text takes its own direction.
				const row = pre.createDiv({ cls: op === "+" ? "coder-diff-add" : op === "-" ? "coder-diff-del" : "coder-diff-ctx" });
				row.createSpan({ cls: "coder-diff-op", text: op });
				row.createSpan({ cls: "coder-diff-text", text, attr: { dir: "auto" } });
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
				const allowed = (p: string) => this.plugin.agentMayChange(p);
				const r = what === "accept" ? await acceptChangeset(c, io, allowed) : await revertChangeset(c, io, allowed);
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
