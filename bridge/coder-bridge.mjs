#!/usr/bin/env node
/**
 * Brief Coder agent bridge: a local MCP server over stdio (newline-delimited JSON-RPC 2.0).
 * Read-only, opt-in, scoped access to an Obsidian vault. Agents may propose note changes;
 * proposals are held in <vault>/.coder/agent-changes/ until the human accepts them in the plugin.
 * No network, no dependencies. Logs go to stderr only.
 *
 * Usage: node bridge/coder-bridge.mjs --vault <abs path> [--config-dir .obsidian] [--as <agent-name>]
 */
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const VERSION = "1.1.0";
const PLUGIN_ID = "brief-coder";
const MAX_BYTES = 1024 * 1024;
const MAX_CHANGES = 50;
const MAX_BLOCKS = 500;
const TEXT_EXT = new Set(
	"md py js ts mjs cjs jsx tsx go rs java c h cpp hpp cs sh ps1 rb php lua r jl sql html css json yaml yml toml txt kt swift dart".split(" "),
);
const OFF = "The bridge is off. Turn it on in Settings → Brief Coder → Agent bridge.";
// Windows and macOS file systems ignore case, so scope checks must too.
const fold = process.platform === "linux" ? (s) => s : (s) => s.toLowerCase();

const log = (...a) => process.stderr.write(`[brief-coder-bridge] ${a.join(" ")}\n`);

// ---- arguments ----

function parseArgs(argv) {
	const out = { vault: "", configDir: ".obsidian", as: "" };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const v = argv[i + 1];
		if (a === "--vault") (out.vault = v ?? ""), i++;
		else if (a === "--config-dir") (out.configDir = v ?? ".obsidian"), i++;
		else if (a === "--as") (out.as = v ?? ""), i++;
	}
	return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.vault || !path.isAbsolute(args.vault) || !fs.existsSync(args.vault)) {
	log("usage: node coder-bridge.mjs --vault <absolute vault path> [--config-dir .obsidian] [--as <agent-name>]");
	process.exit(2);
}
const VAULT = path.resolve(args.vault);
const REAL_VAULT = fs.realpathSync(VAULT);
const CONFIG = path.join(VAULT, args.configDir, "plugins", PLUGIN_ID, "bridge.json");
const CHANGES_DIR = path.join(VAULT, ".coder", "agent-changes");
const cleanName = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
let agentName = cleanName(args.as);

// ---- config and scope ----

class ToolError extends Error {}
const fail = (msg) => {
	throw new ToolError(msg);
};

const cleanFolder = (f) => String(f).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

/** Read on every call so changes in the plugin apply live. Returns null when the bridge is off. */
function readConfig() {
	let raw;
	try {
		raw = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
	} catch {
		return null;
	}
	if (!raw || raw.enabled !== true) return null;
	const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map(cleanFolder).filter(Boolean) : []);
	return { folders: list(raw.folders), exclude: list(raw.exclude), allowProposals: raw.allowProposals === true };
}

const under = (rel, folder) => {
	const r = fold(rel);
	const f = fold(folder);
	return r === f || r.startsWith(f + "/");
};

/** Is a clean vault-relative path inside the allowed scope? */
function inScope(rel, cfg) {
	if (rel.split("/").some((s) => s.startsWith("."))) return false;
	if (cfg.exclude.some((e) => under(rel, e))) return false;
	return cfg.folders.length === 0 || cfg.folders.some((f) => under(rel, f));
}

const extOf = (p) => path.extname(p).slice(1).toLowerCase();
const isText = (p) => TEXT_EXT.has(extOf(p));

/** Normalise an agent-supplied path to clean vault-relative form, rejecting escapes. */
function cleanRel(p, what = "path") {
	if (typeof p !== "string" || !p.trim()) fail(`${what} must be a non-empty string`);
	const s = p.trim().replace(/\\/g, "/");
	if (s.startsWith("/") || /^[a-zA-Z]:/.test(s) || path.isAbsolute(p)) fail(`${what} must be relative to the vault: ${p}`);
	const segs = s.split("/").filter((x) => x && x !== ".");
	if (segs.includes("..")) fail(`${what} must not contain "..": ${p}`);
	if (segs.some((x) => x.startsWith("."))) fail(`Hidden paths are not available: ${p}`);
	return segs.join("/");
}

/** realpath of the nearest existing ancestor (or the path itself) stays inside the vault and in scope. */
function checkReal(abs, cfg, shown) {
	let probe = abs;
	while (!fs.existsSync(probe)) {
		const up = path.dirname(probe);
		if (up === probe) break;
		probe = up;
	}
	let real;
	try {
		real = fs.realpathSync(probe);
	} catch {
		fail(`Not available: ${shown}`);
	}
	const rel = path.relative(REAL_VAULT, real);
	if (rel.startsWith("..") || path.isAbsolute(rel)) fail(`Not available: ${shown}`);
	// Where the path really lands must itself be visible (a link must not lead into Private/ or .obsidian/).
	const landed = [rel, path.relative(probe, abs)].filter(Boolean).join(path.sep).split(path.sep).join("/");
	if (!landed || !inScope(landed, cfg)) fail(`Not available: ${shown}`);
}

/** Resolve a path for reading or proposing. Returns { rel, abs, exists }. */
function resolve(p, cfg, { needText = true } = {}) {
	const rel = cleanRel(p);
	if (!rel) fail("path must name a file");
	if (!inScope(rel, cfg)) fail(`Outside the folders shared with agents: ${rel}`);
	if (needText && !isText(rel)) fail(`Not a note or text code file: ${rel}`);
	const abs = path.join(VAULT, ...rel.split("/"));
	checkReal(abs, cfg, rel);
	let exists = false;
	try {
		const st = fs.statSync(abs);
		if (!st.isFile()) fail(`Not a file: ${rel}`);
		exists = true;
	} catch (e) {
		if (e instanceof ToolError) throw e;
	}
	return { rel, abs, exists };
}

function readText(abs, rel) {
	const st = fs.statSync(abs);
	if (st.size > MAX_BYTES) fail(`File is larger than 1 MB: ${rel}`);
	return fs.readFileSync(abs, "utf8");
}

/** Every readable file in scope under `folder` (or the whole scope), sorted by path. */
function listFiles(cfg, folder) {
	let roots;
	if (folder !== undefined && folder !== null && folder !== "") {
		const f = cleanRel(folder, "folder");
		roots = f ? [f] : [""];
	} else roots = cfg.folders.length ? cfg.folders : [""];
	const out = [];
	const seen = new Set();
	const walk = (rel) => {
		const abs = rel ? path.join(VAULT, ...rel.split("/")) : VAULT;
		let real;
		try {
			real = fs.realpathSync(abs);
		} catch {
			return;
		}
		const inside = path.relative(REAL_VAULT, real);
		if (inside.startsWith("..") || path.isAbsolute(inside) || seen.has(real)) return;
		seen.add(real);
		let entries;
		try {
			entries = fs.readdirSync(abs, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name.startsWith(".")) continue;
			const childRel = rel ? `${rel}/${e.name}` : e.name;
			if (cfg.exclude.some((x) => under(childRel, x))) continue;
			const childAbs = path.join(abs, e.name);
			let st;
			try {
				st = fs.statSync(childAbs);
			} catch {
				continue;
			}
			if (e.isSymbolicLink()) {
				try {
					checkReal(childAbs, cfg, childRel);
				} catch {
					continue;
				}
			}
			if (st.isDirectory()) walk(childRel);
			else if (st.isFile() && isText(childRel) && st.size <= MAX_BYTES && inScope(childRel, cfg)) out.push({ rel: childRel, abs: childAbs, st });
		}
	};
	for (const r of roots) {
		if (r && !fs.existsSync(path.join(VAULT, ...r.split("/")))) continue;
		walk(r);
	}
	return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

const clampInt = (v, dflt, max) => {
	const n = Number.isFinite(v) ? Math.floor(v) : dflt;
	return Math.max(1, Math.min(max, n));
};

// ---- text helpers ----

const ALEF = /[أإآٱ]/;

/** Lower-case + Arabic normalisation, with a map from each output char back to its source index. */
function normalise(s) {
	let text = "";
	const map = [];
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if ((c >= 0x064b && c <= 0x065f) || c === 0x0670 || c === 0x0640) continue;
		let ch = s[i];
		if (ALEF.test(ch)) ch = "ا";
		else if (c === 0x0649) ch = "ي";
		else if (c === 0x0629) ch = "ه";
		else ch = ch.toLowerCase();
		for (let k = 0; k < ch.length; k++) map.push(i);
		text += ch;
	}
	return { text, map };
}

function snippet(line, at, len) {
	if (line.length <= 200) return line.trim();
	const start = Math.max(0, Math.min(at - Math.floor((200 - len) / 2), line.length - 200));
	return line.slice(start, start + 200).trim();
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Fenced code blocks: [{line, language, title, code}] with 1-based opening-fence lines. */
function codeBlocks(text) {
	const lines = text.split(/\r?\n/);
	const blocks = [];
	for (let i = 0; i < lines.length; i++) {
		const m = FENCE_OPEN.exec(lines[i]);
		if (!m) continue;
		const fence = m[1];
		const info = m[2].trim();
		if (fence[0] === "`" && info.includes("`")) continue;
		const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
		let j = i + 1;
		while (j < lines.length && !close.test(lines[j])) j++;
		const t = /\btitle=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(info);
		blocks.push({
			line: i + 1,
			language: (info.split(/\s+/)[0] ?? "").replace(/^\{|\}$/g, ""),
			title: t ? (t[1] ?? t[2] ?? t[3]) : null,
			code: lines.slice(i + 1, j).join("\n"),
		});
		i = j;
	}
	return blocks;
}

function parseNote(content) {
	const lines = content.replace(/^﻿/, "").split(/\r?\n/);
	let frontmatter = null;
	let start = 0;
	if (lines[0] === "---") {
		const end = lines.findIndex((l, k) => k > 0 && (l === "---" || l === "..."));
		if (end > 0) (frontmatter = lines.slice(1, end).join("\n")), (start = end + 1);
	}
	const headings = [];
	const links = new Set();
	const tags = new Set();
	let fence = null;
	for (let i = start; i < lines.length; i++) {
		const line = lines[i];
		const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
		if (fence) {
			if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
			continue;
		}
		if (f) {
			fence = f[1];
			continue;
		}
		const h = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
		if (h) headings.push({ level: h[1].length, text: h[2], line: i + 1 });
		const plain = line.replace(/`[^`]*`/g, "");
		for (const m of plain.matchAll(/!?\[\[([^\]|#^]*)[^\]]*\]\]/g)) if (m[1].trim()) links.add(m[1].trim());
		for (const m of plain.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
			const target = m[1];
			if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
			try {
				links.add(decodeURI(target));
			} catch {
				links.add(target);
			}
		}
		if (!h) for (const m of plain.matchAll(/(?:^|[\s(,])#([\p{L}\p{N}_\-/]+)/gu)) if (!/^\d+$/.test(m[1])) tags.add(`#${m[1]}`);
	}
	return { frontmatter, headings, links: [...links], tags: [...tags] };
}

// ---- tools ----

const str = (description) => ({ type: "string", description });
const int = (description, dflt, max) => ({ type: "integer", description, default: dflt, minimum: 1, maximum: max });

const TOOLS = [
	{
		name: "list_notes",
		description: "List readable notes and text code files in the folders shared with agents, newest first.",
		inputSchema: { type: "object", properties: { folder: str("Vault-relative folder to list (default: all shared folders)"), limit: int("Max results", 200, 2000) } },
		run(a, cfg) {
			return listFiles(cfg, a.folder)
				.sort((x, y) => y.st.mtimeMs - x.st.mtimeMs)
				.slice(0, clampInt(a.limit, 200, 2000))
				.map((f) => ({ path: f.rel, size: f.st.size, modified: f.st.mtime.toISOString() }));
		},
	},
	{
		name: "search_notes",
		description: "Case-insensitive text search across shared notes and code files. Arabic is matched without diacritics, tatweel or letter-form differences.",
		inputSchema: {
			type: "object",
			properties: { query: str("Text to find"), folder: str("Vault-relative folder to search (default: all shared folders)"), limit: int("Max matches", 20, 100) },
			required: ["query"],
		},
		run(a, cfg) {
			if (typeof a.query !== "string" || !a.query.trim()) fail("query must be a non-empty string");
			const q = normalise(a.query.trim()).text;
			if (!q) fail("query must contain searchable characters");
			const limit = clampInt(a.limit, 20, 100);
			const hits = [];
			for (const f of listFiles(cfg, a.folder)) {
				let text;
				try {
					text = fs.readFileSync(f.abs, "utf8");
				} catch {
					continue;
				}
				const lines = text.split(/\r?\n/);
				for (let i = 0; i < lines.length; i++) {
					const n = normalise(lines[i]);
					const at = n.text.indexOf(q);
					if (at < 0) continue;
					const from = n.map[at];
					const to = n.map[at + q.length - 1] + 1;
					hits.push({ path: f.rel, line: i + 1, snippet: snippet(lines[i], from, to - from) });
					if (hits.length >= limit) return hits;
				}
			}
			return hits;
		},
	},
	{
		name: "read_note",
		description: "Read one shared note or text code file, with its frontmatter, headings, links and tags.",
		inputSchema: { type: "object", properties: { path: str("Vault-relative file path, e.g. Projects/plan.md") }, required: ["path"] },
		run(a, cfg) {
			const r = resolve(a.path, cfg);
			if (!r.exists) fail(`No such file: ${r.rel}`);
			const content = readText(r.abs, r.rel);
			const md = extOf(r.rel) === "md" ? parseNote(content) : { frontmatter: null, headings: [], links: [], tags: [] };
			return { path: r.rel, content, ...md };
		},
	},
	{
		name: "list_code_blocks",
		description: "List fenced code blocks in one note, or across shared notes, optionally filtered by language.",
		inputSchema: {
			type: "object",
			properties: {
				path: str("One note to scan (vault-relative)"),
				folder: str("Folder to scan when no path is given (default: all shared folders)"),
				language: str("Only blocks whose language matches, e.g. python"),
			},
		},
		run(a, cfg) {
			const files = a.path ? [resolve(a.path, cfg)].map((r) => (r.exists ? r : fail(`No such file: ${r.rel}`))) : listFiles(cfg, a.folder).filter((f) => extOf(f.rel) === "md");
			const lang = typeof a.language === "string" && a.language.trim() ? a.language.trim().toLowerCase() : null;
			const out = [];
			for (const f of files) {
				let text;
				try {
					text = readText(f.abs, f.rel);
				} catch (e) {
					if (a.path) throw e;
					continue;
				}
				for (const b of codeBlocks(text)) {
					if (lang && b.language.toLowerCase() !== lang) continue;
					out.push({ path: f.rel, ...b });
					if (out.length >= MAX_BLOCKS) return out;
				}
			}
			return out;
		},
	},
	{
		name: "propose_change",
		description:
			"Propose creating, replacing or deleting notes. Nothing is written to the notes: the proposal is held until the human accepts it in Brief Coder → Agent changes.",
		inputSchema: {
			type: "object",
			properties: {
				label: str("Short summary shown to the human, e.g. 'Fix typos in plan'"),
				changes: {
					type: "array",
					minItems: 1,
					maxItems: MAX_CHANGES,
					items: {
						type: "object",
						properties: {
							path: str("Vault-relative file path (.md or a text code file)"),
							content: { type: ["string", "null"], description: "Full new file content, or null to delete the file" },
						},
						required: ["path", "content"],
					},
				},
			},
			required: ["label", "changes"],
		},
		run(a, cfg) {
			if (!cfg.allowProposals) fail("Proposals are off. Turn on 'Allow proposals' in Settings → Brief Coder → Agent bridge.");
			if (typeof a.label !== "string" || !a.label.trim()) fail("label must be a non-empty string");
			if (!Array.isArray(a.changes) || a.changes.length === 0) fail("changes must be a non-empty array");
			if (a.changes.length > MAX_CHANGES) fail(`At most ${MAX_CHANGES} changes per proposal`);
			const seen = new Set();
			const entries = [];
			for (const c of a.changes) {
				if (!c || typeof c !== "object") fail("each change must be an object {path, content}");
				if (!(typeof c.content === "string" || c.content === null)) fail(`content must be a string or null: ${c.path}`);
				if (typeof c.content === "string" && Buffer.byteLength(c.content, "utf8") > MAX_BYTES) fail(`content is larger than 1 MB: ${c.path}`);
				const r = resolve(c.path, cfg);
				const key = fold(r.rel);
				if (seen.has(key)) fail(`Duplicate path: ${r.rel}`);
				seen.add(key);
				const before = r.exists ? readText(r.abs, r.rel) : null;
				if (before === null && c.content === null) fail(`Cannot delete a file that does not exist: ${r.rel}`);
				if (before !== null && c.content === before) continue;
				entries.push({
					path: r.rel,
					kind: before === null ? "added" : c.content === null ? "deleted" : "changed",
					before,
					beforeHash: before === null ? null : createHash("sha256").update(before, "utf8").digest("hex"),
					after: c.content,
					outcome: null,
				});
			}
			if (entries.length === 0) fail("nothing to change: every proposed file already has that content");
			const now = new Date();
			const id = `${now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${randomBytes(2).toString("hex")}`;
			const record = { version: 1, id, actor: `agent:${agentName || "agent"}`, label: a.label.trim(), createdAt: now.toISOString(), status: "held", decidedAt: null, entries };
			fs.mkdirSync(CHANGES_DIR, { recursive: true });
			const file = path.join(CHANGES_DIR, `${id}.json`);
			const tmp = `${file}.${process.pid}.tmp`;
			fs.writeFileSync(tmp, JSON.stringify(record, null, 2), "utf8");
			fs.renameSync(tmp, file);
			log(`held ${id} (${entries.length} file(s)) from ${record.actor}`);
			return {
				id,
				status: "held",
				entries: entries.map((e) => ({ path: e.path, kind: e.kind })),
				message: "Held for review in Brief Coder → Agent changes. Nothing was written to the notes.",
			};
		},
	},
	{
		name: "list_changes",
		description: "List proposed changes and their review status (held, accepted, rejected...), newest first.",
		inputSchema: { type: "object", properties: { status: str("Only proposals with this status, e.g. held") } },
		run(a) {
			let names = [];
			try {
				names = fs.readdirSync(CHANGES_DIR).filter((n) => n.endsWith(".json"));
			} catch {
				return [];
			}
			const out = [];
			for (const n of names) {
				let r;
				try {
					r = JSON.parse(fs.readFileSync(path.join(CHANGES_DIR, n), "utf8"));
				} catch {
					continue;
				}
				if (!r || typeof r !== "object" || !Array.isArray(r.entries)) continue;
				if (typeof a.status === "string" && a.status && r.status !== a.status) continue;
				out.push({
					id: r.id,
					actor: r.actor,
					label: r.label,
					createdAt: r.createdAt,
					status: r.status,
					entries: r.entries.map((e) => ({ path: e.path, kind: e.kind, outcome: e.outcome ?? null })),
				});
			}
			return out.sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)) || String(y.id).localeCompare(String(x.id)));
		},
	},
];

const INSTRUCTIONS =
	"Brief Coder bridge: read-only access to the folders of an Obsidian vault that the user chose to share. " +
	"Use list_notes, search_notes, read_note and list_code_blocks to read. Paths are vault-relative with forward slashes. " +
	"You cannot write notes. propose_change holds a proposal for the human to accept or reject in Brief Coder → Agent changes; " +
	"nothing changes until they do. Check list_changes for the outcome. If a tool says the bridge is off, ask the user to turn it on.";

// ---- JSON-RPC over stdio ----

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
const reply = (id, result) => send({ id, result });
const error = (id, code, message) => send({ id, error: { code, message } });

function callTool(params) {
	const tool = TOOLS.find((t) => t.name === params?.name);
	if (!tool) return { rpcError: [-32602, `Unknown tool: ${params?.name}`] };
	const text = (t) => ({ content: [{ type: "text", text: t }] });
	const cfg = readConfig();
	if (!cfg) return { ...text(OFF), isError: true };
	try {
		const a = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
		return text(JSON.stringify(tool.run(a, cfg), null, 2));
	} catch (e) {
		if (!(e instanceof ToolError)) log(`${tool.name} failed:`, e?.stack ?? e);
		return { ...text(e instanceof ToolError ? e.message : `Failed: ${e?.message ?? e}`), isError: true };
	}
}

function handle(msg) {
	if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0") return error(msg?.id ?? null, -32600, "Invalid request");
	const isRequest = msg.id !== undefined && msg.id !== null;
	if (typeof msg.method !== "string") return; // a response to us; we send no requests
	if (!isRequest) return; // notifications (initialized, cancelled...) need no reply
	switch (msg.method) {
		case "initialize": {
			const p = msg.params ?? {};
			if (!agentName) agentName = cleanName(p.clientInfo?.name) || "agent";
			return reply(msg.id, {
				protocolVersion: typeof p.protocolVersion === "string" ? p.protocolVersion : "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: { name: "brief-coder-bridge", version: VERSION },
				instructions: INSTRUCTIONS,
			});
		}
		case "ping":
			return reply(msg.id, {});
		case "tools/list":
			return reply(msg.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
		case "tools/call": {
			const r = callTool(msg.params);
			return r.rpcError ? error(msg.id, ...r.rpcError) : reply(msg.id, r);
		}
		default:
			return error(msg.id, -32601, `Method not found: ${msg.method}`);
	}
}

let buffered = "";
function onLine(line) {
	if (!line.trim()) return;
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		return error(null, -32700, "Parse error");
	}
	try {
		handle(msg);
	} catch (e) {
		log("internal error:", e?.stack ?? e);
		if (msg?.id !== undefined && msg?.id !== null) error(msg.id, -32603, "Internal error");
	}
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffered += chunk;
	let nl;
	while ((nl = buffered.indexOf("\n")) >= 0) {
		const line = buffered.slice(0, nl).replace(/\r$/, "");
		buffered = buffered.slice(nl + 1);
		onLine(line);
	}
});
process.stdin.on("end", () => {
	if (buffered) onLine(buffered.replace(/\r$/, ""));
	buffered = "";
});
process.stdout.on("error", () => process.exit(0));
log(`serving ${VAULT} (config ${CONFIG})`);
