/**
 * In-app runners that need nothing installed (desktop and mobile).
 *
 * JavaScript runs in a Web Worker: off the main thread, so a heavy or endless loop can't freeze
 * Obsidian, and Stop always works (the worker is terminated). The worker can't reach the vault,
 * the Obsidian app or (on desktop) Node.js — it behaves like JavaScript in a browser tab.
 */
import type { RunExit, RunHandle, RunSink } from "./session";

export const WORKER_SOURCE = String.raw`
"use strict";
const _st = self.setTimeout, _ct = self.clearTimeout, _si = self.setInterval, _ci = self.clearInterval;
// Output is sent in batches (every 30 ms, or each 32 KB), so even a tight printing loop sends a
// few messages per second instead of one per console.log, and Obsidian stays responsive.
let pending = [];
let pendingSize = 0;
let flushTimer = 0;
const flush = () => {
  if (flushTimer) { _ct(flushTimer); flushTimer = 0; }
  if (!pending.length) return;
  postMessage({ t: "batch", d: pending });
  pending = [];
  pendingSize = 0;
};
const send = (kind, text) => {
  const last = pending[pending.length - 1];
  if (last && last[0] === kind) last[1] += text;
  else pending.push([kind, text]);
  pendingSize += text.length;
  if (pendingSize >= 32768) flush();
  else if (!flushTimer) flushTimer = _st(flush, 30);
};
const fmt = (v, depth, seen) => {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "string") return depth === 0 ? v : JSON.stringify(v);
  if (t === "number" || t === "boolean" || t === "undefined") return String(v);
  if (t === "bigint") return v + "n";
  if (t === "symbol") return v.toString();
  if (t === "function") return "[Function " + (v.name || "anonymous") + "]";
  if (v instanceof Error) return v.stack || (v.name + ": " + v.message);
  if (seen.has(v)) return "[Circular]";
  if (depth > 3) return Array.isArray(v) ? "[Array]" : "[Object]";
  seen.add(v);
  try {
    if (Array.isArray(v)) return "[ " + v.map((x) => fmt(x, depth + 1, seen)).join(", ") + " ]";
    if (v instanceof Map) return "Map(" + v.size + ") { " + Array.from(v, ([k, x]) => fmt(k, depth + 1, seen) + " => " + fmt(x, depth + 1, seen)).join(", ") + " }";
    if (v instanceof Set) return "Set(" + v.size + ") { " + Array.from(v, (x) => fmt(x, depth + 1, seen)).join(", ") + " }";
    if (v instanceof Date) return v.toISOString();
    if (v instanceof RegExp) return String(v);
    const name = v.constructor && v.constructor !== Object ? v.constructor.name + " " : "";
    const keys = Object.keys(v);
    return name + "{ " + keys.map((k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ": " + fmt(v[k], depth + 1, seen)).join(", ") + " }";
  } finally { seen.delete(v); }
};
const line = (args) => args.map((a) => fmt(a, 0, new WeakSet())).join(" ") + "\n";
const timers = {};
const counts = {};
self.console = {
  log: (...a) => send("out", line(a)),
  info: (...a) => send("out", line(a)),
  debug: (...a) => send("out", line(a)),
  trace: (...a) => send("out", line(a)),
  dir: (v) => send("out", fmt(v, 1, new WeakSet()) + "\n"),
  table: (v) => send("out", fmt(v, 1, new WeakSet()) + "\n"),
  warn: (...a) => send("err", line(a)),
  error: (...a) => send("err", line(a)),
  assert: (ok, ...a) => { if (!ok) send("err", "Assertion failed" + (a.length ? ": " + line(a) : "\n")); },
  time: (l = "default") => { timers[l] = performance.now(); },
  timeEnd: (l = "default") => { if (l in timers) { send("out", l + ": " + (performance.now() - timers[l]).toFixed(3) + " ms\n"); delete timers[l]; } },
  count: (l = "default") => { counts[l] = (counts[l] || 0) + 1; send("out", l + ": " + counts[l] + "\n"); },
  group: () => {}, groupEnd: () => {}, clear: () => {},
};
// The run is finished when the code has returned and nothing it started is still pending:
// timers, intervals and network requests. "done" waits one more task so promise callbacks run.
let mainDone = false;
let ok = true;
let doneSent = false;
const live = new Set();
const report = (e) => { ok = false; send("err", (e && e.stack ? String(e.stack) : String(e)) + "\n"); };
const check = () => {
  if (!mainDone || live.size || doneSent) return;
  _st(() => {
    if (!mainDone || live.size || doneSent) return;
    doneSent = true;
    flush();
    postMessage({ t: "done", d: { ok } });
  }, 0);
};
const track = (p) => {
  const token = {};
  live.add(token);
  const end = () => { live.delete(token); check(); };
  Promise.resolve(p).then(end, end);
  return p;
};
self.setTimeout = (fn, ms, ...args) => {
  const id = _st(() => { live.delete(id); try { if (typeof fn === "function") fn(...args); } catch (e) { report(e); } check(); }, ms);
  live.add(id); return id;
};
self.clearTimeout = (id) => { live.delete(id); _ct(id); check(); };
self.setInterval = (fn, ms, ...args) => {
  const id = _si(() => { try { if (typeof fn === "function") fn(...args); } catch (e) { report(e); } }, ms);
  live.add(id); return id;
};
self.clearInterval = (id) => { live.delete(id); _ci(id); check(); };
if (self.fetch) { const _fetch = self.fetch; self.fetch = (...a) => track(_fetch(...a)); }
if (self.Response) {
  for (const m of ["text", "json", "arrayBuffer", "blob", "formData"]) {
    const orig = Response.prototype[m];
    if (orig) Response.prototype[m] = function (...a) { return track(orig.apply(this, a)); };
  }
}
self.addEventListener("unhandledrejection", (e) => { report(e.reason); });
// Obsidian for desktop gives workers Node.js; remove it so code here can't reach your files.
const HIDDEN = ["require", "process", "module", "exports", "global", "Buffer", "__filename", "__dirname"];
for (const k of HIDDEN) {
  try { delete self[k]; } catch (_) {}
  try { if (k in self) Object.defineProperty(self, k, { value: undefined, writable: false, configurable: false }); } catch (_) {}
}
self.onmessage = async (e) => {
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const result = await new AsyncFunction(e.data.code)();
    if (result !== undefined) send("out", fmt(result, 0, new WeakSet()) + "\n");
  } catch (err) { report(err); }
  mainDone = true;
  check();
};
`;

export function startWorkerJs(code: string, sink: RunSink): RunHandle {
	let resolveDone!: (exit: RunExit) => void;
	const done = new Promise<RunExit>((r) => (resolveDone = r));
	let worker: Worker;
	let url: string;
	try {
		url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
		worker = new Worker(url);
	} catch (e) {
		return {
			stop: () => undefined,
			done: Promise.resolve({ code: null, error: `In-app JavaScript isn't available here (${String(e)}).` }),
		};
	}
	let finished = false;
	const finish = (exit: RunExit) => {
		if (finished) return;
		finished = true;
		worker.terminate();
		URL.revokeObjectURL(url);
		resolveDone(exit);
	};
	worker.onmessage = (e: MessageEvent<{ t: string; d: unknown }>) => {
		const m = e.data;
		if (!m) return;
		if (m.t === "batch") {
			for (const [kind, text] of m.d as Array<[string, string]>) sink.write(kind === "err" ? "err" : "out", String(text));
		} else if (m.t === "done") {
			finish({ code: (m.d as { ok: boolean }).ok ? 0 : 1 });
		}
	};
	worker.onerror = (e: ErrorEvent) => {
		e.preventDefault();
		sink.write("err", `${e.message || "Error"}\n`);
		finish({ code: 1 });
	};
	worker.postMessage({ code });
	return { stop: () => finish({ code: null, signal: "SIGTERM" }), done };
}

/**
 * Script injected into HTML previews: forwards console output and errors to the output panel,
 * and reports the page height so the preview fits its content (see `previewDocument`).
 */
export function htmlBridgeScript(token: string): string {
	return `<script>(function(){var T=${JSON.stringify(token)};function p(m){m.__coder=T;try{parent.postMessage(m,"*")}catch(e){}}
var B=[],N=0,F=0,st=setTimeout;function fl(){F=0;if(B.length){p({k:"b",b:B});B=[];N=0}}
function s(k,a){var t=Array.prototype.map.call(a,function(x){try{return typeof x==="string"?x:JSON.stringify(x)}catch(e){return String(x)}}).join(" ")+"\\n";var l=B[B.length-1];if(l&&l[0]===k)l[1]+=t;else B.push([k,t]);N+=t.length;if(N>32768)fl();else if(!F)F=st(fl,30)}
["log","info","debug"].forEach(function(m){console[m]=function(){s("out",arguments)}});
["warn","error"].forEach(function(m){console[m]=function(){s("err",arguments)}});
window.addEventListener("error",function(e){s("err",[e.message+" (line "+e.lineno+")"])});
window.addEventListener("unhandledrejection",function(e){s("err",["Unhandled rejection: "+(e.reason&&e.reason.message||e.reason)])});
var last=0,q=0;function h(){q=0;var v=Math.ceil(document.documentElement.getBoundingClientRect().height);if(v!==last){last=v;p({k:"h",h:v})}}
function rq(){if(!q)q=requestAnimationFrame(h)}
window.addEventListener("load",function(){rq();try{new ResizeObserver(rq).observe(document.documentElement)}catch(e){}});})();</script>`;
}

/**
 * Builds the preview document: the bridge script goes first, and the page renders in standards
 * mode (a doctype is added when the snippet has none) so its height can be measured.
 */
export function previewDocument(html: string, token: string): string {
	const bridge = htmlBridgeScript(token);
	const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
	const body = doctype ? html.slice(doctype[0].length) : html;
	const head = /<head(?:\s[^>]*)?>/i.exec(body);
	const withBridge = head ? body.replace(head[0], () => head[0] + bridge) : bridge + body;
	return (doctype ? doctype[0] : "<!doctype html>") + withBridge;
}
