import { DEFAULT_CODE_EXTENSIONS, FIRST_CODE_EXTENSIONS } from "./languages";

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
	/** Every default type this list has been given, so a type the user removed isn't added back. */
	offeredExtensions: string[];
	editorLineNumbers: boolean;
	editorWrap: boolean;
	/** Wrap long lines in prose files (txt, log...), separately from code. */
	textWrap: boolean;
	editorTabSize: number;
	/** Per-language command overrides, e.g. { python: "/opt/homebrew/bin/python3.12" }. */
	commands: Record<string, string>;
	/** Agent bridge (coder-bridge.mjs reads these from bridge.json; off by default). */
	bridgeEnabled: boolean;
	bridgeFolders: string;
	bridgeExclude: string;
	bridgeProposals: boolean;
	/** Notebooks whose saved HTML and scripts may show: vault path → hash of the contents the user trusted. */
	trustedNotebooks: Record<string, string>;
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
	offeredExtensions: DEFAULT_CODE_EXTENSIONS,
	editorLineNumbers: true,
	editorWrap: false,
	textWrap: true,
	editorTabSize: 4,
	commands: {},
	bridgeEnabled: false,
	bridgeFolders: "/",
	bridgeExclude: "",
	bridgeProposals: true,
	trustedNotebooks: {},
};

export function parseExtensionList(value: string): string[] {
	const seen = new Set<string>();
	for (const raw of value.split(/[\s,;]+/)) {
		const ext = raw.trim().replace(/^\.+/, "").toLowerCase();
		if (ext && /^[a-z0-9+_-]+$/.test(ext)) seen.add(ext);
	}
	return Array.from(seen);
}

/**
 * What to change in saved settings so the list gains default types it hasn't been offered yet.
 * Empty when there is nothing new, so an edited list is left exactly as the user wrote it.
 */
export function mergeOpenExtensions(saved: Partial<CoderSettings> | null): Partial<CoderSettings> {
	if (saved?.openExtensions === undefined) return {}; // nothing saved: the defaults apply as they are
	const offered = saved.offeredExtensions ?? FIRST_CODE_EXTENSIONS;
	const fresh = DEFAULT_CODE_EXTENSIONS.filter((ext) => !offered.includes(ext));
	if (!fresh.length) return {};
	const listed = parseExtensionList(saved.openExtensions);
	return {
		openExtensions: [saved.openExtensions.trim(), ...fresh.filter((ext) => !listed.includes(ext))].filter(Boolean).join(", "),
		offeredExtensions: [...offered, ...fresh],
	};
}

const PROSE_EXTENSIONS = ["txt", "log", "rst", "adoc", "text"];

export function wrapsLines(ext: string, s: Pick<CoderSettings, "editorWrap" | "textWrap">): boolean {
	return s.editorWrap || (s.textWrap && PROSE_EXTENSIONS.includes(ext.toLowerCase()));
}

/** Above this the code editor opens a file read-only. */
const LARGE_FILE_BYTES = 5 * 1024 * 1024;

export function isLargeFile(bytes: number): boolean {
	return bytes > LARGE_FILE_BYTES;
}

/** .ipynb opens in the notebook view unless the user listed it under Code files, or another plugin has it. */
export function claimsNotebooks(codeExtensions: Set<string>, isTaken: (ext: string) => boolean): boolean {
	return !codeExtensions.has("ipynb") && !isTaken("ipynb");
}
