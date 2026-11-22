/**
 * Reads the Jupyter notebook format (nbformat 4) into a small model the view draws from. Pure: no
 * Obsidian and no DOM, so desktop and mobile share it. The file is untrusted, so nothing here assumes
 * a field has the type the format promises, and anything unknown stays visible as a placeholder.
 */

export type MimeBundle = Record<string, string>;

export type NotebookOutput =
	| { kind: "stream"; name: string; text: string }
	| { kind: "data"; data: MimeBundle }
	| { kind: "error"; name: string; value: string; traceback: string }
	| { kind: "unknown" };

export type NotebookCell =
	| { kind: "code"; source: string; executionCount: number | null; outputs: NotebookOutput[] }
	| { kind: "markdown"; source: string; attachments: Record<string, MimeBundle> }
	| { kind: "raw"; source: string }
	| { kind: "unsupported"; source: string };

export interface Notebook {
	/** File extension for highlighting code cells, e.g. "py". */
	language: string;
	cells: NotebookCell[];
}

export type ParseResult =
	| { ok: true; notebook: Notebook }
	| { ok: false; code: "json"; reason: string }
	| { ok: false; code: "not-notebook"; reason: string }
	| { ok: false; code: "version"; reason: string; version: number };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The format stores text either as one string or as a list of lines. */
function multiline(v: unknown): string {
	if (typeof v === "string") return v;
	return Array.isArray(v) ? v.filter((x) => typeof x === "string").join("") : "";
}

function bundle(v: unknown): MimeBundle {
	const out: MimeBundle = Object.create(null) as MimeBundle;
	if (!isObject(v)) return out;
	for (const [mime, value] of Object.entries(v)) {
		// JSON outputs (application/json and friends) are stored as any JSON value, everything else as text.
		out[mime] = /json$/i.test(mime) && typeof value !== "string" ? JSON.stringify(value, null, 2) : multiline(value);
	}
	return out;
}

function readOutput(v: unknown): NotebookOutput {
	if (!isObject(v)) return { kind: "unknown" };
	switch (v.output_type) {
		case "stream":
			return { kind: "stream", name: v.name === "stderr" ? "stderr" : "stdout", text: multiline(v.text) };
		case "display_data":
		case "execute_result":
		case "update_display_data":
			return { kind: "data", data: bundle(v.data) };
		case "error":
			return {
				kind: "error",
				name: multiline(v.ename),
				value: multiline(v.evalue),
				traceback: Array.isArray(v.traceback) ? v.traceback.filter((x) => typeof x === "string").join("\n") : multiline(v.traceback),
			};
		default:
			return { kind: "unknown" };
	}
}

function readCell(v: unknown): NotebookCell {
	if (!isObject(v)) return { kind: "unsupported", source: "" };
	const source = multiline(v.source);
	switch (v.cell_type) {
		case "code":
			return {
				kind: "code",
				source,
				executionCount: typeof v.execution_count === "number" ? v.execution_count : null,
				outputs: Array.isArray(v.outputs) ? v.outputs.map(readOutput) : [],
			};
		case "markdown": {
			const attachments: Record<string, MimeBundle> = Object.create(null) as Record<string, MimeBundle>;
			if (isObject(v.attachments)) for (const [name, data] of Object.entries(v.attachments)) attachments[name] = bundle(data);
			return { kind: "markdown", source, attachments };
		}
		case "raw":
			return { kind: "raw", source };
		default:
			return { kind: "unsupported", source };
	}
}

/** Language names that don't match their file extension. */
const EXTENSION_FOR_NAME = new Map(Object.entries({ python: "py", julia: "jl", javascript: "js", typescript: "ts", ruby: "rb", rust: "rs", bash: "sh", csharp: "cs", "c#": "cs", "c++": "cpp", haskell: "hs", kotlin: "kt" }));

function readLanguage(metadata: unknown): string {
	const meta = isObject(metadata) ? metadata : {};
	const info = isObject(meta.language_info) ? meta.language_info : {};
	const kernel = isObject(meta.kernelspec) ? meta.kernelspec : {};
	const plain = (v: unknown) => (typeof v === "string" && /^[a-z0-9+#_-]{1,20}$/i.test(v) ? v.toLowerCase() : "");
	const extension = plain(typeof info.file_extension === "string" ? info.file_extension.replace(/^\./, "") : "");
	if (extension) return extension;
	const name = plain(info.name) || plain(kernel.language);
	return EXTENSION_FOR_NAME.get(name) ?? (name || "py");
}

export function parseNotebook(text: string): ParseResult {
	let root: unknown;
	try {
		root = JSON.parse(text.replace(/^\uFEFF/, ""));
	} catch (e) {
		return { ok: false, code: "json", reason: e instanceof Error ? e.message : String(e) };
	}
	if (!isObject(root) || typeof root.nbformat !== "number") return { ok: false, code: "not-notebook", reason: "no nbformat field" };
	if (root.nbformat !== 4) return { ok: false, code: "version", reason: `nbformat ${root.nbformat}`, version: root.nbformat };
	if (!Array.isArray(root.cells)) return { ok: false, code: "not-notebook", reason: "no cells" };
	try {
		return { ok: true, notebook: { language: readLanguage(root.metadata), cells: root.cells.map(readCell) } };
	} catch (e) {
		// JSON.parse takes deeper nesting than JSON.stringify can write back out.
		if (e instanceof RangeError) return { ok: false, code: "json", reason: "it's nested too deeply" };
		throw e;
	}
}
