Fixes from the Obsidian Community directory review. No new features.

- **Signed build provenance:** each attached file comes with a GitHub artifact attestation. Check one with `gh attestation verify main.js -R Ahmad-AlModhayan/brief-coder`.
- Running code checks for Obsidian for desktop before it loads any Node.js module.
- On Obsidian 1.13 and later, Brief Coder's settings show up in Obsidian's settings search. Older versions show them as before.
- The stylesheet no longer uses `!important`.
- The README says when Brief Coder uses the clipboard: only when you press a copy button or run a copy command, and it never reads from it.
- Needs Obsidian 1.8.7 or newer.

**Install:** with BRAT (`Ahmad-AlModhayan/brief-coder`), or download `main.js`, `manifest.json` and `styles.css` below into your vault's `plugins/brief-coder/` folder inside Obsidian's configuration folder (`.obsidian` by default). For the agent bridge, also put `coder-bridge.mjs` there.
