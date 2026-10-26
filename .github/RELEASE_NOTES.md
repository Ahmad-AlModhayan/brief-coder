Obsidian Coder is now **Brief Coder**, ready for the community directory. This release adds trusted folders, an Arabic interface, and an opt-in bridge that lets local AI agents read your notes and propose changes you approve.

- **New name and ID.** The directory doesn't allow "Obsidian" in plugin names, so the plugin is now Brief Coder (`brief-coder`). Your settings from `coder-studio` are imported on first start; then remove the old plugin.
- **Trusted folders.** Notes outside the folders you trust show their code and ask before running. **Run all code blocks in this note** asks once and names what will run. By default the whole vault is trusted, so nothing changes until you set it.
- **Arabic interface.** Brief Coder follows Obsidian's language. Code stays left to right in right-to-left vaults, and Arabic output lines read right to left.
- **Agent bridge (off by default).** `coder-bridge.mjs`, attached below, is a local MCP server for Claude Code, Raqeeb and other agents. They can search and read the folders you share, and propose note changes that wait in **Agent changes** for your Accept, Reject or Revert. No network, no port.
- **Screen readers** hear run status changes, and the input box is labelled.
- **Tidier temp files.** Build caches unused for 14 days, and run folders left by a crash, are cleaned up.
- Needs Obsidian 1.8.7 or newer.

**Install:** with BRAT (`Ahmad-AlModhayan/obsidian-coder`), or download `main.js`, `manifest.json` and `styles.css` below into `<vault>/.obsidian/plugins/brief-coder/`. For the agent bridge, also put `coder-bridge.mjs` there.
