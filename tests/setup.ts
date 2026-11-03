import Module from "node:module";
import { join } from "node:path";

// Plugin code uses window timers (Obsidian's guidelines, for pop-out windows). Under Node, the
// global object stands in for the window.
(globalThis as { window?: unknown }).window ??= globalThis;

// The "obsidian" package has no runtime code (Obsidian provides it), so tests resolve it to a stub.
const stub = join(__dirname, "obsidianStub.ts");
const resolver = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const resolve = resolver._resolveFilename;
resolver._resolveFilename = (request, ...rest) => resolve(request === "obsidian" ? stub : request, ...rest);
