/**
 * Desktop runner: executes code with the interpreters/compilers installed on the computer.
 *
 * Node modules are required lazily (only when the user runs something on desktop), so the
 * plugin still loads on mobile where they don't exist.
 */
import type { ChildProcess, SpawnOptions } from "child_process";
import { t } from "../i18n";
import type { LanguageDef } from "../languages";
import type { CoderSettings } from "../settings";
import type { RunExit, RunHandle, RunSink } from "./session";
import { hashString } from "../util/fence";
import { expandArgs, quoteForCmd, splitCommandLine, stripAnsi } from "../util/text";

interface NodeMods {
	cp: typeof import("child_process");
	fs: typeof import("fs");
	path: typeof import("path");
	os: typeof import("os");
}

let mods: NodeMods | null = null;

/**
 * Loads Node's modules on first use. Every entry point below awaits this; mobile never gets here.
 * It has to be require(): esbuild leaves import() of a built-in as a real ES-module import, which
 * Obsidian's renderer can't resolve ("Failed to resolve module specifier 'child_process'").
 */
async function loadNode(): Promise<NodeMods> {
	/* eslint-disable @typescript-eslint/no-require-imports -- desktop-only modules, loaded on first run (see above) */
	mods ??= {
		cp: require("child_process") as NodeMods["cp"],
		fs: require("fs") as NodeMods["fs"],
		path: require("path") as NodeMods["path"],
		os: require("os") as NodeMods["os"],
	};
	/* eslint-enable @typescript-eslint/no-require-imports -- end of the desktop-only modules */
	return mods;
}

function node(): NodeMods {
	if (!mods) throw new Error("Running programs needs Obsidian for desktop.");
	return mods;
}

const isWin = (): boolean => process.platform === "win32";

// ---------- environment & executable discovery ----------

let envPromise: Promise<NodeJS.ProcessEnv> | null = null;
const whichCache = new Map<string, string | null>();

/** Environment for child processes: the user's full PATH plus common tool folders. Built once. */
export function runEnv(): Promise<NodeJS.ProcessEnv> {
	if (!envPromise) envPromise = buildEnv();
	return envPromise;
}

/** Forget discovered tools (after the user installs something or edits commands). */
export function resetDetection(): void {
	envPromise = null;
	whichCache.clear();
}

function pathKey(env: NodeJS.ProcessEnv): string {
	return Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
}

async function buildEnv(): Promise<NodeJS.ProcessEnv> {
	const { path, os } = await loadNode();
	const env: NodeJS.ProcessEnv = { ...process.env };
	const key = pathKey(env);
	const home = os.homedir();
	const sep = path.delimiter;
	const fromShell = isWin() ? "" : await loginShellPath();
	const extras = isWin() ? windowsExtras(env, home) : posixExtras(home);
	const parts = [...fromShell.split(sep), ...(env[key] ?? "").split(sep), ...extras];
	const seen = new Set<string>();
	env[key] = parts.filter((p) => p && !seen.has(p) && (seen.add(p), true)).join(sep);
	Object.assign(env, {
		PYTHONUNBUFFERED: "1",
		PYTHONIOENCODING: "utf-8",
		NO_COLOR: "1",
		FORCE_COLOR: "0",
		TERM: "dumb",
		DOTNET_CLI_TELEMETRY_OPTOUT: "1",
		DOTNET_NOLOGO: "1",
	});
	return env;
}

function posixExtras(home: string): string[] {
	return [
		"/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
		`${home}/.local/bin`, `${home}/.cargo/bin`, `${home}/.bun/bin`, `${home}/.deno/bin`, `${home}/go/bin`, "/usr/local/go/bin",
		`${home}/.dotnet`, `${home}/.dotnet/tools`, `${home}/.ghcup/bin`, `${home}/.juliaup/bin`, `${home}/.nimble/bin`,
		`${home}/.volta/bin`, `${home}/.pyenv/shims`, `${home}/.rbenv/shims`, `${home}/.asdf/shims`, `${home}/.local/share/mise/shims`,
		"/snap/bin", "/Library/Frameworks/Python.framework/Versions/Current/bin",
	];
}

function windowsExtras(env: NodeJS.ProcessEnv, home: string): string[] {
	const pf = env["ProgramFiles"] ?? "C:\\Program Files";
	const local = env["LOCALAPPDATA"] ?? `${home}\\AppData\\Local`;
	return [
		`${pf}\\nodejs`, `${pf}\\Go\\bin`, `${pf}\\dotnet`, `${pf}\\Git\\cmd`,
		`${home}\\.cargo\\bin`, `${home}\\.bun\\bin`, `${home}\\.deno\\bin`, `${home}\\go\\bin`, `${home}\\.dotnet\\tools`,
		`${local}\\Programs\\Python\\Launcher`, `${local}\\Microsoft\\WindowsApps`,
	];
}

/** macOS/Linux apps launched from the dock don't inherit the shell PATH (Homebrew, pyenv, nvm...). */
function loginShellPath(): Promise<string> {
	return new Promise((resolve) => {
		const { cp } = node();
		const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
		let out = "";
		let child: ChildProcess;
		try {
			child = cp.spawn(shell, ["-ilc", 'printf "__CODER_PATH__%s__CODER_END__" "$PATH"'], {
				stdio: ["ignore", "pipe", "ignore"],
				env: process.env,
			});
		} catch {
			resolve("");
			return;
		}
		const timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				/* ignore */
			}
			resolve("");
		}, 4000);
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (d: string) => (out += d));
		child.on("error", () => {
			clearTimeout(timer);
			resolve("");
		});
		child.on("close", () => {
			clearTimeout(timer);
			const m = /__CODER_PATH__([\s\S]*?)__CODER_END__/.exec(out);
			resolve(m ? m[1].trim() : "");
		});
	});
}

/** Git Bash is preferred over WSL's bash.exe on Windows (WSL can't see Windows temp paths). */
function windowsSpecialDirs(name: string, env: NodeJS.ProcessEnv): string[] {
	if (name.toLowerCase() !== "bash") return [];
	const pf = env["ProgramFiles"] ?? "C:\\Program Files";
	const pf86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
	const local = env["LOCALAPPDATA"] ?? "";
	return [`${pf}\\Git\\bin`, `${pf86}\\Git\\bin`, local ? `${local}\\Programs\\Git\\bin` : ""];
}

/** Finds an executable on PATH (cached). Returns the absolute path or null. */
export function which(name: string, env: NodeJS.ProcessEnv): string | null {
	if (whichCache.has(name)) return whichCache.get(name) ?? null;
	const { fs, path } = node();
	const win = isWin();
	const exts = win ? [...(env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase()), ""] : [""];
	const isExec = (p: string): boolean => {
		try {
			if (!fs.statSync(p).isFile()) return false;
			if (!win) fs.accessSync(p, fs.constants.X_OK);
			return true;
		} catch {
			return false;
		}
	};
	let found: string | null = null;
	const hasDir = name.includes("/") || (win && name.includes("\\"));
	if (hasDir) {
		for (const e of exts) {
			if (isExec(name + e)) {
				found = name + e;
				break;
			}
		}
	} else {
		const dirs = [...(win ? windowsSpecialDirs(name, env) : []), ...(env[pathKey(env)] ?? "").split(path.delimiter)];
		outer: for (const raw of dirs) {
			const dir = raw.replace(/^"|"$/g, "");
			if (!dir) continue;
			for (const e of exts) {
				const p = path.join(dir, name + e);
				if (isExec(p)) {
					found = p;
					break outer;
				}
			}
		}
	}
	whichCache.set(name, found);
	return found;
}

export interface ResolvedCommand {
	exe: string;
	pre: string[];
	display: string;
}

export function resolveCommand(candidates: readonly string[], env: NodeJS.ProcessEnv): ResolvedCommand | null {
	for (const c of candidates) {
		const words = splitCommandLine(c);
		if (!words.length) continue;
		const exe = which(words[0], env);
		if (exe) return { exe, pre: words.slice(1), display: c };
	}
	return null;
}

/** Commands to try for a language, honouring the user's override. */
export function candidates(lang: LanguageDef, settings: CoderSettings, step: "run" | "compile"): string[] {
	const r = lang.process;
	if (!r) return [];
	const override = settings.commands[lang.id]?.trim();
	const win = isWin();
	if (step === "compile") {
		if (!r.compile) return [];
		if (override) return [override];
		return (win && r.compile.windowsCommands) || r.compile.commands;
	}
	if (override && !r.compile) return [override];
	return (win && r.windowsCommands) || r.commands;
}

/** Reports which command would run a language (for the settings "Detect" button). */
export async function detect(lang: LanguageDef, settings: CoderSettings): Promise<string | null> {
	if (!lang.process) return null;
	const env = await runEnv();
	const list = lang.process.compile ? candidates(lang, settings, "compile") : candidates(lang, settings, "run");
	const r = resolveCommand(list, env);
	return r ? `${r.exe}${r.pre.length ? " " + r.pre.join(" ") : ""}` : null;
}

// ---------- running ----------

function spawnSmart(exe: string, args: string[], opts: SpawnOptions): ChildProcess {
	const { cp } = node();
	if (isWin() && /\.(cmd|bat)$/i.test(exe)) {
		// Node refuses to spawn .cmd/.bat directly; go through cmd.exe with careful quoting.
		const line = [exe, ...args].map(quoteForCmd).join(" ");
		return cp.spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], { ...opts, windowsVerbatimArguments: true });
	}
	return cp.spawn(exe, args, opts);
}

function killTree(child: ChildProcess): void {
	const pid = child.pid;
	if (!pid) return;
	if (isWin()) {
		try {
			node().cp.spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
		} catch {
			/* ignore */
		}
		return;
	}
	const signal = (sig: NodeJS.Signals) => {
		try {
			process.kill(-pid, sig); // whole process group (we spawn detached)
		} catch {
			try {
				child.kill(sig);
			} catch {
				/* already gone */
			}
		}
	};
	signal("SIGTERM");
	setTimeout(() => {
		if (child.exitCode === null && child.signalCode === null) signal("SIGKILL");
	}, 1500);
}

function notFoundMessage(lang: LanguageDef, tried: readonly string[]): string {
	const names = tried.map((t) => splitCommandLine(t)[0]).filter((n) => n && n !== "{out}");
	return (
		t("{lang} isn't installed, or Obsidian can't find it (tried: {tried}).", { lang: lang.name, tried: Array.from(new Set(names)).join(", ") }) +
		`\n${t("Install it, or set its command in Settings → Brief Coder → Languages.")}`
	);
}

function describeSpawnError(e: NodeJS.ErrnoException, exe: string): string {
	if (e.code === "ENOENT") return `Couldn't start ${exe}: not found.`;
	if (e.code === "EACCES") return `Couldn't start ${exe}: permission denied.`;
	return `Couldn't start ${exe}: ${e.message}`;
}

/** JVM start-up notice printed whenever these variables are set; it isn't the program's output. */
const JVM_NOTICE = /^Picked up (?:_JAVA_OPTIONS|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS):.*(?:\r?\n|$)/gm;

/**
 * Makes output read like the code block: strips colour codes, and shortens the temporary
 * folder in error messages (`/tmp/obsidian-coder-x1/main.py` → `main.py`).
 */
function outputCleaner(dirs: string[]): (text: string, isErr?: boolean) => string {
	const { fs, path } = node();
	const prefixes = new Set<string>();
	for (const dir of dirs.flatMap((d) => [d, safeRealpath(fs, d)])) {
		prefixes.add(dir + path.sep);
		if (isWin()) prefixes.add(dir.replace(/\\/g, "/") + "/");
	}
	const list = Array.from(prefixes).sort((a, b) => b.length - a.length);
	return (text, isErr = false) => {
		let t = stripAnsi(text);
		for (const p of list) if (t.includes(p)) t = t.split(p).join("");
		return isErr ? t.replace(JVM_NOTICE, "") : t;
	};
}

function safeRealpath(fs: NodeMods["fs"], p: string): string {
	try {
		return fs.realpathSync(p);
	} catch {
		return p;
	}
}

export interface ProcessRunOptions {
	lang: LanguageDef;
	settings: CoderSettings;
	/** Source to run (code blocks). Ignored when filePath is set. */
	source?: string;
	/** Absolute path of a code file to run in place. */
	filePath?: string;
	/** Absolute working directory (defaults to the source file's folder). */
	cwd?: string;
	/** Identifies the code block, for languages that keep a build cache (see ProcessRecipe.cache). */
	cacheKey?: string;
	/** Stop was pressed before anything started: nothing gets spawned. */
	isCancelled?: () => boolean;
	sink: RunSink;
	onCommand?: (display: string) => void;
}

const CACHE_DAYS = 14;
let pruned = false;

/**
 * Once per Obsidian session, in the background: removes build caches nobody ran for CACHE_DAYS,
 * and run folders a crash left behind (older than a day). Without this the cache only grows.
 */
export async function pruneTemp(now = Date.now()): Promise<number> {
	const { fs, path, os } = await loadNode();
	let removed = 0;
	const rmIfOld = async (dir: string, maxAgeMs: number) => {
		const st = await fs.promises.stat(dir).catch(() => null);
		if (!st || now - st.mtimeMs < maxAgeMs) return;
		await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
		removed++;
	};
	const tmp = os.tmpdir();
	for (const name of await fs.promises.readdir(tmp).catch(() => [] as string[])) {
		if (/^obsidian-coder-(?!cache$)/.test(name)) await rmIfOld(path.join(tmp, name), 24 * 3600_000);
	}
	const cache = path.join(tmp, "obsidian-coder-cache");
	for (const lang of await fs.promises.readdir(cache).catch(() => [] as string[])) {
		for (const block of await fs.promises.readdir(path.join(cache, lang)).catch(() => [] as string[])) {
			await rmIfOld(path.join(cache, lang, block), CACHE_DAYS * 24 * 3600_000);
		}
	}
	return removed;
}

export async function startProcessRun(o: ProcessRunOptions): Promise<RunHandle> {
	const { fs, path, os } = await loadNode();
	if (!pruned) {
		pruned = true;
		void pruneTemp();
	}
	const lang = o.lang;
	const recipe = lang.process;
	if (!recipe) throw new Error(`${lang.name} has no desktop runner.`);
	if (recipe.platforms && !recipe.platforms.includes(process.platform as "win32" | "darwin" | "linux")) {
		const names: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };
		throw new Error(`${lang.name} only runs on ${recipe.platforms.map((p) => names[p]).join(" / ")}.`);
	}
	const env = await runEnv();
	const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "obsidian-coder-"));
	let file = o.filePath;
	if (!file) {
		const source = o.source ?? "";
		// Cached languages keep one folder per code block so their build cache can be reused.
		const dir = recipe.cache ? path.join(os.tmpdir(), "obsidian-coder-cache", lang.id, hashString(o.cacheKey ?? source)) : tmp;
		if (recipe.cache) {
			await fs.promises.mkdir(dir, { recursive: true });
			const now = new Date();
			await fs.promises.utimes(dir, now, now).catch(() => undefined); // marks the cache as used (see pruneTemp)
		}
		file = path.join(dir, recipe.fileName ?? `main.${recipe.ext}`);
		const content = recipe.bom ? `\ufeff${source}` : source;
		const same = recipe.cache && (await fs.promises.readFile(file, "utf8").catch(() => null)) === content;
		if (!same) await fs.promises.writeFile(file, content, "utf8"); // unchanged files keep their timestamp
	}
	let cwd = o.cwd;
	if (!cwd || !fs.existsSync(cwd)) cwd = path.dirname(file);
	const out = path.join(tmp, isWin() ? "main.exe" : "main");
	const vars = { file, out, dir: path.dirname(file), fileps: `'${file.replace(/'/g, "''")}'` };
	const clean = outputCleaner(o.filePath ? [tmp] : [tmp, path.dirname(file)]);
	let errTail = ""; // the end of stderr, matched against the language's hints

	let current: ChildProcess | null = null;
	let stopped = false;

	const runOne = (exe: string, args: string[], stdinText?: string): Promise<RunExit> =>
		new Promise<RunExit>((resolve) => {
			if (stopped || o.isCancelled?.()) {
				resolve({ code: null, signal: "SIGTERM" });
				return;
			}
			let child: ChildProcess;
			try {
				child = spawnSmart(exe, args, { cwd, env, windowsHide: true, detached: !isWin(), stdio: ["pipe", "pipe", "pipe"] });
			} catch (e) {
				resolve({ code: null, error: describeSpawnError(e as NodeJS.ErrnoException, exe) });
				return;
			}
			current = child;
			let settled = false;
			child.stdout?.setEncoding("utf8");
			child.stderr?.setEncoding("utf8");
			child.stdout?.on("data", (d: string) => o.sink.write("out", clean(d)));
			child.stderr?.on("data", (d: string) => {
				const text = clean(d, true);
				errTail = (errTail + text).slice(-4000);
				o.sink.write("err", text);
			});
			child.stdin?.on("error", () => {
				/* program exited before reading stdin */
			});
			if (stdinText !== undefined) child.stdin?.end(stdinText);
			child.on("error", (e) => {
				if (settled) return;
				settled = true;
				resolve({ code: null, error: describeSpawnError(e, exe) });
			});
			child.on("close", (code, signal) => {
				if (settled) return;
				settled = true;
				resolve({ code, signal });
			});
			// After Stop, a background job the program started (`sleep 300 &` in Git Bash) can keep the
			// output pipes open, so "close" never comes. Once the program itself has exited, stop waiting.
			child.on("exit", (code, signal) => {
				if (!stopped) return;
				setTimeout(() => {
					if (settled) return;
					settled = true;
					child.stdout?.destroy();
					child.stderr?.destroy();
					resolve({ code, signal });
				}, 500);
			});
		});

	const done = (async (): Promise<RunExit> => {
		try {
			if (recipe.compile) {
				const tried = candidates(lang, o.settings, "compile");
				const compiler = resolveCommand(tried, env);
				if (!compiler) return { code: null, error: notFoundMessage(lang, tried) };
				o.onCommand?.(compiler.display);
				const compiled = await runOne(compiler.exe, [...compiler.pre, ...expandArgs(recipe.compile.args, vars)]);
				if (stopped || compiled.error || compiled.code !== 0) return compiled;
				return await runOne(out, expandArgs(recipe.args, vars));
			}
			const tried = candidates(lang, o.settings, "run");
			const cmd = resolveCommand(tried, env);
			if (!cmd) return { code: null, error: notFoundMessage(lang, tried) };
			o.onCommand?.(cmd.display);
			const args = [...cmd.pre, ...expandArgs(recipe.args, vars)];
			const stdinText = recipe.sourceViaStdin ? await fs.promises.readFile(file, "utf8") : undefined;
			const exit = await runOne(cmd.exe, args, stdinText);
			if (!stopped && exit.code !== 0) {
				const hint = recipe.hints?.find(([re]) => re.test(errTail));
				if (hint) o.sink.write("info", `\n${hint[1]}\n`);
			}
			return exit;
		} finally {
			fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
		}
	})();

	return {
		stop: () => {
			stopped = true;
			if (current) killTree(current);
		},
		writeStdin: recipe.sourceViaStdin
			? undefined
			: (text: string) => {
					try {
						current?.stdin?.write(text);
					} catch {
						/* ignore */
					}
				},
		done,
	};
}
