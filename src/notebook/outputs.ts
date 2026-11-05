import type { MimeBundle, NotebookOutput } from "./parse";

/**
 * Decides what a saved output may show. Pure, so the rules can be tested with hostile files. Everything
 * here is untrusted: text only ever reaches the page as text, images only as checked data addresses in
 * <img> (which runs no script and loads nothing), and HTML or scripts only in a sandboxed frame, after
 * the user trusted the notebook.
 */
export type OutputPart =
	| { kind: "text"; text: string; tone: "out" | "err"; dropped: number }
	| { kind: "image"; src: string }
	| { kind: "markdown"; source: string }
	| { kind: "frame"; html: string }
	/** HTML or a script is here, held back until the user trusts the notebook. */
	| { kind: "blocked" }
	/** Nothing here can be drawn. `mime` is empty for an output the format doesn't know. */
	| { kind: "unshown"; mime: string };

const MAX_TEXT = 200_000;
const MAX_IMAGE_BASE64 = 32 * 1024 * 1024;
const MAX_SVG = 8 * 1024 * 1024;

/** Allowed types and how their bytes begin. */
const RASTER: Record<string, (b: string) => boolean> = {
	"image/png": (b) => b.startsWith("\x89PNG\r\n\x1a\n"),
	"image/jpeg": (b) => b.startsWith("\xff\xd8\xff"),
	"image/gif": (b) => b.startsWith("GIF87a") || b.startsWith("GIF89a"),
	"image/webp": (b) => b.startsWith("RIFF") && b.slice(8, 12) === "WEBP",
};
const IMAGE_ORDER = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
const SCRIPT_TYPES = ["application/javascript", "text/javascript", "application/x-javascript"];
const TEXT_TYPES = ["text/plain", "application/json", "text/latex"];

/** A `data:` address for an image, or null when the data isn't what it says it is. */
export function imageSource(mime: string, data: string): string | null {
	if (mime === "image/svg+xml") {
		if (data.length > MAX_SVG || !/<svg[\s>]/i.test(data)) return null;
		return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
	}
	const matches = Object.prototype.hasOwnProperty.call(RASTER, mime) ? RASTER[mime] : null;
	if (!matches) return null;
	if (data.length > MAX_IMAGE_BASE64 + 1024) return null;
	const base64 = data.replace(/\s+/g, "");
	if (!base64 || base64.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
	let head: string;
	try {
		head = atob(base64.slice(0, 32));
	} catch {
		return null;
	}
	return matches(head) ? `data:${mime};base64,${base64}` : null;
}

/** Text as a terminal would leave it: colour and title codes gone, and a line rewritten by \r shows its last version. */
export function cleanText(raw: string): string {
	return (
		raw
			// eslint-disable-next-line no-control-regex
			.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\^_]/g, "")
			.replace(/\r\n/g, "\n")
			.split("\n")
			.map((line) => (line.includes("\r") ? (line.slice(line.lastIndexOf("\r") + 1)) : line))
			.join("\n")
	);
}

function textPart(raw: string, tone: "out" | "err"): OutputPart {
	const text = cleanText(raw);
	return text.length > MAX_TEXT ? { kind: "text", text: text.slice(0, MAX_TEXT), tone, dropped: text.length - MAX_TEXT } : { kind: "text", text, tone, dropped: 0 };
}

const present = (data: MimeBundle, types: string[]) => types.find((m) => typeof data[m] === "string");

function bestStatic(data: MimeBundle): OutputPart | null {
	for (const mime of IMAGE_ORDER) {
		if (typeof data[mime] !== "string") continue;
		const src = imageSource(mime, data[mime]);
		if (src) return { kind: "image", src };
	}
	if (typeof data["text/markdown"] === "string") return { kind: "markdown", source: data["text/markdown"] };
	const text = present(data, TEXT_TYPES);
	return text ? textPart(data[text], "out") : null;
}

/** True for an output that shows HTML or runs a script once the notebook is trusted. */
export function isHeldBack(output: NotebookOutput): boolean {
	return output.kind === "data" && (typeof output.data["text/html"] === "string" || !!present(output.data, SCRIPT_TYPES));
}

export function planOutput(output: NotebookOutput, trusted: boolean): OutputPart[] {
	switch (output.kind) {
		case "stream":
			return [textPart(output.text, output.name === "stderr" ? "err" : "out")];
		case "error":
			return [textPart(output.traceback || `${output.name}: ${output.value}`, "err")];
		case "unknown":
			return [{ kind: "unshown", mime: "" }];
		case "data": {
			const { data } = output;
			const html = typeof data["text/html"] === "string" ? data["text/html"] : null;
			const scriptType = present(data, SCRIPT_TYPES);
			if (html !== null || scriptType) {
				if (trusted) return [{ kind: "frame", html: html ?? `<script>${data[scriptType as string].replace(/<\/(script)/gi, "<\\/$1")}</script>` }];
				const fallback = bestStatic(data);
				return fallback ? [{ kind: "blocked" }, fallback] : [{ kind: "blocked" }];
			}
			const part = bestStatic(data);
			if (part) return [part];
			return [{ kind: "unshown", mime: Object.keys(data)[0] ?? "" }];
		}
	}
}
