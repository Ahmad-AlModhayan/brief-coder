import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { previewDocument } from "../src/run/inapp";

describe("previewDocument", () => {
	it("adds a doctype and puts the bridge first for snippets", () => {
		const doc = previewDocument("<h1>Hi</h1>", "tok");
		assert.match(doc, /^<!doctype html><script>/);
		assert.ok(doc.endsWith("<h1>Hi</h1>"));
		assert.ok(doc.includes('"tok"'));
	});

	it("keeps an existing doctype first and injects into <head>", () => {
		const doc = previewDocument("<!DOCTYPE html>\n<html><head><title>x</title></head><body></body></html>", "t");
		assert.match(doc, /^<!DOCTYPE html>\n<html><head><script>/);
		assert.equal((doc.match(/<!doctype/gi) ?? []).length, 1);
	});

	it("does not mistake <header> for <head>", () => {
		const doc = previewDocument("<header>Top</header>", "t");
		assert.match(doc, /^<!doctype html><script>[\s\S]*<\/script><header>Top<\/header>$/);
	});

	it("is safe with $ patterns in the page", () => {
		const doc = previewDocument('<head data-x="$&"></head><p>$1</p>', "t");
		assert.ok(doc.includes('<head data-x="$&"><script>'));
		assert.ok(doc.endsWith("<p>$1</p>"));
	});
});

describe("htmlBridgeScript", () => {
	it("is valid JavaScript", async () => {
		const { htmlBridgeScript } = await import("../src/run/inapp");
		const js = htmlBridgeScript("tok").replace(/^<script>/, "").replace(/<\/script>$/, "");
		assert.doesNotThrow(() => new Function(js));
	});
});

describe("in-app worker", () => {
	it("its source is valid JavaScript", async () => {
		const { WORKER_SOURCE } = await import("../src/run/inapp");
		assert.doesNotThrow(() => new Function(WORKER_SOURCE));
	});
});
