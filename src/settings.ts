import { DEFAULT_CODE_EXTENSIONS } from "./languages";

export interface CoderSettings {
	/** Show the Coder bar (language, Copy, Run, output) under code blocks. */
	showRunBar: boolean;
	/** Hide Obsidian's own copy button on code blocks (Coder's bar has one). */
	hideNativeCopy: boolean;
	/** Click inline `code` in reading view to copy it. */
	inlineCodeCopy: boolean;
	/** Ask before every run, wherever the note is. */
	confirmBeforeRun: boolean;
	/** Notes in these folders run on click; elsewhere Brief Coder shows the code and asks. "/" = whole vault. */
	trustedFolders: string;
	/** Stop a program after this many seconds (0 = never). */
	timeoutSeconds: number;
	/** Maximum output kept per run, in KB (older output is dropped first). */
	maxOutputKB: number;
	/** Working directory for code blocks: the note's folder, or a temporary folder. */
	blockWorkingDir: "note" | "temp";
	/** How JavaScript runs on desktop: auto (Node.js if installed), node, or in-app (sandboxed worker). */
	jsRuntime: "auto" | "node" | "in-app";
	/** File extensions opened in the Coder editor (comma-separated, no dots). */
	openExtensions: string;
	editorLineNumbers: boolean;
	editorWrap: boolean;
	editorTabSize: number;
	/** Per-language command overrides, e.g. { python: "/opt/homebrew/bin/python3.12" }. */
	commands: Record<string, string>;
	/** Agent bridge (coder-bridge.mjs reads these from bridge.json; off by default). */
	bridgeEnabled: boolean;
	bridgeFolders: string;
	bridgeExclude: string;
	bridgeProposals: boolean;
}

export const DEFAULT_SETTINGS: CoderSettings = {
	showRunBar: true,
	hideNativeCopy: true,
	inlineCodeCopy: false,
	confirmBeforeRun: false,
	trustedFolders: "/",
	timeoutSeconds: 0,
	maxOutputKB: 200,
	blockWorkingDir: "note",
	jsRuntime: "auto",
	openExtensions: DEFAULT_CODE_EXTENSIONS.join(", "),
	editorLineNumbers: true,
	editorWrap: false,
	editorTabSize: 4,
	commands: {},
	bridgeEnabled: false,
	bridgeFolders: "/",
	bridgeExclude: "",
	bridgeProposals: true,
};

export function parseExtensionList(value: string): string[] {
	const seen = new Set<string>();
	for (const raw of value.split(/[\s,;]+/)) {
		const ext = raw.trim().replace(/^\.+/, "").toLowerCase();
		if (ext && /^[a-z0-9+_-]+$/.test(ext)) seen.add(ext);
	}
	return Array.from(seen);
}
