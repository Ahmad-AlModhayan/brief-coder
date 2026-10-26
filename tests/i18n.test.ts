import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { hasArabic, setLanguage, t } from "../src/i18n";
import { inFolders, parseFolders } from "../src/util/folders";

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
	});
}

/** Every literal passed to t("…") in src/. */
function keys(): string[] {
	const out = new Set<string>();
	for (const file of sources("src")) {
		const text = readFileSync(file, "utf8");
		for (const m of text.matchAll(/\bt\(\s*(["'])((?:\\.|(?!\1).)*)\1/g)) out.add(m[2].replace(/\\(['"\\])/g, "$1"));
	}
	return Array.from(out);
}

describe("i18n", () => {
	it("every interface string has Arabic text", () => {
		const missing = keys().filter((k) => !hasArabic(k));
		assert.deepEqual(missing, []);
	});

	it("Arabic text keeps every placeholder", () => {
		setLanguage("ar");
		try {
			for (const k of keys()) {
				const vars = Object.fromEntries(Array.from(k.matchAll(/\{(\w+)\}/g), (m) => [m[1], `<${m[1]}>`]));
				const ar = t(k, vars);
				for (const name of Object.keys(vars)) assert.ok(ar.includes(`<${name}>`), `${k} → ${ar}`);
				assert.ok(!/\{\w+\}/.test(ar), `unfilled placeholder in ${ar}`);
			}
		} finally {
			setLanguage("en");
		}
	});

	it("falls back to English and fills placeholders", () => {
		setLanguage("en");
		assert.equal(t("Finished · {time}", { time: "1 s" }), "Finished · 1 s");
		assert.equal(t("No such string"), "No such string");
		setLanguage("ar");
		assert.equal(t("Run"), "تشغيل");
		setLanguage("en");
	});
});

describe("folder lists", () => {
	it("parses lines and commas, / is the whole vault", () => {
		assert.deepEqual(parseFolders("/"), [""]);
		assert.deepEqual(parseFolders("Projects/\n /Code , Notes\\Work\n\n"), ["Projects", "Code", "Notes/Work"]);
		assert.deepEqual(parseFolders(""), []);
	});

	it("matches folders by whole name", () => {
		assert.ok(inFolders("any/note.md", [""]));
		assert.ok(inFolders("Projects/a.md", ["Projects"]));
		assert.ok(inFolders("Projects/deep/a.md", ["Projects"]));
		assert.ok(!inFolders("Projects-old/a.md", ["Projects"]));
		assert.ok(!inFolders("Shared/a.md", ["Projects"]));
		assert.ok(!inFolders("a.md", []));
	});
});
