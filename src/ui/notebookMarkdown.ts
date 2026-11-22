import { finishRenderMath, loadMathJax, renderMath } from "obsidian";
import { Block, Inline, ListItem, safeTex } from "../notebook/markdown";

export interface MarkdownHooks {
	/** Draws a code block, in the same read-only editor as code cells. */
	code(code: string, language: string): HTMLElement;
	/** The cell's own image, or its text if the attachment isn't a valid image. */
	attachment(name: string, alt: string): Node;
	/** Last look at what MathJax produced. */
	cleanMath(el: HTMLElement): void;
}

/**
 * Draws the tree from parseMarkdown. Elements come only from this file and text goes in as text, so no
 * markup in a notebook can become an element. Obsidian's markdown renderer isn't involved, so no other
 * plugin's processor ever sees the result.
 */
export async function drawMarkdownTree(host: HTMLElement, blocks: Block[], hooks: MarkdownHooks): Promise<void> {
	const math: { el: HTMLElement; tex: string; display: boolean }[] = [];
	const doc = host.ownerDocument;
	const el = (tag: string, parent: Node, auto = false) => {
		const e = doc.createElement(tag);
		if (auto) e.setAttribute("dir", "auto");
		parent.appendChild(e);
		return e;
	};
	const mathEl = (parent: Node, tex: string, display: boolean, block: boolean) => {
		// The source shows until MathJax has loaded, and stays if it can't.
		const e = el(block ? "div" : "span", parent);
		e.className = `math ${display ? "math-block" : "math-inline"}`;
		e.setAttribute("dir", "ltr");
		e.textContent = tex;
		math.push({ el: e, tex, display });
	};
	const inlines = (parent: Node, nodes: Inline[]) => {
		for (const node of nodes) {
			switch (node.k) {
				case "text":
					parent.appendChild(doc.createTextNode(node.text));
					break;
				case "code": {
					const code = el("code", parent);
					code.setAttribute("dir", "ltr");
					code.textContent = node.text;
					break;
				}
				case "math":
					mathEl(parent, node.tex, node.display, false);
					break;
				case "wrap":
					inlines(el(node.tag, parent), node.children);
					break;
				case "link": {
					const a = el("a", parent);
					a.className = "external-link";
					a.setAttribute("href", node.href);
					a.setAttribute("rel", "noopener nofollow");
					inlines(a, node.children);
					break;
				}
				case "attachment":
					parent.appendChild(hooks.attachment(node.name, node.alt));
					break;
				case "break":
					el("br", parent);
			}
		}
	};
	const item = (list: HTMLElement, data: ListItem, tight: boolean) => {
		const li = el("li", list, true);
		if (data.task !== null) {
			li.className = data.task ? "task-list-item is-checked" : "task-list-item";
			const box = el("input", li) as HTMLInputElement;
			box.type = "checkbox";
			box.className = "task-list-item-checkbox";
			box.disabled = true;
			box.checked = data.task;
		}
		data.blocks.forEach((block, n) => {
			// A task's text stays on the checkbox's line, even in a list with space between items.
			if (block.k === "paragraph" && (tight || (n === 0 && data.task !== null))) inlines(li, block.content);
			else draw(li, block);
		});
	};
	const draw = (parent: HTMLElement, block: Block) => {
		switch (block.k) {
			case "heading":
				inlines(el(`h${block.level}`, parent, true), block.content);
				break;
			case "paragraph":
				inlines(el("p", parent, true), block.content);
				break;
			case "code":
				parent.appendChild(hooks.code(block.code, block.language));
				break;
			case "math":
				mathEl(parent, block.tex, true, true);
				break;
			case "quote": {
				const quote = el("blockquote", parent, true);
				for (const b of block.blocks) draw(quote, b);
				break;
			}
			case "list": {
				const list = el(block.ordered ? "ol" : "ul", parent, true);
				if (block.ordered && block.start !== 1) list.setAttribute("start", String(block.start));
				for (const data of block.items) item(list, data, block.tight);
				break;
			}
			case "table": {
				const table = el("table", parent);
				const row = (section: HTMLElement, cells: Inline[][], tag: string) => {
					const tr = el("tr", section);
					cells.forEach((cell, n) => {
						const td = el(tag, tr, true);
						if (block.align[n]) td.style.textAlign = block.align[n] as string;
						inlines(td, cell);
					});
				};
				row(el("thead", table), block.head, "th");
				if (block.rows.length) {
					const body = el("tbody", table);
					for (const cells of block.rows) row(body, cells, "td");
				}
				break;
			}
			case "rule":
				el("hr", parent);
		}
	};
	for (const block of blocks) draw(host, block);
	if (!math.length) return;
	await loadMathJax();
	for (const m of math) {
		if (!m.el.isConnected) continue;
		try {
			m.el.replaceChildren(renderMath(safeTex(m.tex), m.display));
			m.el.addClass("is-loaded");
			hooks.cleanMath(m.el);
		} catch {
			// The source is still showing.
		}
	}
	await finishRenderMath();
}
