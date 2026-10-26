import { MarkdownPostProcessorContext, MarkdownRenderChild, Notice } from "obsidian";
import { t } from "../i18n";
import type CoderPlugin from "../main";
import { isDecoratedFence } from "../languages";
import { FencedBlock, blockKeys, findFencedBlocks, hashString } from "../util/fence";

interface KeyedBlock extends FencedBlock {
	key: string;
}

/**
 * Every rendered section hands over the whole note, so the note is parsed once per version of
 * its text (not once per code block): 400 blocks would otherwise mean 400 full parses.
 */
let parsed: { path: string; text: string; blocks: KeyedBlock[] } | null = null;
function parseNote(path: string, text: string): KeyedBlock[] {
	if (parsed && parsed.path === path && parsed.text === text) return parsed.blocks;
	const blocks = findFencedBlocks(text.split("\n"));
	const keys = blockKeys(path, blocks);
	parsed = { path, text, blocks: blocks.map((b, i) => ({ ...b, key: keys[i] })) };
	return parsed.blocks;
}

/** Cleans up a code block's bar when Obsidian discards the rendered section. */
class BarChild extends MarkdownRenderChild {
	constructor(el: HTMLElement, private cleanup: () => void) {
		super(el);
	}
	onunload(): void {
		this.cleanup();
	}
}

/** Reading view (and rendered embeds/callouts): add the Coder bar under code blocks. */
export function readingViewProcessor(plugin: CoderPlugin) {
	return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		const s = plugin.settings;
		if (s.inlineCodeCopy) decorateInlineCode(el);
		if (!s.showRunBar) return;
		const pres = Array.from(el.querySelectorAll("pre")).filter((pre) => pre.querySelector(":scope > code"));
		if (!pres.length) return;

		// Map rendered <pre> elements back to their source blocks so keys match Live Preview.
		const section = ctx.getSectionInfo(el);
		let sourceBlocks: KeyedBlock[] = [];
		if (section) {
			sourceBlocks = parseNote(ctx.sourcePath, section.text).filter(
				(b) => b.startLine >= section.lineStart && b.endLine <= section.lineEnd,
			);
		}
		const useSource = sourceBlocks.length === pres.length;

		pres.forEach((pre, i) => {
			const host = pre.parentElement;
			if (!host || host.querySelector(":scope > .coder-reading")) return;
			const code = pre.querySelector(":scope > code") as HTMLElement;
			const domLang = /(?:^|\s)language-(\S+)/.exec(code.className)?.[1] ?? "";
			const src = useSource ? sourceBlocks[i] : null;
			const fence = src ? src.lang : domLang;
			if (!isDecoratedFence(fence)) return;
			const text = src ? src.code : (code.textContent ?? "").replace(/\n$/, "");
			const key = src ? src.key : `${ctx.sourcePath}|${fence.toLowerCase()}|${hashString(text)}|dom`;
			const wrapper = host.createDiv({ cls: "coder-reading" });
			pre.after(wrapper);
			host.addClass("coder-has-bar");
			if (s.hideNativeCopy) host.addClass("coder-hide-copy");
			const unmount = plugin.mountBlock(wrapper, { key, path: ctx.sourcePath, fence, info: src?.info ?? fence, code: text }, () => {
				wrapper.remove();
				host.removeClass("coder-has-bar", "coder-hide-copy");
			});
			ctx.addChild(new BarChild(wrapper, unmount));
		});
	};
}

function decorateInlineCode(el: HTMLElement): void {
	el.querySelectorAll("code").forEach((c) => {
		if (c.closest("pre") || c.hasClass("coder-inline-copy")) return;
		c.addClass("coder-inline-copy");
		c.setAttr("aria-label", t("Click to copy"));
		c.addEventListener("click", (e) => {
			if ((e as MouseEvent).detail > 1) return; // allow double-click to select
			navigator.clipboard.writeText(c.textContent ?? "").then(
				() => new Notice(t("Copied")),
				() => undefined,
			);
		});
	});
}
