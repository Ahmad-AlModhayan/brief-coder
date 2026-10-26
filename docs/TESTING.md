# Test record: Brief Coder 1.1.0

Run on 2026-10-26, Windows 11 Pro (10.0.26300), Node 24.5, Obsidian 1.14.5 desktop.

## 1. Unit tests (`npm run test:unit`, also in CI)

101 tests, all passing. New in 1.1.0:

| File | Covers |
|---|---|
| `tests/bridge.test.ts` | The bridge over real stdio: off by default, `initialize`/`tools/list`, scoped listing and search (Arabic normalised), `read_note`, code blocks, every path escape (`..`, absolute, drive letters, `.obsidian`, private folders, case tricks, junctions out of the vault), held proposals that leave notes untouched, refusal cases, `list_changes`. |
| `tests/agent.test.ts` | Accept, reject and revert; conflicts on accept; "you win" on revert; refusing unsafe paths and paths outside the bridge's folders; SHA-256 matches Node's; line diff and hunks; a 5,000-line diff under 500 ms. |
| `tests/i18n.test.ts` | Every `t("…")` string in `src/` has Arabic text, Arabic keeps every `{placeholder}`, English fallback; trusted-folder parsing and matching. |
| `tests/prune.test.ts` | Build caches unused for 14 days and run folders a crash left behind are removed; fresh ones stay. |

`npm test` also runs real snippets in every language installed on the machine (`tests/runners.test.ts`); that suite is unchanged in 1.1.0.

## 2. Obsidian's directory lint

`eslint-plugin-obsidianmd` 0.4.2 (recommended config, the rules the directory's review bot uses) over `src/`:
**0 errors.** The remaining warnings are:

- `no-undef` for `process`/`NodeJS`: false positives in TypeScript files.
- `prefer-window-timers` in code that also runs under Node in tests.
- `prefer-create-el` in `pagedText.ts`, which uses plain DOM so it can be unit-tested.
- The 1.13 declarative settings API: needs `minAppVersion` 1.13.

## 3. Real runs in Obsidian

The test used a separate Obsidian profile (`--user-data-dir=D:\WaslTest\obsidian-profile`) and a fresh vault at
`D:\WaslTest\obsidian-test-vault`. Nothing touched the everyday Obsidian profile or its vaults. The run was driven
through the Chrome DevTools protocol: it clicked the real buttons, read the real DOM and took screenshots.

| Check | Result |
|---|---|
| Plugin enables from restricted mode, all 8 commands registered | ✓ (5.8 ms first enable; 33 ms for a later disable + enable cycle) |
| Python block (Reading view) | ✓ `[0, 1, 4, 9, 16]`, Finished · 95–105 ms |
| JavaScript block | ✓ Node.js on desktop |
| HTML block | ✓ sandboxed iframe, `console.log` reaches the output |
| Typed input (`input()`) | ✓ "Name? Ahmad / Hi Ahmad" |
| Bash block (Git Bash) | ✓ three lines over 3.15 s, streamed |
| Endless `print` loop, then Stop | ✓ 76 frames in the measured second during the flood; Stop in about 0.3 s; 6.87 M earlier characters dropped by the output limit; no `python.exe` left behind |
| Code file (`tool.py`) via *Run current code file* | ✓ |
| Live Preview bars | ✓ (drawn for blocks on screen only) |
| Note outside trusted folders | ✓ dialog shows the note path and the code; Cancel runs nothing |
| Note inside trusted folders | ✓ runs without a dialog |
| *Run all code blocks in this note* | ✓ asks once: "Run 6 code blocks… Python ×3, JavaScript, HTML, Shell" |
| Screen reader status (`role=status`, `aria-live=polite`), input label | ✓ |
| Arabic interface (Obsidian language: العربية) + right-to-left vault | ✓ bar, status, commands and Agent changes in Arabic; code left to right; Arabic output line right to left; mixed line left to right ([screenshot](arabic-rtl.png)) |
| Mobile emulation (`app.emulateMobile(true)`) | ✓ Run only on JavaScript and HTML; JS ran in the sandboxed worker |
| Sandbox in the built (minified) worker | ✓ `typeof require, process, app, document` are all `undefined`; timers work |
| Bridge config written from settings | ✓ `bridge.json` matches the settings |
| Agent via MCP (Node client → installed `coder-bridge.mjs`) | ✓ six tools; Arabic search; `Private/` and `.obsidian/` refused; proposal held, note untouched |
| Notice for a new proposal, click opens Agent changes | ✓ |
| Diff, Accept, then Revert | ✓ note changed, then restored exactly; the new note went to the trash ([screenshot](agent-changes.png)) |
| Revert after you edit an accepted note | ✓ your edit kept ("Skipped: you edited it after accepting"), other file reverted |

### Bugs the real runs found (all fixed, then re-run)

1. The Agent changes view never rendered: a field named `open` replaced `View.open()`.
2. Clicking a notice's padding didn't open the view, because `noticeEl` is only the text since Obsidian 1.8.
3. Arabic output lines kept the panel's direction. `unicode-bidi` isn't inherited, so it now sits on the page blocks.
4. In a right-to-left vault, Obsidian mirrored code blocks. Code with the bar now stays left to right.
5. `import()` of Node's built-in modules doesn't resolve in Obsidian's renderer, so every desktop run failed. Unit tests
   can't see this, because they run under Node. It's back to a guarded `require()`.

## 4. Not verified

- **macOS, Linux, iOS and Android hardware.** Only Windows was run here. Mobile was checked with Obsidian's mobile
  emulation, which hides Node.js the same way, but not on a real phone.
- **Obsidian versions other than 1.14.5,** including the new minimum, 1.8.7.
- **A screen reader in use.** The attributes are checked, but not the experience with NVDA or VoiceOver.
- **Claude Code and Raqeeb connected for real.** The bridge was driven by a scripted MCP client and the unit tests,
  not by either agent.
- **The language suite** (`tests/runners.test.ts`) was not re-run for 1.1.0; the process runner's run path changed
  only in how Node modules load, and that path was exercised in Obsidian with Python, Bash, JavaScript and Stop.
