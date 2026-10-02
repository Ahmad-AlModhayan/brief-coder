/**
 * Output model shared by every runner and view.
 * The buffer is capped so a program that prints forever can't slow Obsidian down:
 * it keeps the most recent output and remembers how much was dropped.
 */

export type StreamKind = "out" | "err" | "info";

export interface OutputChunk {
	kind: StreamKind;
	text: string;
}

/** Where the text stopped matching what a view already shows (see `takeDamage`). */
export interface Damage {
	chunk: number;
	offset: number;
}

export class OutputBuffer {
	chunks: OutputChunk[] = [];
	/** Characters currently held. */
	size = 0;
	/** Characters dropped from the start because of the cap. */
	trimmed = 0;
	/** Bumps when earlier output is dropped or cleared; views then redraw from scratch. */
	version = 0;
	private pendingCR: Record<StreamKind, boolean> = { out: false, err: false, info: false };
	/** Earliest position whose text changed (not just grew) since a view last drew it. */
	private damage: Damage | null = null;

	constructor(public maxChars = 200_000) {}

	append(kind: StreamKind, raw: string): void {
		if (!raw) return;
		let text = raw;
		// A "\r" that ended the previous chunk may be the first half of "\r\n".
		if (this.pendingCR[kind]) {
			this.pendingCR[kind] = false;
			if (text.startsWith("\n")) {
				text = text.slice(1);
				this.pushText(kind, "\n");
			} else {
				this.carriageReturn();
			}
		}
		if (text.endsWith("\r")) {
			this.pendingCR[kind] = true;
			text = text.slice(0, -1);
		}
		text = text.replace(/\r\n/g, "\n");
		// Lone "\r" = return to start of line (progress bars): keep only what follows it.
		const parts = text.split("\r");
		for (let i = 0; i < parts.length; i++) {
			if (i > 0) this.carriageReturn();
			if (parts[i]) this.pushText(kind, parts[i]);
		}
		this.enforceCap();
	}

	clear(): void {
		this.chunks = [];
		this.size = 0;
		this.trimmed = 0;
		this.pendingCR = { out: false, err: false, info: false };
		this.damage = null;
		this.version++;
	}

	toString(): string {
		return this.chunks.map((c) => c.text).join("");
	}

	/**
	 * For views: returns (and forgets) the earliest changed position, so only the tail is redrawn.
	 * Text after it, and any growth of the last chunk, is new.
	 */
	takeDamage(): Damage | null {
		const d = this.damage;
		this.damage = null;
		return d;
	}

	private markDamage(chunk: number, offset: number): void {
		const d = this.damage;
		if (!d || chunk < d.chunk || (chunk === d.chunk && offset < d.offset)) this.damage = { chunk, offset };
	}

	private pushText(kind: StreamKind, text: string): void {
		const last = this.chunks[this.chunks.length - 1];
		if (last && last.kind === kind) last.text += text;
		else this.chunks.push({ kind, text });
		this.size += text.length;
	}

	/** Removes everything after the last newline (of any stream): the current terminal line. */
	private carriageReturn(): void {
		for (let i = this.chunks.length - 1; i >= 0; i--) {
			const c = this.chunks[i];
			const nl = c.text.lastIndexOf("\n");
			if (nl >= 0) {
				const keep = nl + 1;
				if (keep < c.text.length) {
					this.size -= c.text.length - keep;
					c.text = c.text.slice(0, keep);
					this.markDamage(i, keep);
				}
				if (this.chunks.length > i + 1) this.markDamage(i + 1, 0);
				this.chunks.length = i + 1;
				return;
			}
			this.size -= c.text.length;
			this.chunks.length = i;
			this.markDamage(i, 0);
		}
	}

	/**
	 * Over the cap, drops the oldest output down to 75% of it. Trimming with that slack means
	 * the (copying) trim happens once per quarter of the cap, not on every line.
	 */
	private enforceCap(): void {
		if (this.size <= this.maxChars) return;
		let excess = this.size - Math.floor(this.maxChars * 0.75);
		while (excess > 0 && this.chunks.length) {
			const first = this.chunks[0];
			if (first.text.length <= excess) {
				excess -= first.text.length;
				this.trimmed += first.text.length;
				this.size -= first.text.length;
				this.chunks.shift();
			} else {
				first.text = first.text.slice(excess);
				this.trimmed += excess;
				this.size -= excess;
				excess = 0;
			}
		}
		this.damage = null;
		this.version++;
	}
}

/** What a view must be able to do to draw an OutputBuffer incrementally. */
export interface ChunkSink {
	/** Remove everything (a full redraw follows). */
	reset(): void;
	/** Remove drawn chunks from `index` on. */
	dropFrom(index: number): void;
	/** Cut drawn chunk `index` back to its first `length` characters. */
	truncate(index: number, length: number): void;
	/** Add text to the end of drawn chunk `index`. */
	append(index: number, text: string): void;
	/** Draw a new chunk after the last one. */
	add(kind: StreamKind, text: string): void;
}

/** What a view has drawn so far. */
export class DrawState {
	version = -1;
	drawn: number[] = [];
}

/**
 * Brings a view up to date with the buffer, touching only what changed: growth is appended,
 * a "\r" rewrite cuts back only the current line, and a full redraw happens only after old
 * output is dropped or the buffer is cleared. Returns true when anything changed.
 */
export function drawIncrementally(buf: OutputBuffer, st: DrawState, sink: ChunkSink): boolean {
	const chunks = buf.chunks;
	let changed = false;
	if (buf.version !== st.version) {
		sink.reset();
		st.version = buf.version;
		st.drawn = [];
		buf.takeDamage();
		changed = true;
	} else {
		const damage = buf.takeDamage();
		if (damage) {
			const keep = Math.min(st.drawn.length, damage.offset > 0 ? damage.chunk + 1 : damage.chunk);
			if (keep < st.drawn.length) sink.dropFrom(keep);
			st.drawn.length = keep;
			const i = damage.chunk;
			if (damage.offset > 0 && i < keep && st.drawn[i] > damage.offset) {
				sink.truncate(i, damage.offset);
				st.drawn[i] = damage.offset;
			}
			changed = true;
		}
	}
	const last = st.drawn.length - 1;
	if (last >= 0 && last < chunks.length && chunks[last].text.length > st.drawn[last]) {
		sink.append(last, chunks[last].text.slice(st.drawn[last]));
		st.drawn[last] = chunks[last].text.length;
		changed = true;
	}
	for (let i = st.drawn.length; i < chunks.length; i++) {
		sink.add(chunks[i].kind, chunks[i].text);
		st.drawn.push(chunks[i].text.length);
		changed = true;
	}
	return changed;
}
