Fixes ahead of the Obsidian Community directory submission. No new features.

- **HTML preview height** is set through a CSS variable instead of an inline style. Dragging the preview's edge works as before.
- **Accepted agent changes** to an existing note are written with Obsidian's `Vault.process`, as Obsidian's guidelines recommend.
- **Copy config** for the agent bridge always passes `--config-dir`, so it's right for vaults with a custom configuration folder too.
- Settings name "Obsidian's configuration folder" instead of `.obsidian`, whatever the folder is called.
- Code cleanups from Obsidian's plugin guidelines: window timers, and Obsidian's DOM helpers for output.
- A [changelog](https://github.com/Ahmad-AlModhayan/brief-coder/blob/main/CHANGELOG.md) and a FAQ in the README.
- Needs Obsidian 1.8.7 or newer.

**Install:** with BRAT (`Ahmad-AlModhayan/brief-coder`), or download `main.js`, `manifest.json` and `styles.css` below into your vault's `plugins/brief-coder/` folder inside Obsidian's configuration folder (`.obsidian` by default). For the agent bridge, also put `coder-bridge.mjs` there.
