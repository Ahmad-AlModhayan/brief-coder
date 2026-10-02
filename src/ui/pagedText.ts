import type { ChunkSink, StreamKind } from "../run/output";

/** Characters per page. A new page only starts right after a newline, so lines are never split. */
export const PAGE_CHARS = 4096;

interface Page {
	el: HTMLElement;
	len: number;
}

interface Segment {
	chunk: number;
	node: Text;
	span: HTMLElement;
	page: Page;
}

/**
 * Draws output as a stack of small block "pages" (CSS: `content-visibility: auto`). Adding a
 * line only lays out the last page and pages scrolled out of view cost nothing, so even 5 MB of
 * output stays cheap; one big text block would be laid out again on every update.
 *
 * Uses only standard DOM calls, so it is unit-tested with a tiny fake DOM.
 */
export class PagedText implements ChunkSink {
	private pages: Page[] = [];
	private segments: Segment[] = [];
	private kinds: StreamKind[] = [];
	private lengths: number[] = [];

	constructor(private root: HTMLElement) {}

	reset(): void {
		while (this.root.firstChild) this.root.removeChild(this.root.firstChild);
		this.pages = [];
		this.segments = [];
		this.kinds = [];
		this.lengths = [];
	}

	add(kind: StreamKind, text: string): void {
		this.kinds.push(kind);
		this.lengths.push(0);
		this.write(this.kinds.length - 1, text);
	}

	append(index: number, text: string): void {
		this.write(index, text);
	}

	dropFrom(index: number): void {
		while (this.segments.length && this.segments[this.segments.length - 1].chunk >= index) this.popSegment();
		this.kinds.length = Math.min(this.kinds.length, index);
		this.lengths.length = Math.min(this.lengths.length, index);
	}

	truncate(index: number, length: number): void {
		let remove = this.lengths[index] - length;
		while (remove > 0) {
			const seg = this.segments[this.segments.length - 1];
			if (!seg || seg.chunk !== index) break;
			const len = seg.node.length;
			if (len <= remove) {
				this.popSegment();
				remove -= len;
			} else {
				seg.node.deleteData(len - remove, remove);
				seg.page.len -= remove;
				remove = 0;
			}
		}
		this.lengths[index] = length;
	}

	/** Total characters drawn (for tests). */
	get size(): number {
		return this.lengths.reduce((a, b) => a + b, 0);
	}

	private write(chunk: number, text: string): void {
		let rest = text;
		while (rest) {
			const page = this.pageForWrite();
			const room = PAGE_CHARS - page.len;
			let cut = rest.length;
			if (rest.length > room) {
				// Fill the page up to its last whole line; a single long line stays on one page.
				const nl = room > 0 ? rest.lastIndexOf("\n", room - 1) : -1;
				if (nl >= 0) cut = nl + 1;
				else if (page.len > 0 && this.endsWithNewline()) {
					this.newPage(); // the next line doesn't fit: it starts the next page
					continue;
				} else {
					const next = rest.indexOf("\n");
					cut = next >= 0 ? next + 1 : rest.length;
				}
			}
			const piece = rest.slice(0, cut);
			rest = rest.slice(cut);
			const last = this.segments[this.segments.length - 1];
			if (last && last.chunk === chunk && last.page === page) {
				last.node.appendData(piece);
			} else {
				const doc = this.root.ownerDocument;
				const span = doc.createElement("span");
				span.className = `coder-stream-${this.kinds[chunk]}`;
				const node = doc.createTextNode(piece);
				span.appendChild(node);
				page.el.appendChild(span);
				this.segments.push({ chunk, node, span, page });
			}
			page.len += piece.length;
			this.lengths[chunk] += piece.length;
		}
	}

	private pageForWrite(): Page {
		const last = this.pages[this.pages.length - 1];
		if (last && (last.len < PAGE_CHARS || !this.endsWithNewline())) return last;
		return this.newPage();
	}

	private newPage(): Page {
		const el = this.root.ownerDocument.createElement("div");
		el.className = "coder-page";
		this.root.appendChild(el);
		const page = { el, len: 0 };
		this.pages.push(page);
		return page;
	}

	private endsWithNewline(): boolean {
		const seg = this.segments[this.segments.length - 1];
		return !!seg && seg.node.length > 0 && seg.node.substringData(seg.node.length - 1, 1) === "\n";
	}

	private popSegment(): void {
		const seg = this.segments.pop();
		if (!seg) return;
		seg.span.remove();
		seg.page.len -= seg.node.length;
		this.lengths[seg.chunk] -= seg.node.length;
		const page = this.pages[this.pages.length - 1];
		if (page && !page.el.firstChild) {
			page.el.remove();
			this.pages.pop();
		}
	}
}
