/**
 * Folder lists in settings (trusted folders, folders agents can read): one per line or comma
 * separated, vault-relative. "/" (or an empty line list entry of "/") means the whole vault.
 */
export function parseFolders(text: string): string[] {
	const out = new Set<string>();
	for (const raw of text.split(/[\n,]+/)) {
		const t = raw.trim();
		if (!t) continue;
		out.add(t.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
	}
	return Array.from(out);
}

/** Whether a vault path is inside one of the folders ("" is the whole vault). */
export function inFolders(path: string, folders: readonly string[]): boolean {
	return folders.some((f) => f === "" || path === f || path.startsWith(`${f}/`));
}
