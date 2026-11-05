/**
 * Which notebooks the user trusted: vault path → SHA-256 of the contents they saw when they pressed
 * "Trust this notebook". A file that changes afterwards (sync, git pull, another program) is blocked
 * again, so trust never carries over to outputs the user hasn't seen.
 */
export type TrustStore = Record<string, string>;

const owned = (store: TrustStore, path: string) => Object.prototype.hasOwnProperty.call(store, path);

export function isNotebookTrusted(store: TrustStore, path: string, hash: string): boolean {
	return owned(store, path) && store[path] === hash;
}

export function trustNotebook(store: TrustStore, path: string, hash: string): TrustStore {
	return { ...store, [path]: hash };
}

export function revokeNotebook(store: TrustStore, path: string): TrustStore {
	const next = { ...store };
	delete next[path];
	return next;
}

export function moveNotebook(store: TrustStore, from: string, to: string): TrustStore {
	if (!owned(store, from)) return store;
	const next = revokeNotebook(store, from);
	next[to] = store[from];
	return next;
}

/** Keeps only well-formed entries from saved settings. */
export function readTrustStore(saved: unknown): TrustStore {
	if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return {};
	const out: TrustStore = {};
	for (const [path, hash] of Object.entries(saved)) if (typeof hash === "string") out[path] = hash;
	return out;
}
