/** Small pure text helpers (unit-tested). */

// eslint-disable-next-line no-control-regex
const ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g;

export function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

/**
 * Splits a command line into words, honouring single/double quotes.
 * `"C:\Program Files\Python\python.exe" -X utf8` → [path, "-X", "utf8"].
 */
export function splitCommandLine(line: string): string[] {
	const out: string[] = [];
	let cur = "";
	let quote: '"' | "'" | null = null;
	let hasToken = false;
	for (const ch of line.trim()) {
		if (quote) {
			if (ch === quote) quote = null;
			else cur += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			hasToken = true;
			continue;
		}
		if (/\s/.test(ch)) {
			if (hasToken) {
				out.push(cur);
				cur = "";
				hasToken = false;
			}
			continue;
		}
		cur += ch;
		hasToken = true;
	}
	if (hasToken) out.push(cur);
	return out;
}

/** Replaces `{file}` / `{out}` / `{dir}` placeholders in argument templates. */
export function expandArgs(args: readonly string[], vars: Record<string, string>): string[] {
	return args.map((a) => a.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m)));
}

/** Quotes one argument for cmd.exe (used only for .cmd/.bat launchers on Windows). */
export function quoteForCmd(arg: string): string {
	if (arg.length && !/[\s"&|<>^()%!]/.test(arg)) return arg;
	return `"${arg.replace(/"/g, '""')}"`;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
	const m = Math.floor(ms / 60_000);
	const s = Math.round((ms % 60_000) / 1000);
	return `${m} min ${s} s`;
}
