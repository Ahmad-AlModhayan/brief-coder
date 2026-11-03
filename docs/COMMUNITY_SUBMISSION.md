# Community directory submission: Brief Coder

Status on 2026-11-03: **not submitted.** Brief Coder is released on GitHub (1.0.0, 1.0.1, 1.1.0) and installable
with BRAT, but it isn't in the Obsidian Community directory: there's no `brief-coder` entry in
`obsidianmd/obsidian-releases` `community-plugins.json`.

Obsidian changed the submission process. New plugins are no longer added by a pull request to `obsidian-releases`;
they're submitted at **[community.obsidian.md](https://community.obsidian.md)**, reviewed automatically, and the
directory shows what needs fixing. Check the current steps before submitting, since they change from time to time:

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Set up and claim](https://docs.obsidian.md/Community+directory/Set+up+and+claim)
- [Submission requirements for plugins](https://docs.obsidian.md/Community+directory/Submission+requirements+for+plugins)
- [Developer policies](https://docs.obsidian.md/Community+directory/Developer+policies)
- [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)

## 1. Requirements checklist

Checked against the pages above on 2026-11-03.

| Requirement | Brief Coder |
|---|---|
| `README.md`, `LICENSE`, `manifest.json` in the repo root | Yes. MIT, `Copyright (c) 2026 Ahmad AlModhayan`. |
| `id`: lowercase letters and hyphens, no `obsidian`, doesn't end in `plugin`, unique | `brief-coder`. Not used by any of the 9,855 plugins in the directory. |
| `name`: Basic Latin, no "Obsidian", no "Plugin", unique | `Brief Coder`. |
| `description`: action first, 250 characters at most, ends with a period, no emoji | 154 characters, starts with "Run, view and edit code". |
| `version` is `x.y.z`; the release tag equals it, no `v` | Tags `1.0.0`, `1.0.1`, `1.1.0`. `release.yml` tags and titles each release with the manifest version. |
| Release has `main.js`, `manifest.json`, `styles.css` as attachments | Yes, plus `coder-bridge.mjs`. |
| `minAppVersion` is the real minimum; `versions.json` maps older versions | 1.8.7. `eslint-plugin-obsidianmd`'s `no-unsupported-api` finds no API newer than that. `versions.json`: 1.0.x → 1.5.0, 1.1.0 → 1.8.7. |
| `isDesktopOnly`: Node.js and Electron APIs need desktop | `false`, on purpose: mobile runs JavaScript and HTML and keeps Copy for the rest. `child_process`, `fs`, `path` and `os` are loaded with `require()` on first Run only, and only when `Platform.isDesktopApp && !Platform.isMobile` (`main.ts`, `canSpawn`). See *Known questions* below. |
| `fundingUrl` only for donations | None set. |
| No obfuscation, ads, client-side telemetry, self-updating | None. The build is minified with sourcemaps off, from the public TypeScript source. |
| Disclosures in the README: network use, files outside the vault | *Safety and disclosures*: no network requests, nothing collected; temporary folders in the OS temp directory, removed after each run. |
| Plugin ID not repeated in command IDs; no default hotkeys | Command IDs are `run-*`, `stop-*` and so on; no `hotkeys`. Ctrl/Cmd+Enter is bound inside the code view only. |
| No `innerHTML`, `outerHTML`, `insertAdjacentHTML` | None. DOM is built with `createEl`, `createDiv`, `setText`. User HTML runs in a sandboxed iframe. |
| Sentence case in the UI; settings headings with `setHeading()`, no "settings" in them | Yes. |
| No global `app`; resources cleaned up on unload | `this.app` only. `registerDomEvent`, `registerView` and `onunload` dispose of sessions and mounted blocks. |
| No hardcoded styles | All styling in `styles.css`. The HTML preview's auto-height goes through a CSS variable (`setCssProps`). |
| Vault API over the adapter | Notes go through the Vault API (`vault.process`, `vault.create`, `fileManager.trashFile`). The adapter is used only for files the Vault API doesn't index: `bridge.json` in the plugin folder and held changes in `.coder/agent-changes/`. |
| Sample code removed, class names renamed | Yes. |

### Automated check

`eslint-plugin-obsidianmd` 0.4.2, `recommended` config, on 2026-11-03: **0 errors**, and these warnings, all intended:

- `no-nodejs-modules` (5, `run/process.ts`): the `require()` calls are reached only after the `Platform` check in
  `main.ts`; the rule only sees guards in the same function.
- `prefer-window-timers` (8, `run/process.ts`, `run/runner.ts`, `run/session.ts`): these timers belong to child
  processes, not to a window, and the modules are unit-tested under Node, where `window` doesn't exist.
- `prefer-create-el` (2, `ui/pagedText.ts`): output pages are built on the owner document on purpose, so the unit
  tests can drive them with a minimal fake DOM.
- `hardcoded-config-path` (4): two are UI text that names `.obsidian` as an example; one compares
  `vault.configDir` with `.obsidian` to decide whether to pass `--config-dir` to the bridge.
- `prefer-setting-definitions`, `no-deprecated` on `display()`: `getSettingDefinitions()` needs Obsidian 1.13,
  and `minAppVersion` is 1.8.7.

## 2. Release

The code reviewed by the directory is the default branch at HEAD, and users install the release whose tag equals
the manifest version. Changes made since 1.1.0 (the community-directory fixes) need a new release so the two match:

1. `npm version patch` → 1.1.1 (updates `manifest.json`, `package.json`, `versions.json`: 1.1.1 → 1.8.7).
2. Update `.github/RELEASE_NOTES.md`.
3. Merge to `main`. `release.yml` publishes release `1.1.1` with `main.js`, `manifest.json`, `styles.css` and
   `coder-bridge.mjs`.
4. Check the release page: tag exactly `1.1.1`, the three plugin files attached.

Optional but worth it: try the release on a Mac and on a phone before submitting.

## 3. Submit

1. Go to [community.obsidian.md](https://community.obsidian.md) and sign in with the Obsidian account.
2. In the profile, under **GitHub**, select **Connect** (read-only access to the public profile, to verify repo
   ownership). Turn on **Action required notifications**.
3. **Plugins** → **New plugin**:
   - **GitHub repository URL**: `https://github.com/Ahmad-AlModhayan/brief-coder`
   - **Owner**: Ahmad AlModhayan (or a KahfLabs organization, if one is set up in the directory first).
4. Agree to the Developer policies and to keep supporting the plugin, then **Submit**.
5. Read the automated review. Fix anything it flags in the repo, bump the patch version, release again; don't
   submit a second entry.

The directory reads the description from `manifest.json` and lets you edit it there; keep the two the same.

## 4. Known questions from reviewers

Answers to keep ready, in case a human reviewer asks:

- **Running code is the plugin's purpose.** It happens only when the user presses Run (or runs a command); opening,
  syncing or rendering a note never runs anything. Notes outside the user's *trusted folders* show their code and
  ask first. On desktop it starts the user's installed interpreters with `child_process`, loaded with `require()`
  only on desktop and only on first Run.
- **Why not `isDesktopOnly: true`?** On mobile, JavaScript (in a Web Worker) and HTML (in a sandboxed iframe) run,
  and other languages keep Copy and the code-file editor. Node.js is never loaded there. If the directory requires
  `isDesktopOnly: true` anyway, that drops mobile support and is a product decision.
- **Files outside the vault:** code blocks are written to a temporary folder in the OS temp directory to run; it's
  removed after each run, and old build caches after 14 days. Disclosed in the README.
- **No network requests, no telemetry.** User HTML runs in a sandboxed iframe (`allow-scripts`, no
  `allow-same-origin`); in-app JavaScript runs in a Web Worker with Node.js removed.
- **Agent bridge:** `coder-bridge.mjs` (attached to the release) is a separate, optional MCP server the user's own
  AI agent starts; the plugin never runs it. The plugin only writes its settings (`bridge.json` in the plugin
  folder) and reviews proposed changes, which are written to notes only when the user presses Accept.
- Previously released via BRAT as "Obsidian Coder" (`coder-studio`); renamed for the directory's naming rule.

## 5. After it's listed

- Change the README's install section to lead with **Settings → Community plugins → Browse → Brief Coder**, and keep
  BRAT as the way to get beta releases.
- Announce in the forum's *Share & showcase* and Discord `#updates` (needs the `developer` role). Public posts need
  Ahmad's yes.
