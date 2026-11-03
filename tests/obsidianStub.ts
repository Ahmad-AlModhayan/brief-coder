// Stands in for the "obsidian" module under Node, which ships types only. Only what plugin code
// reaches at import time or in tests is here: the tests run as Obsidian for desktop.
export const Platform = { isDesktop: true, isDesktopApp: true, isMobile: false };
