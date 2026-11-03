# Changelog

Each release is on the [releases page](https://github.com/Ahmad-AlModhayan/brief-coder/releases), with `main.js`,
`manifest.json`, `styles.css` and `coder-bridge.mjs` attached. Versions follow [Semantic Versioning](https://semver.org/);
tags have no `v` prefix, as Obsidian requires.

## 1.1.1 (2026-11-03)

Fixes ahead of the Obsidian Community directory submission. No new features.

- The HTML preview's height is set through a CSS variable instead of an inline style. Dragging its edge works as before.
- Accepted agent changes to an existing note are written with Obsidian's `Vault.process`.
- **Copy config** for the agent bridge always passes `--config-dir`, so it's right for vaults with a custom
  configuration folder too.
- Settings no longer name `.obsidian` as the hidden folder agents can't read; it's "Obsidian's configuration folder",
  whatever it's called.
- Window timers, and Obsidian's DOM helpers in the output view, as the plugin guidelines ask.
- A changelog, and a FAQ in the README.

## 1.1.0 (2026-10-26)

Obsidian Coder is now **Brief Coder**, ready for the community directory.

- **New name and ID.** The directory doesn't allow "Obsidian" in plugin names, so the plugin is now Brief Coder
  (`brief-coder`). Settings from `coder-studio` are imported on first start.
- **Trusted folders.** Notes outside the folders you trust show their code and ask before running. **Run all code
  blocks in this note** asks once and names what will run.
- **Arabic interface.** Brief Coder follows Obsidian's language. Code stays left to right in right-to-left vaults, and
  Arabic output lines read right to left.
- **Agent bridge (off by default).** `coder-bridge.mjs` is a local MCP server for Claude Code, Raqeeb and other agents.
  They can search and read the folders you share, and propose note changes that wait in **Agent changes** for your
  Accept, Reject or Revert. No network, no port.
- **Screen readers** hear run status changes, and the input box is labelled.
- **Tidier temp files.** Build caches unused for 14 days, and run folders left by a crash, are cleaned up.
- Needs Obsidian 1.8.7 or newer.

## 1.0.1 (2026-10-02)

A performance update: lighter on long notes, phones and memory.

- **Faster typing in code blocks.** Only the block you're typing in is read again, not the whole note.
- **HTML previews load once**, and only when they're on screen.
- **Nothing runs in the background.** The 10-minute clean-up timer is gone.
- **Opening code files no longer adds to memory.** Syntax colours are set up once per language.
- Disabling the plugin also frees its stored output.

## 1.0.0 (2026-10-02)

First release, as Obsidian Coder (`coder-studio`).

- **Run and Copy on every code block** in Reading view and Live Preview, with live output, a box for typed input,
  Stop, exit status and timing.
- **40 languages** on desktop, using the tools installed on your computer. **JavaScript and HTML** also run on phones
  and tablets.
- **Code files** open in an editor with your theme's syntax colours. **Ctrl/Cmd + Enter** runs them.
- **Light by design:** a few milliseconds of startup work, and Obsidian stays smooth while a program prints hundreds
  of thousands of lines.
