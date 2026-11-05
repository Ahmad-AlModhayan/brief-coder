import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DEFAULT_CODE_EXTENSIONS, LANGUAGES, languageForExtension } from "../src/languages";
import { canRun } from "../src/run/runner";
import { CodeView } from "../src/ui/codeView";
import { DEFAULT_SETTINGS, isLargeFile, mergeOpenExtensions, parseExtensionList, wrapsLines } from "../src/settings";

/** The list a 1.1.2 install saved, copied from that release: not derived from the code under test. */
const SAVED_1_1_2 =
	"py, pyw, js, mjs, cjs, ts, mts, cts, jsx, tsx, java, kt, kts, scala, groovy, c, h, cpp, cc, cxx, hpp, cs, fs, fsx, go, rs, swift, dart, rb, php, pl, lua, r, jl, hs, ex, exs, clj, ml, nim, zig, cr, rkt, lisp, f90, sh, bash, zsh, fish, ps1, bat, cmd, sql, json, jsonc, yaml, yml, toml, ini, xml, html, htm, css, scss, less, vue, svelte, graphql, proto";

/** Issue #13, decision 1. */
const NEW_TYPES =
	"txt log rst adoc text csv tsv json5 ndjson conf cfg env properties gradle tf hcl sass tex diff patch sol vb erl pas asm pm hh hxx csx psm1 gvy sc cljs cljc mli lsp f95 f03 applescript".split(" ");

const merge = (saved: { openExtensions?: string; offeredExtensions?: string[] } | null) => mergeOpenExtensions(saved);

describe("default file types", () => {
	it("include every type the issue names", () => {
		for (const ext of NEW_TYPES) assert.ok(DEFAULT_CODE_EXTENSIONS.includes(ext), ext);
	});

	it("leave out binary formats and Obsidian's own types", () => {
		for (const ext of ["scpt", "md", "canvas", "pdf", "png", "jpg", "base"]) assert.ok(!DEFAULT_CODE_EXTENSIONS.includes(ext), ext);
	});

	it("cover the language table, apart from binary AppleScript", () => {
		for (const lang of LANGUAGES) {
			for (const ext of lang.extensions) if (ext !== "scpt") assert.ok(DEFAULT_CODE_EXTENSIONS.includes(ext), `${lang.id}: ${ext}`);
		}
	});

	it("have no duplicates", () => {
		assert.equal(new Set(DEFAULT_CODE_EXTENSIONS).size, DEFAULT_CODE_EXTENSIONS.length);
	});
});

describe("saved file-type lists", () => {
	it("a fresh install opens .txt and has nothing left to offer", () => {
		assert.ok(parseExtensionList(DEFAULT_SETTINGS.openExtensions).includes("txt"));
		assert.deepEqual(merge(null), {});
		assert.deepEqual(DEFAULT_SETTINGS.offeredExtensions, DEFAULT_CODE_EXTENSIONS);
	});

	it("an upgrade from 1.1.2's saved default list gains the new types, in order", () => {
		const patch = merge({ openExtensions: SAVED_1_1_2 });
		const list = parseExtensionList(patch.openExtensions ?? "");
		assert.deepEqual(list.slice(0, 69), parseExtensionList(SAVED_1_1_2));
		for (const ext of NEW_TYPES) assert.ok(list.includes(ext), ext);
		assert.deepEqual(patch.offeredExtensions, DEFAULT_CODE_EXTENSIONS);
	});

	it("a type removed before the upgrade stays removed, and manual additions stay", () => {
		const saved = SAVED_1_1_2.replace("py, pyw, ", "") + ", foo, txt";
		const list = parseExtensionList(merge({ openExtensions: saved }).openExtensions ?? "");
		assert.ok(!list.includes("py"));
		assert.ok(!list.includes("pyw"));
		assert.ok(list.includes("foo"));
		assert.ok(list.includes("log"));
		assert.equal(list.filter((e) => e === "txt").length, 1);
	});

	it("a new type the user removes after the upgrade stays removed", () => {
		const upgraded = merge({ openExtensions: SAVED_1_1_2 });
		const edited = parseExtensionList(upgraded.openExtensions ?? "").filter((e) => e !== "txt").join(", ");
		assert.deepEqual(merge({ openExtensions: edited, offeredExtensions: upgraded.offeredExtensions }), {});
	});

	it("does not touch a list that has already been offered everything", () => {
		assert.deepEqual(merge({ openExtensions: "  py ;; FOO", offeredExtensions: [...DEFAULT_CODE_EXTENSIONS] }), {});
	});

	it("offers only what a later version adds, and keeps older offers on record", () => {
		const offered = [...DEFAULT_CODE_EXTENSIONS.filter((e) => e !== "txt"), "retired"];
		const patch = merge({ openExtensions: "py", offeredExtensions: offered });
		assert.equal(patch.openExtensions, "py, txt");
		assert.ok(patch.offeredExtensions?.includes("retired"));
		assert.ok(patch.offeredExtensions?.includes("txt"));
	});

	it("an emptied list gains only the new types", () => {
		assert.equal(merge({ openExtensions: "", offeredExtensions: DEFAULT_CODE_EXTENSIONS.filter((e) => e !== "log") }).openExtensions, "log");
	});
});

describe("text files", () => {
	const settings = (editorWrap: boolean, textWrap: boolean) => ({ editorWrap, textWrap });

	it("wrap by default, code doesn't", () => {
		for (const ext of ["txt", "log", "rst", "adoc", "text", "TXT"]) assert.ok(wrapsLines(ext, DEFAULT_SETTINGS), ext);
		for (const ext of ["py", "csv", "tsv", "json"]) assert.ok(!wrapsLines(ext, DEFAULT_SETTINGS), ext);
	});

	it("follow their own switch; the code switch still covers code", () => {
		assert.ok(!wrapsLines("txt", settings(false, false)));
		assert.ok(wrapsLines("txt", settings(true, false)));
		assert.ok(wrapsLines("py", settings(true, false)));
	});

	it("have no Run button", () => {
		for (const ext of ["txt", "log", "rst", "adoc", "text", "csv", "tsv", "env", "conf"]) {
			assert.equal(languageForExtension(ext), undefined, ext);
			assert.ok(!canRun(languageForExtension(ext), true), ext);
		}
	});
});

describe("large files", () => {
	const MB = 1024 * 1024;

	it("open read-only only above the limit", () => {
		assert.ok(!isLargeFile(0));
		assert.ok(!isLargeFile(5 * MB));
		assert.ok(isLargeFile(5 * MB + 1));
	});
});

describe("read-only editor", () => {
	const view = () => new CodeView({} as never, {} as never) as CodeView & { saves: number };

	it("never saves, whatever asks", async () => {
		const v = view();
		v.readOnly = true;
		await v.save();
		await v.save(true);
		assert.equal(v.saves, 0);
	});

	it("an ordinary file still saves", async () => {
		const v = view();
		await v.save();
		assert.equal(v.saves, 1);
	});
});
