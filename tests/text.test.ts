import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { expandArgs, formatDuration, quoteForCmd, splitCommandLine, stripAnsi } from "../src/util/text";

describe("stripAnsi", () => {
	it("removes colours and cursor codes but keeps text", () => {
		assert.equal(stripAnsi("\u001b[31mred\u001b[0m plain \u001b[1;32mbold\u001b[22m"), "red plain bold");
		assert.equal(stripAnsi("\u001b]0;title\u0007after"), "after");
		assert.equal(stripAnsi("no codes"), "no codes");
	});
});

describe("splitCommandLine", () => {
	it("splits words and honours quotes", () => {
		assert.deepEqual(splitCommandLine("py -3"), ["py", "-3"]);
		assert.deepEqual(splitCommandLine('"C:\\Program Files\\Python\\python.exe" -X utf8'), ["C:\\Program Files\\Python\\python.exe", "-X", "utf8"]);
		assert.deepEqual(splitCommandLine("  node   --no-warnings  "), ["node", "--no-warnings"]);
		assert.deepEqual(splitCommandLine("echo ''"), ["echo", ""]);
		assert.deepEqual(splitCommandLine("'/opt/my tools/bin/ruby'"), ["/opt/my tools/bin/ruby"]);
		assert.deepEqual(splitCommandLine(""), []);
	});
});

describe("expandArgs", () => {
	it("replaces known placeholders only", () => {
		assert.deepEqual(expandArgs(["{file}", "-o", "{out}", "{unknown}", "x{dir}y"], { file: "/t/main.c", out: "/t/main", dir: "/t" }), [
			"/t/main.c",
			"-o",
			"/t/main",
			"{unknown}",
			"x/ty",
		]);
	});
});

describe("quoteForCmd", () => {
	it("quotes only when needed", () => {
		assert.equal(quoteForCmd("tsx"), "tsx");
		assert.equal(quoteForCmd("C:\\Users\\me\\a b.ts"), '"C:\\Users\\me\\a b.ts"');
		assert.equal(quoteForCmd('say "hi"'), '"say ""hi"""');
		assert.equal(quoteForCmd(""), '""');
		assert.equal(quoteForCmd("a&b"), '"a&b"');
	});
});

describe("formatDuration", () => {
	it("is short and readable", () => {
		assert.equal(formatDuration(0), "0 ms");
		assert.equal(formatDuration(312.4), "312 ms");
		assert.equal(formatDuration(1234), "1.23 s");
		assert.equal(formatDuration(12_345), "12.3 s");
		assert.equal(formatDuration(125_000), "2 min 5 s");
	});
});
