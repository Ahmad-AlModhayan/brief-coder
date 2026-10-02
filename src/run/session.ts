import { OutputBuffer, StreamKind } from "./output";

export type RunStatus = "idle" | "running" | "done" | "failed" | "stopped";

export interface RunExit {
	code: number | null;
	signal?: string | null;
	/** Set when the program could not start or the runner failed. */
	error?: string;
}

export interface RunHandle {
	stop(): void;
	/** Present when the program accepts typed input. */
	writeStdin?(text: string): void;
	done: Promise<RunExit>;
}

export interface RunSink {
	write(kind: StreamKind, text: string): void;
}

/**
 * One run target (a code block or a code file). Lives outside the DOM so output
 * survives scrolling, re-rendering and switching between reading view and Live Preview.
 */
export class RunSession implements RunSink {
	readonly buffer: OutputBuffer;
	status: RunStatus = "idle";
	label = "";
	command = "";
	startedAt = 0;
	durationMs = 0;
	exit: RunExit | null = null;
	/** HTML to show in a sandboxed preview (HTML blocks/files). */
	html: string | null = null;
	handle: RunHandle | null = null;
	/** True when the current run was stopped from the UI (shown as "Stopped", not "Failed"). */
	stoppedByUser = false;
	/** Last time something showed this session or it finished a run (for pruning). */
	lastSeen = Date.now();

	private listeners = new Set<() => void>();
	private frame = 0;

	constructor(readonly key: string, maxChars: number) {
		this.buffer = new OutputBuffer(maxChars);
	}

	get running(): boolean {
		return this.status === "running";
	}

	get hasContent(): boolean {
		return this.status !== "idle" || this.buffer.size > 0 || this.html !== null;
	}

	/** True while a bar, output panel or code view is showing this session. */
	get inUse(): boolean {
		return this.listeners.size > 0;
	}

	/** Stop was pressed before the program had started; the runner checks this before spawning. */
	get cancelled(): boolean {
		return this.running && this.stoppedByUser;
	}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		this.lastSeen = Date.now();
		return () => {
			this.listeners.delete(fn);
			this.lastSeen = Date.now();
		};
	}

	write(kind: StreamKind, text: string): void {
		this.buffer.append(kind, text);
		this.schedule();
	}

	begin(label: string): void {
		this.buffer.clear();
		this.html = null;
		this.exit = null;
		this.label = label;
		this.command = "";
		this.stoppedByUser = false;
		this.status = "running";
		this.startedAt = Date.now();
		this.durationMs = 0;
		this.notifyNow();
	}

	finish(exit: RunExit, stopped = false): void {
		this.exit = exit;
		this.durationMs = Date.now() - this.startedAt;
		this.handle = null;
		this.lastSeen = Date.now();
		if (exit.error) this.buffer.append("err", (this.buffer.size ? "\n" : "") + exit.error + "\n");
		this.status = stopped ? "stopped" : exit.error || (exit.code !== null && exit.code !== 0) || exit.signal ? "failed" : "done";
		this.notifyNow();
	}

	/** Stops the program, or makes sure it never starts if it's still being prepared. */
	stop(): void {
		if (!this.running) return;
		this.stoppedByUser = true;
		this.handle?.stop();
	}

	clear(): void {
		if (this.running) return;
		this.buffer.clear();
		this.html = null;
		this.exit = null;
		this.status = "idle";
		this.notifyNow();
	}

	/** Coalesces output bursts into one UI update per animation frame. */
	private schedule(): void {
		if (this.frame) return;
		const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16);
		this.frame = raf(() => {
			this.frame = 0;
			this.emit();
		}) as unknown as number;
	}

	notifyNow(): void {
		this.emit();
	}

	private emit(): void {
		for (const fn of Array.from(this.listeners)) {
			try {
				fn();
			} catch (e) {
				console.error("[Obsidian Coder]", e);
			}
		}
	}
}

/** Sessions nobody has shown for this long are dropped, with their output. */
const IDLE_MS = 10 * 60 * 1000;

export class SessionStore {
	private sessions = new Map<string, RunSession>();
	/** Bumped by stopAll(), so "Run all" loops know to stop starting new blocks. */
	stopGeneration = 0;

	constructor(private maxChars: () => number) {}

	get(key: string): RunSession {
		let s = this.sessions.get(key);
		if (!s) {
			s = new RunSession(key, this.maxChars());
			this.sessions.set(key, s);
		}
		return s;
	}

	peek(key: string): RunSession | undefined {
		return this.sessions.get(key);
	}

	/** Sessions for one note or file (keys start with the path). */
	forPath(path: string): RunSession[] {
		const prefix = `${path}|`;
		return Array.from(this.sessions.values()).filter((s) => s.key === path || s.key.startsWith(prefix));
	}

	/** Clears every output of a note. Sessions still on screen stay (empty) so their bars keep working. */
	clearPath(path: string): void {
		for (const s of this.forPath(path)) {
			if (s.running) continue;
			s.clear();
			if (!s.inUse) this.sessions.delete(s.key);
		}
	}

	stopAll(): void {
		this.stopGeneration++;
		for (const s of this.sessions.values()) s.stop();
	}

	/**
	 * Keeps memory flat over long sessions: drops sessions that nothing shows and that are not
	 * running — at once when they hold no output, after IDLE_MS when they do.
	 */
	prune(now = Date.now()): void {
		for (const [k, s] of this.sessions) {
			if (s.running || s.inUse) continue;
			if (!s.hasContent || now - s.lastSeen > IDLE_MS) this.sessions.delete(k);
		}
	}

	get size(): number {
		return this.sessions.size;
	}
}
