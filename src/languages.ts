/**
 * Language registry: one table drives detection (code-block names and file extensions),
 * how a language is run, and which in-app runner (if any) works without installed tools.
 *
 * Command strings may carry fixed arguments, e.g. "py -3" or "dotnet run". The first word is
 * the executable; the rest is prepended to the recipe's args. Candidates are tried in order and
 * the first one found on PATH wins. Users can override the command per language in settings.
 */

export interface ProcessRecipe {
	/** Interpreter/launcher candidates (POSIX). */
	commands: string[];
	/** Candidates on Windows, when different. */
	windowsCommands?: string[];
	/** Arguments after the command. `{file}` = source file. */
	args: string[];
	/** File extension used for temporary source files (no dot). */
	ext: string;
	/** Fixed file name for the temporary source file, when the toolchain cares. */
	fileName?: string;
	/** Compile first, then run the produced executable. `{file}` = source, `{out}` = executable. */
	compile?: { commands: string[]; windowsCommands?: string[]; args: string[] };
	/** Send the source to stdin instead of passing a path (e.g. sqlite3). */
	sourceViaStdin?: boolean;
	/** Only available on these platforms. */
	platforms?: Array<"win32" | "darwin" | "linux">;
	/**
	 * Run code blocks from a stable folder (one per block) so the toolchain's own build cache is
	 * reused: re-running an unchanged C# block takes ~0.3 s instead of ~2.5 s.
	 */
	cache?: boolean;
	/** Extra advice shown when a run fails and its output matches the pattern. */
	hints?: Array<[RegExp, string]>;
	/** Write temporary source files with a UTF-8 byte-order mark (Windows PowerShell needs it). */
	bom?: boolean;
}

export interface LanguageDef {
	id: string;
	name: string;
	/** Names accepted after ``` (lower-case). */
	aliases: string[];
	/** File extensions (lower-case, no dot) recognised for code files. */
	extensions: string[];
	/** Desktop runner. */
	process?: ProcessRecipe;
	/** Runner that works inside Obsidian itself (desktop and mobile). */
	inApp?: "js" | "html";
	/** Rewrites a snippet into a runnable program (adds boilerplate such as `main`). */
	prepare?: (code: string) => string;
}

// ---------- snippet helpers (pure, unit-tested) ----------

/**
 * The code with comments and string literals blanked out (C-family syntax), so checks such as
 * "does this snippet declare a class?" aren't fooled by `// the String class` or `"main("`.
 */
export function codeOnly(code: string, singleQuotedStrings = true): string {
	const re = singleQuotedStrings
		? /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g
		: /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"/g;
	return code.replace(re, " ");
}

/** PHP needs an opening tag. */
export function preparePhp(code: string): string {
	return /<\?(php|=)/.test(code) ? code : `<?php\n${code}`;
}

/** Go: add `package main`, and wrap bare statements in `func main()`. */
export function prepareGo(code: string): string {
	let src = code;
	const bare = codeOnly(code);
	if (!/^\s*package\s+\w+/m.test(bare)) {
		if (!/\bfunc\s+\w*\s*\(/.test(bare)) {
			const { imports, rest } = splitGoImports(src);
			src = `${imports}${imports ? "\n" : ""}func main() {\n${indent(rest)}\n}\n`;
		}
		src = `package main\n\n${src}`;
	}
	return src;
}

function splitGoImports(code: string): { imports: string; rest: string } {
	const importRe = /^\s*import\s+(\([\s\S]*?\)|"[^"]*"|\w+\s+"[^"]*")\s*$/gm;
	const imports: string[] = [];
	const rest = code.replace(importRe, (m) => {
		imports.push(m.trim());
		return "";
	});
	return { imports: imports.join("\n"), rest: rest.replace(/^\s*\n/, "").trimEnd() };
}

/** Rust: wrap bare statements in `fn main()`, keeping `use` lines outside. */
export function prepareRust(code: string): string {
	if (/\bfn\s+main\s*\(/.test(codeOnly(code, false))) return code; // Rust: 'a is a lifetime, not a string
	const lines = code.split("\n");
	const head: string[] = [];
	const body: string[] = [];
	for (const line of lines) {
		if (/^\s*(use|extern\s+crate|#!\[)/.test(line) && body.length === 0) head.push(line);
		else body.push(line);
	}
	return `${head.join("\n")}${head.length ? "\n\n" : ""}fn main() {\n${indent(body.join("\n").trim())}\n}\n`;
}

/** Java: wrap bare statements in a class with `main` (works on any JDK 11+). */
export function prepareJava(code: string): string {
	const bare = codeOnly(code);
	if (/\b(class|interface|enum|record)\s+\w+/.test(bare) || /\bvoid\s+main\s*\(/.test(bare)) return code;
	const lines = code.split("\n");
	const imports = lines.filter((l) => /^\s*import\s+[\w.*]+\s*;/.test(l));
	const body = lines.filter((l) => !/^\s*import\s+[\w.*]+\s*;/.test(l));
	return `${imports.join("\n")}${imports.length ? "\n\n" : ""}public class Main {\n    public static void main(String[] args) throws Exception {\n${indent(body.join("\n").trim(), 8)}\n    }\n}\n`;
}

/** C / C++: wrap bare statements in `main`, keeping #include lines outside. */
export function prepareC(cpp: boolean): (code: string) => string {
	return (code: string) => {
		if (/\bmain\s*\(/.test(codeOnly(code))) return code;
		const lines = code.split("\n");
		const head = lines.filter((l) => /^\s*(#|using\s+namespace)/.test(l));
		const body = lines.filter((l) => !/^\s*(#|using\s+namespace)/.test(l));
		const defaults = cpp
			? (head.some((l) => /<iostream>/.test(l)) ? "" : "#include <iostream>\n") +
				(head.some((l) => /using\s+namespace\s+std/.test(l)) ? "" : "using namespace std;\n")
			: head.some((l) => /<stdio\.h>/.test(l))
				? ""
				: "#include <stdio.h>\n";
		const signature = cpp ? "int main()" : "int main(void)";
		return `${defaults}${head.join("\n")}\n\n${signature} {\n${indent(body.join("\n").trim())}\n    return 0;\n}\n`;
	};
}

/** Dart: wrap bare statements in `void main()`. */
export function prepareDart(code: string): string {
	if (/\bmain\s*\(/.test(codeOnly(code))) return code;
	const lines = code.split("\n");
	const head = lines.filter((l) => /^\s*import\s+['"]/.test(l));
	const body = lines.filter((l) => !/^\s*import\s+['"]/.test(l));
	return `${head.join("\n")}${head.length ? "\n\n" : ""}void main() {\n${indent(body.join("\n").trim())}\n}\n`;
}

/** Batch: UTF-8 output (Arabic and other scripts show correctly) and Windows line endings. */
export function prepareBatch(code: string): string {
	const body = code.replace(/\r?\n/g, "\r\n");
	return /^\s*@?chcp\b/im.test(code) ? body : `@chcp 65001 >nul\r\n${body}`;
}

function indent(text: string, spaces = 4): string {
	const pad = " ".repeat(spaces);
	return text
		.split("\n")
		.map((l) => (l.length ? pad + l : l))
		.join("\n");
}

// ---------- the registry ----------

export const LANGUAGES: LanguageDef[] = [
	{
		id: "python",
		name: "Python",
		aliases: ["python", "py", "python3", "py3"],
		extensions: ["py", "pyw"],
		process: { commands: ["python3", "python"], windowsCommands: ["py -3", "python", "python3"], args: ["-u", "{file}"], ext: "py" },
	},
	{
		id: "javascript",
		name: "JavaScript",
		aliases: ["javascript", "js", "node", "nodejs", "mjs", "cjs"],
		extensions: ["js", "mjs", "cjs"],
		process: { commands: ["node", "bun", "deno run -A"], args: ["{file}"], ext: "js" },
		inApp: "js",
	},
	{
		id: "typescript",
		name: "TypeScript",
		aliases: ["typescript", "ts"],
		extensions: ["ts", "mts", "cts"],
		process: {
			commands: ["tsx", "bun", "deno run -A", "node --experimental-strip-types --no-warnings"],
			args: ["{file}"],
			ext: "ts",
			hints: [[/bad option: --experimental-strip-types/, "This Node.js is too old to run TypeScript directly. Install tsx (npm install -g tsx), or Node.js 22.6 or newer."]],
		},
	},
	{
		id: "html",
		name: "HTML",
		aliases: ["html", "htm"],
		extensions: ["html", "htm"],
		inApp: "html",
	},
	{
		id: "shell",
		name: "Shell",
		aliases: ["bash", "sh", "shell", "shellscript"],
		extensions: ["sh", "bash"],
		process: { commands: ["bash", "sh"], windowsCommands: ["bash"], args: ["{file}"], ext: "sh" },
	},
	{ id: "zsh", name: "Zsh", aliases: ["zsh"], extensions: ["zsh"], process: { commands: ["zsh"], args: ["{file}"], ext: "zsh" } },
	{ id: "fish", name: "Fish", aliases: ["fish"], extensions: ["fish"], process: { commands: ["fish"], args: ["{file}"], ext: "fish" } },
	{
		id: "powershell",
		name: "PowerShell",
		aliases: ["powershell", "pwsh", "ps1", "ps"],
		extensions: ["ps1", "psm1"],
		process: {
			commands: ["pwsh -NoProfile -ExecutionPolicy Bypass -Command"],
			windowsCommands: ["pwsh -NoProfile -ExecutionPolicy Bypass -Command", "powershell -NoProfile -ExecutionPolicy Bypass -Command"],
			// UTF-8 output (Windows PowerShell otherwise uses the console code page), plain-text
			// errors, then the script itself; its exit code is passed on.
			args: [
				"try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch {}; $OutputEncoding = [Text.UTF8Encoding]::new($false); if ($PSStyle) { $PSStyle.OutputRendering = 'PlainText' }; & {fileps}; exit $LASTEXITCODE",
			],
			ext: "ps1",
			bom: true,
		},
	},
	{
		id: "batch",
		name: "Batch",
		aliases: ["batch", "bat", "cmd"],
		extensions: ["bat", "cmd"],
		process: { commands: ["cmd /d /c"], args: ["{file}"], ext: "bat", platforms: ["win32"] },
		prepare: prepareBatch,
	},
	{ id: "ruby", name: "Ruby", aliases: ["ruby", "rb"], extensions: ["rb"], process: { commands: ["ruby"], args: ["{file}"], ext: "rb" } },
	{ id: "php", name: "PHP", aliases: ["php"], extensions: ["php"], process: { commands: ["php"], args: ["{file}"], ext: "php" }, prepare: preparePhp },
	{ id: "perl", name: "Perl", aliases: ["perl", "pl"], extensions: ["pl", "pm"], process: { commands: ["perl"], args: ["{file}"], ext: "pl" } },
	{ id: "lua", name: "Lua", aliases: ["lua"], extensions: ["lua"], process: { commands: ["lua", "luajit", "lua5.4", "lua5.3"], args: ["{file}"], ext: "lua" } },
	{ id: "r", name: "R", aliases: ["r", "rscript"], extensions: ["r"], process: { commands: ["Rscript"], args: ["{file}"], ext: "R" } },
	{ id: "julia", name: "Julia", aliases: ["julia", "jl"], extensions: ["jl"], process: { commands: ["julia"], args: ["{file}"], ext: "jl" } },
	{
		id: "go",
		name: "Go",
		aliases: ["go", "golang"],
		extensions: ["go"],
		process: { commands: ["go run"], args: ["{file}"], ext: "go", fileName: "main.go" },
		prepare: prepareGo,
	},
	{
		id: "rust",
		name: "Rust",
		aliases: ["rust", "rs"],
		extensions: ["rs"],
		process: { commands: ["{out}"], args: [], ext: "rs", fileName: "main.rs", compile: { commands: ["rustc"], args: ["--edition", "2021", "{file}", "-o", "{out}"] } },
		prepare: prepareRust,
	},
	{
		id: "c",
		name: "C",
		aliases: ["c"],
		extensions: ["c", "h"],
		process: { commands: ["{out}"], args: [], ext: "c", compile: { commands: ["gcc", "clang", "cc"], args: ["{file}", "-o", "{out}", "-lm"] } },
		prepare: prepareC(false),
	},
	{
		id: "cpp",
		name: "C++",
		aliases: ["cpp", "c++", "cxx", "cc", "hpp"],
		extensions: ["cpp", "cc", "cxx", "hpp", "hh", "hxx"],
		process: { commands: ["{out}"], args: [], ext: "cpp", compile: { commands: ["g++", "clang++", "c++"], args: ["-std=c++17", "{file}", "-o", "{out}"] } },
		prepare: prepareC(true),
	},
	{
		id: "csharp",
		name: "C#",
		aliases: ["csharp", "cs", "c#"],
		extensions: ["cs", "csx"],
		process: {
			// .NET 10+ runs single files; AOT off = no extra download and a faster first build.
			commands: ["dotnet run --property:PublishAot=false", "dotnet-script"],
			args: ["{file}"],
			ext: "cs",
			fileName: "Program.cs",
			cache: true,
			hints: [[/Couldn't find a project to run|MSB1003|MSB1009/, "Running a single C# file needs .NET 10 or newer. On older .NET, install dotnet-script (dotnet tool install -g dotnet-script) and set it as the C# command in settings."]],
		},
	},
	{
		id: "fsharp",
		name: "F#",
		aliases: ["fsharp", "fs", "f#", "fsx"],
		extensions: ["fs", "fsx"],
		process: { commands: ["dotnet fsi"], args: ["{file}"], ext: "fsx" },
	},
	{
		id: "java",
		name: "Java",
		aliases: ["java"],
		extensions: ["java"],
		process: {
			commands: ["java"],
			// UTF-8 source and output on every system (older Java and Windows default to the local code page).
			args: ["-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "{file}"],
			ext: "java",
			fileName: "Main.java",
			hints: [[/Could not find or load main class Main\.java|ClassNotFoundException: Main\.java/, "Running a .java file directly needs Java 11 or newer."]],
		},
		prepare: prepareJava,
	},
	{ id: "kotlin", name: "Kotlin", aliases: ["kotlin", "kt", "kts"], extensions: ["kt", "kts"], process: { commands: ["kotlinc -script", "kotlin"], args: ["{file}"], ext: "kts" } },
	{ id: "scala", name: "Scala", aliases: ["scala", "sc"], extensions: ["scala", "sc"], process: { commands: ["scala-cli run", "scala"], args: ["{file}"], ext: "sc", cache: true } },
	{ id: "groovy", name: "Groovy", aliases: ["groovy"], extensions: ["groovy", "gvy"], process: { commands: ["groovy"], args: ["{file}"], ext: "groovy" } },
	{ id: "swift", name: "Swift", aliases: ["swift"], extensions: ["swift"], process: { commands: ["swift"], args: ["{file}"], ext: "swift" } },
	{ id: "dart", name: "Dart", aliases: ["dart"], extensions: ["dart"], process: { commands: ["dart run", "dart"], args: ["{file}"], ext: "dart" }, prepare: prepareDart },
	{ id: "haskell", name: "Haskell", aliases: ["haskell", "hs"], extensions: ["hs"], process: { commands: ["runghc", "runhaskell", "stack runghc"], args: ["{file}"], ext: "hs" } },
	{ id: "elixir", name: "Elixir", aliases: ["elixir", "ex", "exs"], extensions: ["ex", "exs"], process: { commands: ["elixir"], args: ["{file}"], ext: "exs" } },
	{ id: "clojure", name: "Clojure", aliases: ["clojure", "clj"], extensions: ["clj", "cljs", "cljc"], process: { commands: ["clojure -M", "clj -M", "bb"], args: ["{file}"], ext: "clj" } },
	{ id: "ocaml", name: "OCaml", aliases: ["ocaml", "ml"], extensions: ["ml", "mli"], process: { commands: ["ocaml"], args: ["{file}"], ext: "ml" } },
	{ id: "nim", name: "Nim", aliases: ["nim"], extensions: ["nim"], process: { commands: ["nim r --hints:off"], args: ["{file}"], ext: "nim", cache: true } },
	{ id: "zig", name: "Zig", aliases: ["zig"], extensions: ["zig"], process: { commands: ["zig run"], args: ["{file}"], ext: "zig" } },
	{ id: "crystal", name: "Crystal", aliases: ["crystal", "cr"], extensions: ["cr"], process: { commands: ["crystal run"], args: ["{file}"], ext: "cr", cache: true } },
	{ id: "racket", name: "Racket", aliases: ["racket", "rkt"], extensions: ["rkt"], process: { commands: ["racket"], args: ["{file}"], ext: "rkt" } },
	{ id: "lisp", name: "Common Lisp", aliases: ["lisp", "commonlisp", "cl"], extensions: ["lisp", "lsp"], process: { commands: ["sbcl --script"], args: ["{file}"], ext: "lisp" } },
	{
		id: "fortran",
		name: "Fortran",
		aliases: ["fortran", "f90", "f95"],
		extensions: ["f90", "f95", "f03"],
		process: { commands: ["{out}"], args: [], ext: "f90", compile: { commands: ["gfortran"], args: ["{file}", "-o", "{out}"] } },
	},
	{ id: "octave", name: "Octave / MATLAB", aliases: ["octave", "matlab"], extensions: [], process: { commands: ["octave-cli", "octave --no-gui --quiet"], args: ["{file}"], ext: "m" } },
	{
		id: "sql",
		name: "SQL (SQLite)",
		aliases: ["sql", "sqlite", "sqlite3"],
		extensions: ["sql"],
		process: { commands: ["sqlite3 -header -column -bail :memory:"], args: [], ext: "sql", sourceViaStdin: true },
	},
	{ id: "applescript", name: "AppleScript", aliases: ["applescript", "osascript"], extensions: ["applescript", "scpt"], process: { commands: ["osascript"], args: ["{file}"], ext: "applescript", platforms: ["darwin"] } },
];

/** Languages shown with a Copy button even though they don't run (and must not be confused with rendered blocks). */
export const COPY_ONLY_LANGUAGES = new Set([
	"css", "scss", "sass", "less", "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "xml", "svg", "csv", "tsv",
	"jsx", "tsx", "vue", "svelte", "graphql", "gql", "proto", "protobuf", "dockerfile", "docker", "makefile", "make", "cmake",
	"diff", "patch", "nginx", "apache", "markdown", "md", "tex", "latex", "regex", "text", "txt", "plaintext", "log", "console",
	"terraform", "hcl", "solidity", "sol", "verilog", "vhdl", "asm", "nasm", "x86asm", "wasm", "cobol", "pascal", "delphi",
	"objectivec", "objc", "erlang", "erl", "elm", "purescript", "vb", "vbnet", "vba", "abap", "apex", "prolog", "scheme",
	"smalltalk", "tcl", "awk", "sed", "jinja", "liquid", "handlebars", "twig", "env", "properties", "gradle", "http",
]);

/**
 * Fenced blocks that Obsidian or popular plugins render as something else (diagrams, queries...).
 * Coder never decorates these.
 */
export const RENDERED_FENCES = new Set([
	"mermaid", "dataview", "dataviewjs", "tasks", "query", "math", "chart", "kanban", "button", "tracker", "timeline",
	"excalidraw", "tldraw", "base", "bases", "plantuml", "graphviz", "dot", "abc", "music-abc", "contributions",
	"folder-overview", "gallery", "leaflet", "meta-bind", "meta-bind-button", "meta-bind-embed", "mehrmaid", "tikz", "chem",
	"smiles", "calendar-planner", "habittracker", "heatmap-calendar", "toc", "table-of-contents", "pdf", "img-gallery",
]);

const byAlias = new Map<string, LanguageDef>();
const byExtension = new Map<string, LanguageDef>();
for (const lang of LANGUAGES) {
	for (const a of lang.aliases) byAlias.set(a, lang);
	for (const e of lang.extensions) if (!byExtension.has(e)) byExtension.set(e, lang);
}

/** Normalises a fence language token (`Python`, `{python}`, `py title=x`) to a lower-case name. */
export function normaliseFenceLanguage(raw: string): string {
	return raw.trim().replace(/^\{\.?/, "").replace(/[}\s].*$/, "").toLowerCase();
}

export function languageForFence(raw: string): LanguageDef | undefined {
	return byAlias.get(normaliseFenceLanguage(raw));
}

export function languageForExtension(ext: string): LanguageDef | undefined {
	return byExtension.get(ext.toLowerCase());
}

export function languageById(id: string): LanguageDef | undefined {
	return LANGUAGES.find((l) => l.id === id);
}

/** True when a fence should get the Coder bar (runnable or a known code language). */
export function isDecoratedFence(raw: string): boolean {
	const name = normaliseFenceLanguage(raw);
	if (!name) return true; // un-labelled code block: copy only
	if (RENDERED_FENCES.has(name) || name.startsWith("ad-")) return false;
	return byAlias.has(name) || COPY_ONLY_LANGUAGES.has(name);
}

/** Every file extension Coder can open, in a stable order (used as the default setting). */
export const DEFAULT_CODE_EXTENSIONS = [
	"py", "pyw", "js", "mjs", "cjs", "ts", "mts", "cts", "jsx", "tsx", "java", "kt", "kts", "scala", "groovy",
	"c", "h", "cpp", "cc", "cxx", "hpp", "cs", "fs", "fsx", "go", "rs", "swift", "dart", "rb", "php", "pl", "lua",
	"r", "jl", "hs", "ex", "exs", "clj", "ml", "nim", "zig", "cr", "rkt", "lisp", "f90", "sh", "bash", "zsh", "fish",
	"ps1", "bat", "cmd", "sql", "json", "jsonc", "yaml", "yml", "toml", "ini", "xml", "html", "htm", "css", "scss",
	"less", "vue", "svelte", "graphql", "proto",
];
