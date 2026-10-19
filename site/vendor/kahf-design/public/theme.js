/* Runs before first paint: applies a pinned colour scheme, if the visitor chose one. Nothing else. */
try { var s = localStorage.getItem('color-scheme'); if (s === 'light' || s === 'dark') document.querySelector('meta[name="color-scheme"]').content = s; } catch (e) {}
