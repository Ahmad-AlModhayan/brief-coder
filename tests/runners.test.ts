/**
 * Integration tests: run real snippets through the same path the Run button uses
 * (prepare → desktop process runner → RunSession). Languages whose tools aren't
 * installed on this machine are skipped, not failed.
 */
import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { languageById } from "../src/languages";
import { detect } from "../src/run/process";
import { startRun } from "../src/run/runner";
import { RunSession } from "../src/run/session";
import { CoderSettings, DEFAULT_SETTINGS } from "../src/settings";

const settings = (patch: Partial<CoderSettings> = {}): CoderSettings => ({ ...DEFAULT_SETTINGS, ...patch, commands: { ...(patch.commands ?? {}) } });

async function run(id: string, code: string, patch: Partial<CoderSettings> = {}, extra: { cwd?: string; filePath?: string; isBlock?: boolean } = {}) {
	const lang = languageById(id);
	assert.ok(lang, `unknown language ${id}`);
	const session = new RunSession(`test|${id}`, 200_000);
	const s = settings(patch);
	const t0 = Date.now();
	await startRun({ session, lang, code, settings: s, desktop: true, isBlock: extra.isBlock ?? true, cwd: extra.cwd, filePath: extra.filePath });
	return { session, out: session.buffer.toString(), ms: Date.now() - t0 };
}

async function available(id: string): Promise<boolean> {
	const lang = languageById(id);
	return !!lang && (await detect(lang, settings())) !== null;
}

/** [language id, snippet as a user would write it in a note, expected output] */
const SNIPPETS: Array<[string, string, RegExp]> = [
	["python", 'import sys\nprint("py", sys.version_info[0])', /^py 3\n$/],
	["javascript", 'const xs = [1, 2, 3];\nconsole.log("js", xs.map((x) => x * 2).join(","));', /^js 2,4,6\n$/],
	["typescript", 'const n: number = 21;\nconsole.log(`ts ${n * 2}`);', /^ts 42\n$/],
	["shell", 'for i in 1 2; do echo "sh $i"; done', /^sh 1\nsh 2\n$/],
	["zsh", 'echo "zsh $((6 * 7))"', /^zsh 42\n$/],
	["fish", 'echo "fish" (math 6 \\* 7)', /^fish 42\n$/],
	["ruby", 'puts "rb #{[1, 2, 3].sum}"', /^rb 6\n$/],
	["php", '$a = [1, 2, 3];\necho "php " . array_sum($a) . "\\n";', /^php 6\n$/],
	["perl", 'my @a = (1, 2, 3);\nprint "pl ", scalar(@a), "\\n";', /^pl 3\n$/],
	["lua", 'print("lua " .. 6 * 7)', /^lua 42\n$/],
	["r", 'cat("r", sum(1:3), "\\n")', /^r 6 \n$/],
	["go", 'import "fmt"\n\nnums := []int{1, 2, 3}\nfmt.Println("go", len(nums))', /^go 3\n$/],
	["rust", 'let v = vec![1, 2, 3];\nprintln!("rs {}", v.iter().sum::<i32>());', /^rs 6\n$/],
	["c", 'int x = 6 * 7;\nprintf("c %d\\n", x);', /^c 42\n$/],
	["cpp", '#include <vector>\nvector<int> v{1, 2, 3};\ncout << "cpp " << v.size() << endl;', /^cpp 3\n$/],
	["java", 'import java.util.*;\nList<Integer> xs = List.of(1, 2, 3);\nSystem.out.println("java " + xs.size());', /^java 3\n$/],
	["fortran", 'program hello\n  print "(a,i0)", "f90 ", 6 * 7\nend program hello', /^f90 42\n$/],
	["sql", "create table t(x int);\ninsert into t values (1), (2), (3);\nselect sum(x) as total from t;", /total\s*\n-+\s*\n6\s*\n$/],
	["lisp", '(format t "lisp ~a~%" (* 6 7))', /^lisp 42\n$/],
	["ocaml", 'print_endline ("ml " ^ string_of_int (6 * 7))', /^ml 42\n$/],
	["haskell", 'main = putStrLn ("hs " ++ show (6 * 7))', /^hs 42\n$/],
	["elixir", 'IO.puts("ex #{6 * 7}")', /^ex 42\n$/],
	["racket", '#lang racket\n(displayln (format "rkt ~a" (* 6 7)))', /^rkt 42\n$/],
	["powershell", '$xs = 1..3\nWrite-Output "ps $(($xs | Measure-Object -Sum).Sum)"', /^ps 6\n$/],
	["clojure", '(println "clj" (* 6 7))', /^clj 42\n$/],
	["csharp", 'var xs = new[] { 1, 2, 3 };\nConsole.WriteLine($"cs {xs.Length}");', /^cs 3\n$/],
	["fsharp", 'printfn "fs %d" (6 * 7)', /^fs 42\n$/],
	["groovy", 'println "groovy ${6 * 7}"', /^groovy 42\n$/],
	["kotlin", 'println("kt ${6 * 7}")', /^kt 42\n$/],
	["scala", 'println(s"scala ${6 * 7}")', /^scala 42\n$/],
	["nim", 'echo "nim ", 6 * 7', /^nim 42\n$/],
	["crystal", 'puts "cr #{6 * 7}"', /^cr 42\n$/],
	["octave", 'printf("m %d\\n", 6 * 7)', /^m 42\n$/],
];

describe("alternative runtimes", () => {
	const cases: Array<[string, string, string, RegExp]> = [
		["javascript", "bun", 'console.log("bun", typeof Bun)', /^bun object\n$/],
		["javascript", "deno run -A", 'console.log("deno", typeof Deno)', /^deno object\n$/],
		["typescript", "bun", 'const x: string = "bun-ts"; console.log(x)', /^bun-ts\n$/],
		["typescript", "deno run -A", 'const x: string = "deno-ts"; console.log(x)', /^deno-ts\n$/],
		["python", "python3 -X utf8", 'print("ü")', /^ü\n$/],
	];
	for (const [id, cmd, code, expected] of cases) {
		it(`${id} with "${cmd}"`, { timeout: 60_000 }, async (t) => {
			const exe = cmd.split(" ")[0];
			try {
				execSync(`command -v ${exe}`, { stdio: "ignore" });
			} catch {
				return t.skip(`${exe} not installed here`);
			}
			const { session, out } = await run(id, code, { commands: { [id]: cmd } });
			assert.equal(session.status, "done", out);
			assert.equal(session.command, cmd);
			assert.match(session.buffer.chunks.filter((c) => c.kind === "out").map((c) => c.text).join(""), expected);
		});
	}
});

/**
 * Failures caused by this test machine rather than by Coder (no internet for package restores,
 * a distro toolchain too old for the installed JDK). These are reported as skipped, with the reason.
 */
const ENVIRONMENT_PROBLEMS: Array<[RegExp, string]> = [
	[/NU1301|Unable to load the service index/, "NuGet is offline on this machine"],
	// Reported as ClassNotFoundException, or by Scala's compile server when it is already running.
	[/javax[./]tools[./]DiagnosticListener/, "this machine's Scala 2.11 can't run on its JDK"],
	[/needs \.NET 10 or newer/, "this machine has .NET older than 10 (single-file C# needs 10+)"],
];

describe("runs snippets in many languages", () => {
	for (const [id, code, expected] of SNIPPETS) {
		it(id, { timeout: 120_000 }, async (t) => {
			if (!(await available(id))) return t.skip(`${id} not installed here`);
			const { session, out, ms } = await run(id, code);
			const envProblem = session.status === "failed" && ENVIRONMENT_PROBLEMS.find(([re]) => re.test(out));
			if (envProblem) return t.skip(envProblem[1]);
			// Java prints a JAVA_TOOL_OPTIONS notice on stderr in some CI containers; compare stdout only.
			const stdout = session.buffer.chunks.filter((c) => c.kind === "out").map((c) => c.text).join("");
			assert.equal(session.status, "done", `status ${session.status}\n${out}`);
			assert.match(stdout, expected);
			t.diagnostic(`${id}: ${ms} ms via ${session.command}`);
		});
	}
});

describe("process runner behaviour", () => {
	it("reports non-zero exit codes and stderr", { timeout: 30_000 }, async () => {
		const { session } = await run("python", 'import sys\nprint("before")\nraise SystemExit("bad things")');
		assert.equal(session.status, "failed");
		assert.equal(session.exit?.code, 1);
		const err = session.buffer.chunks.filter((c) => c.kind === "err").map((c) => c.text).join("");
		assert.match(err, /bad things/);
	});

	it("shows short file names in error messages, not temporary folders", { timeout: 30_000 }, async () => {
		const { session, out } = await run("python", "def f():\n    raise ValueError('nope')\nf()");
		assert.equal(session.status, "failed");
		assert.match(out, /File "main\.py", line 3/);
		assert.doesNotMatch(out, /obsidian-coder-/);
	});

	it("re-runs an unchanged C# block from its build cache", { timeout: 180_000 }, async (t) => {
		if (!(await available("csharp"))) return t.skip("no .NET");
		const code = `Console.WriteLine("cached ${Date.now()}");`;
		const first = await run("csharp", code);
		if (first.session.status !== "done") return t.skip(`C# unavailable here: ${first.out.slice(0, 120)}`);
		const second = await run("csharp", code);
		assert.equal(second.session.status, "done", second.out);
		t.diagnostic(`first ${first.ms} ms, second ${second.ms} ms`);
		assert.ok(second.ms < first.ms, `second run (${second.ms} ms) should be faster than the first (${first.ms} ms)`);
	});

	it("adds advice when a known problem shows up", { timeout: 30_000 }, async () => {
		const fake = `sh -c 'echo "node: bad option: --experimental-strip-types" >&2; exit 9'`;
		const { session, out } = await run("typescript", "const x: number = 1;", { commands: { typescript: fake } });
		assert.equal(session.status, "failed");
		assert.match(out, /Install tsx/);
	});

	it("PowerShell: UTF-8 output, exit codes and typed input", { timeout: 60_000 }, async (t) => {
		if (!(await available("powershell"))) return t.skip("no PowerShell");
		const arabic = await run("powershell", 'Write-Output "مرحبا بالعالم"');
		assert.equal(arabic.session.status, "done", arabic.out);
		assert.equal(arabic.out, "مرحبا بالعالم\n");
		const failed = await run("powershell", 'Write-Output "before"\nexit 3');
		assert.equal(failed.session.exit?.code, 3);
		const lang = languageById("powershell")!;
		const session = new RunSession("ps-stdin", 10_000);
		const done = startRun({ session, lang, code: '$n = Read-Host "Name"\nWrite-Output "Hi $n"', settings: settings(), desktop: true, isBlock: true });
		while (!session.handle) await new Promise((r) => setTimeout(r, 20));
		session.handle.writeStdin?.("Ahmad\n");
		await done;
		assert.match(session.buffer.toString(), /Hi Ahmad/);
	});

	it("Stop pressed while the run is still starting means it never runs", { timeout: 30_000 }, async () => {
		const lang = languageById("python")!;
		const session = new RunSession("early-stop", 10_000);
		const marker = path.join(os.tmpdir(), `coder-early-${Date.now()}`);
		const done = startRun({ session, lang, code: `open(${JSON.stringify(marker)}, "w").write("ran")`, settings: settings(), desktop: true, isBlock: true });
		session.stop(); // before the runner has found Python or spawned anything
		await done;
		assert.equal(session.status, "stopped");
		await new Promise((r) => setTimeout(r, 300));
		assert.equal(fs.existsSync(marker), false, "the program must not have run");
	});

	it("hides the JVM's JAVA_TOOL_OPTIONS notice", { timeout: 60_000 }, async (t) => {
		if (!(await available("java"))) return t.skip("no Java");
		const before = process.env.JAVA_TOOL_OPTIONS;
		const { session, out } = await run("java", 'System.out.println("hi");');
		assert.equal(session.status, "done", out);
		assert.doesNotMatch(out, /Picked up JAVA_TOOL_OPTIONS/);
		assert.equal(process.env.JAVA_TOOL_OPTIONS, before);
	});

	it("shows compiler errors and does not run", { timeout: 30_000 }, async (t) => {
		if (!(await available("c"))) return t.skip("no C compiler");
		const { session, out } = await run("c", "int x = ;");
		assert.equal(session.status, "failed");
		assert.match(out, /error/i);
	});

	it("explains when a language is not installed", { timeout: 30_000 }, async () => {
		const { session, out } = await run("python", "print(1)", { commands: { python: "definitely-not-a-real-python-xyz" } });
		assert.equal(session.status, "failed");
		assert.equal(session.exit?.code, null);
		assert.match(out, /isn't installed, or Obsidian can't find it/);
		assert.match(out, /definitely-not-a-real-python-xyz/);
	});

	it("accepts typed input on stdin", { timeout: 30_000 }, async () => {
		const lang = languageById("python")!;
		const session = new RunSession("stdin", 10_000);
		const done = startRun({ session, lang, code: 'name = input("Name? ")\nprint("Hello,", name)', settings: settings(), desktop: true, isBlock: true });
		while (!session.handle) await new Promise((r) => setTimeout(r, 20));
		session.handle.writeStdin?.("Ahmad\n");
		await done;
		assert.equal(session.status, "done");
		assert.match(session.buffer.toString(), /Name\? Hello, Ahmad\n$/);
	});

	it("Stop kills the program and everything it started", { timeout: 30_000 }, async () => {
		const lang = languageById("shell")!;
		const session = new RunSession("stop", 10_000);
		const marker = `coder-test-${process.pid}-${Date.now()}`;
		const code = `sleep 30 & # ${marker}\nwhile true; do echo tick; sleep 0.1; done`;
		const t0 = Date.now();
		const done = startRun({ session, lang, code, settings: settings(), desktop: true, isBlock: true });
		await new Promise((r) => setTimeout(r, 600));
		assert.equal(session.status, "running");
		session.stop();
		await done;
		assert.equal(session.status, "stopped");
		assert.ok(Date.now() - t0 < 5000, "stopped quickly");
		assert.match(session.buffer.toString(), /tick/);
		// Known limit on Windows: Git Bash (MSYS) moves a background job out of the Windows process
		// tree, so taskkill /T can't reach it and it outlives Stop. Stop itself still finishes.
		if (process.platform === "win32") return;
		await new Promise((r) => setTimeout(r, 300));
		const left = execSync("ps -eo args").toString().split("\n").filter((l) => l.includes("sleep 30"));
		assert.equal(left.length, 0, `orphaned processes: ${left.join(" | ")}`);
	});

	it("enforces the time limit", { timeout: 30_000 }, async () => {
		const { session, out, ms } = await run("python", "import time\nwhile True:\n    time.sleep(0.05)", { timeoutSeconds: 1 });
		assert.equal(session.status, "stopped");
		assert.match(out, /Stopped after 1 s/);
		assert.ok(ms < 5000, `took ${ms} ms`);
	});

	it("keeps memory flat when a program floods output", { timeout: 60_000 }, async () => {
		const { session, ms } = await run("python", "for i in range(300000):\n    print('line', i)", { maxOutputKB: 64 });
		assert.equal(session.status, "done");
		assert.ok(session.buffer.size <= 64 * 1024, `size ${session.buffer.size}`);
		assert.ok(session.buffer.trimmed > 0);
		assert.match(session.buffer.toString(), /line 299999\n$/);
		assert.ok(ms < 20_000, `took ${ms} ms`);
	});

	it("runs code blocks in the note's folder so relative paths work", { timeout: 30_000 }, async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coder-cwd-"));
		fs.writeFileSync(path.join(dir, "data.txt"), "from the note folder");
		const { session, out } = await run("python", "print(open('data.txt').read())", {}, { cwd: dir });
		assert.equal(session.status, "done", out);
		assert.match(out, /from the note folder/);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("runs code files in place, exactly as written", { timeout: 30_000 }, async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coder-file-"));
		const file = path.join(dir, "tool.py");
		fs.writeFileSync(file, "import os\nprint(os.path.basename(__file__), os.path.basename(os.getcwd()) == os.path.basename(os.path.dirname(__file__)))");
		const { session, out } = await run("python", fs.readFileSync(file, "utf8"), {}, { filePath: file, isBlock: false });
		assert.equal(session.status, "done", out);
		assert.match(out, /^tool\.py True\n$/);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("cleans up its temporary folders", { timeout: 30_000 }, async () => {
		const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("obsidian-coder-")).length;
		await run("python", "print(1)");
		await run("c", 'printf("x");');
		await new Promise((r) => setTimeout(r, 200));
		const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("obsidian-coder-")).length;
		assert.ok(after <= before, `temp folders left behind: ${after - before}`);
	});
});
