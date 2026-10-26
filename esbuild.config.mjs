import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";
import { readFile } from "fs/promises";

/**
 * The in-app JavaScript worker is kept as readable source in src/run/inapp.ts (WORKER_SOURCE).
 * Production builds minify that text too, since esbuild leaves string contents alone.
 */
const minifyWorker = {
	name: "minify-worker",
	setup(build) {
		build.onLoad({ filter: /src[\\/]run[\\/]inapp\.ts$/ }, async (args) => {
			const source = await readFile(args.path, "utf8");
			const contents = source.replace(/String\.raw`([\s\S]*?)`;/, (_, code) => {
				const min = esbuild.transformSync(code, { minify: true, target: "es2020" }).code.trim();
				return `${JSON.stringify(min)};`;
			});
			return { contents, loader: "ts" };
		});
	},
};

const prod = process.argv[2] === "production";

const context = await esbuild.context({
	banner: {
		js: "/* Brief Coder — https://github.com/Ahmad-AlModhayan/brief-coder */",
	},
	entryPoints: ["src/main.ts"],
	bundle: true,
	// Everything below is provided by Obsidian at runtime (or is a Node built-in on desktop),
	// so it is never bundled. This keeps main.js small and avoids duplicate CodeMirror instances.
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
	],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	// Arabic interface text stays as UTF-8 (2 bytes a letter) instead of XXXX escapes (6 bytes).
	charset: "utf8",
	minify: prod,
	outfile: "main.js",
	plugins: prod ? [minifyWorker] : [],
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
