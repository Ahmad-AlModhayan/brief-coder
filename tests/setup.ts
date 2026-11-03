// Plugin code uses window timers (Obsidian's guidelines, for pop-out windows). Under Node, the
// global object stands in for the window.
(globalThis as { window?: unknown }).window ??= globalThis;
