/**
 * The agent bridge (bridge/coder-bridge.mjs) end to end: spawn the real MCP server on a temp vault
 * and talk newline-delimited JSON-RPC to it over stdio.
 */
import { strict as assert } from "node:assert";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";

const SERVER = path.resolve(__dirname, "..", "bridge", "coder-bridge.mjs");

class Client {
	private proc: ChildProcessWithoutNullStreams;
	private buf = "";
	private nextId = 1;
	private waiting = new Map<number | null, (msg: any) => void>();
	stderr = "";

	constructor(vault: string, extra: string[] = []) {
		this.proc = spawn(process.execPath, [SERVER, "--vault", vault, ...extra], { stdio: "pipe" });
		this.proc.stdout.setEncoding("utf8");
		this.proc.stdout.on("data", (chunk: string) => {
			this.buf += chunk;
			let nl;
			while ((nl = this.buf.indexOf("\n")) >= 0) {
				const msg = JSON.parse(this.buf.slice(0, nl));
				this.buf = this.buf.slice(nl + 1);
				const done = this.waiting.get(msg.id ?? null);
				this.waiting.delete(msg.id ?? null);
				done?.(msg);
			}
		});
		this.proc.stderr.on("data", (d) => (this.stderr += d));
	}

	/** Write raw text and wait for the reply with this id (null for parse errors). */
	raw(text: string, id: number | null): Promise<any> {
		return new Promise((resolve) => {
			this.waiting.set(id, resolve);
			this.proc.stdin.write(text);
		});
	}

	request(method: string, params?: unknown): Promise<any> {
		const id = this.nextId++;
		return this.raw(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n", id);
	}

	notify(method: string) {
		this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
	}

	/** tools/call → { error?: string, data?: parsed JSON } */
	async call(name: string, args: Record<string, unknown> = {}) {
		const r = await this.request("tools/call", { name, arguments: args });
		assert.ok(r.result, `no result: ${JSON.stringify(r)}`);
		const text = r.result.content[0].text;
		return r.result.isError ? { error: text as string } : { data: JSON.parse(text) };
	}

	close(): Promise<number | null> {
		return new Promise((resolve) => {
			this.proc.on("exit", (code) => resolve(code));
			this.proc.stdin.end();
		});
	}
}

let vault: string;
let outside: string;
let client: Client;
let linked = false;

const write = (rel: string, text: string) => {
	const abs = path.join(vault, ...rel.split("/"));
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, text);
};
const config = (cfg: object | null) => {
	const file = path.join(vault, ".obsidian", "plugins", "brief-coder", "bridge.json");
	if (cfg === null) fs.rmSync(file, { force: true });
	else write(".obsidian/plugins/brief-coder/bridge.json", JSON.stringify(cfg));
};
const ON = { enabled: true, folders: ["Projects", "Code"], exclude: ["Projects/Private"], allowProposals: true };

const NOTE = [
	"---",
	"tags: [demo]",
	"---",
	"# Plan",
	"Talk to مُحَمَّد about [[Roadmap|the roadmap]] and [[Ideas#Later]].",
	"See [spec](docs/spec.md) and [site](https://example.com). #project #2024 #ar/عربي",
	"## Code",
	'```python title="hello.py"',
	"# not a heading",
	'print("hi")',
	"```",
	"~~~~js",
	"console.log(1)",
	"~~~",
	"still code",
	"~~~~",
	"",
].join("\n");

before(() => {
	vault = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-vault-"));
	outside = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-outside-"));
	fs.writeFileSync(path.join(outside, "secret.md"), "outside secret");
	write("Projects/plan.md", NOTE);
	write("Projects/Private/diary.md", "private secret");
	write("Projects/.hidden/x.md", "hidden secret");
	write("Code/tool.py", "def run():\n    return 'ok'\n");
	write("Code/image.png", "not text");
	write("Other/elsewhere.md", "unshared secret");
	write(".obsidian/app.json", "{}");
	try {
		fs.symlinkSync(outside, path.join(vault, "Projects", "linked"), "junction");
		fs.symlinkSync(path.join(vault, "Projects", "Private"), path.join(vault, "Code", "sneaky"), "junction");
		linked = true;
	} catch {
		// symlinks not permitted here; the escape sub-case is skipped
	}
	client = new Client(vault, ["--as", "Test Agent!"]);
});

after(async () => {
	if (client) assert.equal(await client.close(), 0);
	fs.rmSync(vault, { recursive: true, force: true });
	fs.rmSync(outside, { recursive: true, force: true });
});

describe("bridge protocol", () => {
	it("initializes and lists tools even while off", async () => {
		config(null);
		const init = await client.request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "claude-code", version: "1" } });
		assert.equal(init.result.protocolVersion, "2025-03-26");
		assert.deepEqual(init.result.capabilities, { tools: {} });
		assert.deepEqual(init.result.serverInfo, { name: "brief-coder-bridge", version: "1.1.0" });
		assert.match(init.result.instructions, /read-only/);
		client.notify("notifications/initialized");
		assert.deepEqual((await client.request("ping")).result, {});
		const list = await client.request("tools/list");
		const names = list.result.tools.map((t: any) => t.name);
		assert.deepEqual(names, ["list_notes", "search_notes", "read_note", "list_code_blocks", "propose_change", "list_changes"]);
		for (const t of list.result.tools) assert.equal(t.inputSchema.type, "object");
	});

	it("answers unknown methods, bad JSON and CRLF / split lines", async () => {
		assert.equal((await client.request("resources/list")).error.code, -32601);
		assert.equal((await client.raw("{not json\n", null)).error.code, -32700);
		const p = client.raw('{"jsonrpc":"2.0",', 900);
		await new Promise((r) => setTimeout(r, 30));
		client["proc"].stdin.write('"id":900,"method":"ping"}\r\n');
		assert.deepEqual((await p).result, {});
		assert.equal((await client.request("tools/call", { name: "nope" })).error.code, -32602);
	});

	it("refuses every tool while the bridge is off", async () => {
		config(null);
		assert.match((await client.call("list_notes")).error!, /bridge is off/);
		config({ ...ON, enabled: false });
		assert.match((await client.call("read_note", { path: "Projects/plan.md" })).error!, /bridge is off/);
	});
});

describe("bridge reading", () => {
	before(() => config(ON));

	it("lists only shared, visible text files, newest first", async () => {
		const old = new Date(Date.now() - 60_000);
		fs.utimesSync(path.join(vault, "Code", "tool.py"), old, old);
		const { data } = await client.call("list_notes");
		assert.deepEqual(
			data.map((f: any) => f.path),
			["Projects/plan.md", "Code/tool.py"],
		);
		assert.equal(typeof data[0].size, "number");
		assert.ok(!Number.isNaN(Date.parse(data[0].modified)));
		assert.deepEqual((await client.call("list_notes", { folder: "Code", limit: 5 })).data.map((f: any) => f.path), ["Code/tool.py"]);
	});

	it("whole vault when folders is empty, still hiding excluded and dot folders", async () => {
		config({ ...ON, folders: [] });
		const paths = (await client.call("list_notes")).data.map((f: any) => f.path).sort();
		assert.deepEqual(paths, ["Code/tool.py", "Other/elsewhere.md", "Projects/plan.md"]);
		config(ON);
	});

	it("searches case-insensitively and normalises Arabic", async () => {
		const ar = (await client.call("search_notes", { query: "محمد" })).data;
		assert.equal(ar.length, 1);
		assert.equal(ar[0].path, "Projects/plan.md");
		assert.equal(ar[0].line, 5);
		assert.match(ar[0].snippet, /مُحَمَّد/);
		assert.equal((await client.call("search_notes", { query: "PRINT" })).data[0].line, 10);
		assert.equal((await client.call("search_notes", { query: "secret" })).data.length, 0);
		assert.equal((await client.call("search_notes", { query: "o", limit: 2 })).data.length, 2);
		const long = "x".repeat(500) + " needle " + "y".repeat(500);
		write("Code/long.txt", long);
		const hit = (await client.call("search_notes", { query: "needle", folder: "Code" })).data[0];
		assert.ok(hit.snippet.length <= 200 && hit.snippet.includes("needle"));
		fs.rmSync(path.join(vault, "Code", "long.txt"));
	});

	it("reads a note with frontmatter, headings, links and tags", async () => {
		const { data } = await client.call("read_note", { path: "Projects\\plan.md" });
		assert.equal(data.path, "Projects/plan.md");
		assert.equal(data.content, NOTE);
		assert.equal(data.frontmatter, "tags: [demo]");
		assert.deepEqual(data.headings, [
			{ level: 1, text: "Plan", line: 4 },
			{ level: 2, text: "Code", line: 7 },
		]);
		assert.deepEqual(data.links, ["Roadmap", "Ideas", "docs/spec.md"]);
		assert.deepEqual(data.tags, ["#project", "#ar/عربي"]);
	});

	it("lists code blocks with language and title", async () => {
		const { data } = await client.call("list_code_blocks", { path: "Projects/plan.md" });
		assert.deepEqual(data, [
			{ path: "Projects/plan.md", line: 8, language: "python", title: "hello.py", code: '# not a heading\nprint("hi")' },
			{ path: "Projects/plan.md", line: 12, language: "js", title: null, code: "console.log(1)\n~~~\nstill code" },
		]);
		const py = (await client.call("list_code_blocks", { language: "PYTHON" })).data;
		assert.equal(py.length, 1);
	});

	it("rejects paths that escape the shared scope", async () => {
		const bad = ["../outside.md", "Projects/../../x.md", "/etc/passwd", "C:\\Windows\\win.ini", ".obsidian/app.json", "Projects/Private/diary.md", "projects/private/diary.md", "Projects/.hidden/x.md", "Other/elsewhere.md", "Code/image.png"];
		if (process.platform === "linux") bad.splice(bad.indexOf("projects/private/diary.md"), 1);
		for (const p of bad) {
			const r = await client.call("read_note", { path: p });
			assert.ok(r.error, `expected ${p} to be refused`);
			assert.ok(!r.error.includes("secret"));
		}
		assert.ok((await client.call("list_notes", { folder: "../" })).error);
	});

	it("does not follow links out of the vault", async (t) => {
		if (!linked) return t.skip("could not create a symlink on this machine");
		assert.ok((await client.call("read_note", { path: "Projects/linked/secret.md" })).error);
		const paths = (await client.call("list_notes")).data.map((f: any) => f.path);
		assert.ok(!paths.some((p: string) => p.includes("linked") || p.includes("sneaky")));
		assert.equal((await client.call("search_notes", { query: "secret" })).data.length, 0);
		assert.ok((await client.call("read_note", { path: "Code/sneaky/diary.md" })).error);
		assert.ok((await client.call("propose_change", { label: "x", changes: [{ path: "Projects/linked/new.md", content: "x" }] })).error);
	});
});

describe("bridge proposals", () => {
	before(() => config(ON));
	const changesDir = () => path.join(vault, ".coder", "agent-changes");

	it("holds a proposal without touching the notes", async () => {
		const { data, error } = await client.call("propose_change", {
			label: "Tidy plan",
			changes: [
				{ path: "Projects/plan.md", content: "# Plan\nnew\n" },
				{ path: "Projects/new.md", content: "fresh" },
				{ path: "Code/tool.py", content: null },
				{ path: "Code/tool.py".replace("tool", "same"), content: "x" },
			],
		});
		assert.equal(error, undefined);
		assert.match(data.id, /^\d{8}-\d{6}-[0-9a-f]{4}$/);
		assert.equal(data.status, "held");
		assert.match(data.message, /Nothing was written/);
		assert.deepEqual(data.entries, [
			{ path: "Projects/plan.md", kind: "changed" },
			{ path: "Projects/new.md", kind: "added" },
			{ path: "Code/tool.py", kind: "deleted" },
			{ path: "Code/same.py", kind: "added" },
		]);
		assert.equal(fs.readFileSync(path.join(vault, "Projects", "plan.md"), "utf8"), NOTE);
		assert.ok(!fs.existsSync(path.join(vault, "Projects", "new.md")));
		assert.ok(fs.existsSync(path.join(vault, "Code", "tool.py")));
		assert.deepEqual(fs.readdirSync(changesDir()), [`${data.id}.json`]);
		const rec = JSON.parse(fs.readFileSync(path.join(changesDir(), `${data.id}.json`), "utf8"));
		assert.equal(rec.version, 1);
		assert.equal(rec.actor, "agent:test-agent");
		assert.equal(rec.decidedAt, null);
		assert.equal(rec.entries[0].before, NOTE);
		assert.match(rec.entries[0].beforeHash, /^[0-9a-f]{64}$/);
		assert.equal(rec.entries[1].before, null);
		assert.equal(rec.entries[1].beforeHash, null);
		assert.equal(rec.entries[2].after, null);
		assert.equal(rec.entries[0].outcome, null);
	});

	it("skips unchanged files and refuses bad proposals", async () => {
		const tool = fs.readFileSync(path.join(vault, "Code", "tool.py"), "utf8");
		const p = async (changes: unknown, label = "x") => (await client.call("propose_change", { label, changes })).error;
		assert.match((await p([{ path: "Code/tool.py", content: tool }]))!, /nothing to change/);
		assert.match((await p([{ path: "Code/missing.py", content: null }]))!, /does not exist/);
		assert.match((await p([{ path: "Code/a.py", content: "1" }, { path: "Code\\a.py", content: "2" }]))!, /Duplicate/);
		assert.ok(await p([{ path: "Projects/Private/x.md", content: "x" }]));
		assert.ok(await p([{ path: ".obsidian/plugins/x.md", content: "x" }]));
		assert.ok(await p([{ path: "../escape.md", content: "x" }]));
		assert.ok(await p([{ path: "Code/a.exe", content: "x" }]));
		assert.ok(await p([{ path: "Code/a.py" }]));
		assert.ok(await p(Array.from({ length: 51 }, (_, i) => ({ path: `Code/f${i}.py`, content: "x" }))));
		assert.ok(await p([{ path: "Code/a.py", content: "x" }], ""));
		config({ ...ON, allowProposals: false });
		assert.match((await p([{ path: "Code/a.py", content: "x" }]))!, /Proposals are off/);
		config(ON);
		assert.equal(fs.readdirSync(changesDir()).length, 1);
	});

	it("lists proposals newest first, filtered by status", async () => {
		await new Promise((r) => setTimeout(r, 1100));
		const second = (await client.call("propose_change", { label: "Second", changes: [{ path: "Code/b.py", content: "b" }] })).data;
		const all = (await client.call("list_changes")).data;
		assert.equal(all.length, 2);
		assert.equal(all[0].id, second.id);
		assert.deepEqual(all[0].entries, [{ path: "Code/b.py", kind: "added", outcome: null }]);
		assert.equal(all[1].label, "Tidy plan");
		const file = path.join(changesDir(), `${all[1].id}.json`);
		fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), status: "accepted" }));
		assert.deepEqual((await client.call("list_changes", { status: "held" })).data.map((c: any) => c.id), [second.id]);
		assert.ok(!fs.existsSync(path.join(vault, "Code", "b.py")));
	});
});
