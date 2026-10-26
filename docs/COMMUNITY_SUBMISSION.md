# Community directory submission: Brief Coder

Ready to send. Nothing has been submitted. Check Obsidian's current steps first, since they change from time to time:
<https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin>.

## 1. Before submitting

1. Merge the 1.1.0 PR into `main`. `release.yml` then publishes release **`1.1.0`**: the tag and title match
   `manifest.json`, with no `v`. It attaches `main.js`, `manifest.json`, `styles.css` and `coder-bridge.mjs`.
2. Check the release page: the three plugin files are attached, and the tag is exactly `1.1.0`.
3. Optional but worth it: try the release on a Mac and on a phone, since only Windows and mobile emulation were run
   (see [TESTING.md](TESTING.md)). Then tick those boxes in the PR below.

## 2. The entry

Fork <https://github.com/obsidianmd/obsidian-releases>, and add this at the **end** of `community-plugins.json`:

```json
{
	"id": "brief-coder",
	"name": "Brief Coder",
	"author": "Ahmad AlModhayan",
	"description": "Run, view and edit code in 40 languages: Run and Copy on code blocks with live output, an editor for code files, and a local, opt-in bridge for AI agents.",
	"repo": "Ahmad-AlModhayan/obsidian-coder"
}
```

The `id`, `name`, `author` and `description` match `manifest.json` exactly. The validation bot compares them.

Checks against the directory rules:

- The ID has no "obsidian" and doesn't end in "plugin". It isn't used by any plugin in the directory: searched on
  2026-10-26, no `brief-coder` ID or "Brief Coder" name among 9,509 plugins.
- The name has no "Obsidian" and no "plugin".
- The description has no "Obsidian" and doesn't start with "This plugin". It ends with a period and is under 250
  characters (154).
- `minAppVersion` is 1.8.7, and `versions.json` maps 1.1.0 → 1.8.7. Older Obsidian keeps getting 1.0.1.
- `isDesktopOnly` is false: on mobile, JavaScript and HTML run and other languages keep Copy. Node.js modules load
  only on desktop, on first Run.
- The license is MIT, in `LICENSE`.

## 3. Pull request

**Title:** `Add plugin: Brief Coder`

**Body:**

```markdown
# I am submitting a new Community Plugin

## Repo URL

Link to my plugin: https://github.com/Ahmad-AlModhayan/obsidian-coder

## Release Checklist
- [x] I have tested the plugin on
  - [x]  Windows
  - [ ]  macOS
  - [ ]  Linux
  - [ ]  Android _(if applicable)_
  - [ ]  iOS _(if applicable)_
- [x] My GitHub release contains all required files (as individual files, not just in the source.zip / source.tar.gz)
  - [x] `main.js`
  - [x] `manifest.json`
  - [x] `styles.css` _(optional)_
- [x] GitHub release name matches the exact version number specified in my manifest.json (_**Note:** Use the exact version number, don't include a prefix `v`_)
- [x] The `id` in my `manifest.json` matches the `id` in the `community-plugins.json` file.
- [x] My README.md describes the plugin's purpose and provides clear usage instructions.
- [x] I have read the developer policies at https://docs.obsidian.md/Developer+policies, and have assessed my plugin's adherence to these policies.
- [x] I have read the tips in https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines and have self-reviewed my plugin to avoid these common pitfalls.
- [x] I have added a license in the LICENSE file.
- [x] My project respects and is compatible with the original license of any code from other plugins that I'm using.
      I have given proper attribution to these other projects in my `README.md`.

## Notes for reviewers

- **Running code is the plugin's purpose.** It happens only when the user presses Run (or runs a command); opening, syncing or rendering a note never runs anything. Notes outside the user's *trusted folders* show their code and ask first. On desktop it starts the user's installed interpreters with `child_process`, loaded with `require()` only on desktop and only on first Run.
- **Files outside the vault:** code blocks are written to a temporary folder in the OS temp directory to run; it's removed after each run, and old build caches after 14 days. Disclosed in the README.
- **No network requests, no telemetry.** User HTML runs in a sandboxed iframe (`allow-scripts`, no `allow-same-origin`); in-app JavaScript runs in a Web Worker with Node.js removed.
- **No innerHTML / outerHTML / insertAdjacentHTML** anywhere; all DOM is built with `createEl`/`createDiv`/`setText`.
- **Agent bridge:** `coder-bridge.mjs` (attached to the release) is a separate, optional MCP server the user's own AI agent starts; the plugin never runs it. The plugin only writes its settings (`bridge.json` in the plugin folder) and reviews proposed changes, which are written to notes only when the user presses Accept.
- Self-reviewed with `eslint-plugin-obsidianmd` 0.4.2 (recommended): 0 errors.
- Previously released via BRAT as "Obsidian Coder" (`coder-studio`); renamed for the directory's naming rule.
```

## 4. After submitting

- The validation bot comments within minutes. Fix anything it flags in the repo, publish a new release (bump the
  patch version), and the PR re-runs. Don't open a new PR.
- Human review can take weeks. Reviewers often ask about `child_process` and about files outside the vault. The
  notes above answer both; point them to the README's *Safety and disclosures*.
- Once it's merged, change the README's install section to lead with **Settings → Community plugins → Browse →
  Brief Coder**, and keep BRAT as the way to get beta releases.
