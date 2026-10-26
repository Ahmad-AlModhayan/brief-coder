# Agent bridge: vault context for local agents, changes held until you say yes

Status: built in 1.1.0 (2026-10-26). Answers the whitepaper's role for this product (§2.1, row 5: *Knowledge Bridge,
feeds local codebase/note context into Raqeeb safely*), and follows the agent-change model Wasl uses
(`wasl/docs/AGENT_CHANGES.md`): an agent's changes are held, labelled with its name, and accepted or reverted by you.

## 1. Why

Agents such as Claude Code and Raqeeb work better with your notes as context: the design note next to the code,
the snippet you tested last week, the decision you wrote down. Today they either get nothing, or they get the whole
folder with full write access. The bridge sits in between:

- **Read:** an agent sees only the folders you share, never hidden folders (`.obsidian`, `.git`, `.trash`) or the
  ones you mark private.
- **Write:** an agent can only *propose*. Nothing reaches a note until you press Accept in Obsidian, and an accepted
  change can be reverted.
- **Local:** no network, no port, no account. The agent starts the bridge as a child process and talks to it over
  stdin/stdout. When the agent stops, the bridge stops.

## 2. Parts

| Part | Where | Does |
|---|---|---|
| `coder-bridge.mjs` | Release asset, and `bridge/` in the repo. Put it in `<vault>/.obsidian/plugins/brief-coder/`. | A Model Context Protocol (MCP) server over stdio. Node 18+ built-ins only, one file, about 22 KB. |
| `bridge.json` | `<vault>/.obsidian/plugins/brief-coder/bridge.json` | Written by the plugin from **Settings → Brief Coder → Agent bridge**. The bridge reads it on every request, so turning the bridge off takes effect at once. |
| `.coder/agent-changes/<id>.json` | Inside the vault (a hidden folder, so Obsidian doesn't index it) | One file per proposed changeset. Written by the bridge, then updated by the plugin when you decide. |
| **Agent changes** view | The plugin (command *Review agent changes*) | Lists changesets, shows a line diff, and offers Accept, Reject and Revert. |

The bridge is a separate file because it runs outside Obsidian (in the agent's process), and because the
community directory installs only `main.js`, `manifest.json` and `styles.css`. Keeping it out of `main.js` also keeps
the plugin under its 100 KB budget.

## 3. Setup

1. In Obsidian: **Settings → Brief Coder → Agent bridge → Let agents read this vault**. It is off by default.
2. Choose **Folders agents can read** (one per line; `/` is the whole vault) and **Folders to keep private**.
3. Download `coder-bridge.mjs` from the release into `<vault>/.obsidian/plugins/brief-coder/`.
4. Copy the config that settings shows (**Copy config**) into the agent's MCP settings. For Claude Code, that's
   `.mcp.json` in the project, or `claude mcp add`:

```json
{
  "mcpServers": {
    "brief-coder": {
      "command": "node",
      "args": ["D:\\Notes\\.obsidian\\plugins\\brief-coder\\coder-bridge.mjs", "--vault", "D:\\Notes"]
    }
  }
}
```

Add `"--as", "claude-code"` to name the agent in changesets. Without it the bridge uses the name the agent sends when
it connects (MCP `clientInfo.name`). For a vault whose config folder isn't `.obsidian`, add `"--config-dir", "<name>"`.

## 4. Tools

| Tool | Input | Returns |
|---|---|---|
| `list_notes` | `folder?`, `limit?` (200, max 2000) | `[{path, size, modified}]`, newest first. Notes and code files. |
| `search_notes` | `query`, `folder?`, `limit?` (20, max 100) | `[{path, line, snippet}]`. Case-insensitive. Arabic is normalised: diacritics and tatweel ignored, أ/إ/آ/ٱ → ا, ى → ي, ة → ه, so «محمد» finds «مُحَمَّد». |
| `read_note` | `path` | `{path, content, frontmatter, headings, links, tags}` |
| `list_code_blocks` | `path?`, `folder?`, `language?` | `[{path, line, language, title, code}]` (up to 500) |
| `propose_change` | `label`, `changes: [{path, content}]` (`content: null` deletes) | `{id, status: "held", entries}`. Writes no note. |
| `list_changes` | `status?` | Changeset summaries, newest first. |

The bridge does not run code. Running stays a human action in Obsidian, behind trusted folders.

## 5. Scope rules (enforced by the bridge, re-checked by the plugin)

- A path must be vault-relative, with forward slashes. Absolute paths, `..`, drive letters, empty segments and any
  segment starting with `.` are refused.
- It must be inside a shared folder and outside every private folder. On Windows and macOS this check ignores case,
  so `projects/private/x.md` can't get round a private `Private` folder.
- Symbolic links and junctions are followed only when their real target is inside the vault and inside the scope.
- Files over 1 MB are skipped. Only Markdown and common text code files are read or proposed.
- A proposal holds at most 50 files and needs `allowProposals` (**Let agents propose changes**, on by default once the
  bridge is on).

The plugin doesn't trust changeset files blindly: anything on the computer could write one. Before Accept writes a
file, it checks the path again (`isSafePath`) and against the bridge's *current* folders (`agentMayChange`). A path
that fails either check is refused and marked "Not allowed".

## 6. Changeset lifecycle

```
propose_change ─▶ held ─┬─ Accept ─▶ accepted / partly_accepted ─ Revert ─▶ reverted / partly_reverted
                        └─ Reject ─▶ rejected
```

- **Held:** the bridge records each file's current text (`before`, with its SHA-256) and the agent's text (`after`).
  The notes are untouched.
- **Accept** writes each `after` through Obsidian's vault API, so links, search and sync see a normal edit.
  Deletions go to the trash you chose in Obsidian's settings. A file whose current text no longer matches `before`
  (you or another tool changed it since the proposal) is **skipped** ("Skipped: the file changed after the
  proposal"), never overwritten.
- **Revert** puts `before` back for each applied file. It skips a file you edited after accepting ("Skipped: you
  edited it after accepting"). **You win** over the agent, both ways.
- **Reject** marks the changeset rejected; nothing is written.
- Changesets stay in `.coder/agent-changes/` as history. Delete the folder to clear it.
- New held changesets show a notice ("claude-code proposed 2 changes…") when you come back to Obsidian. Clicking
  the notice opens Agent changes. There are no timers or file watchers while Obsidian is idle.

## 7. Limits

- **Only you accept, by convention.** The bridge has no accept tool, so an agent can't accept through MCP. It is
  not a hard boundary, though: any program running as you can edit notes directly, or write a changeset file and wait
  for you to press Accept. The bridge narrows what a well-behaved agent does; it is not a sandbox for a hostile one.
- Changesets live in the vault, so a synced vault carries them to other devices. They can be reviewed there, but
  Accept writes on the device where you press it.
- One changeset is one proposal. There is no merge between two changesets touching the same file: the second one is
  skipped on Accept if the first changed the file.
- Desktop only: the bridge needs Node.js and the agent's computer. On mobile, the Agent changes view still works for
  changesets that synced in.

## 8. How it relates to Wasl and Raqeeb

- **Wasl** holds an agent's direct file writes in a synced folder (sessions, begin/end, revert). The bridge holds
  *proposals* that never touch the files until accepted. Both use the same words (held, accept, revert, "you win")
  and actor names (`agent:<name>`). A vault inside a Wasl pair can use both: Wasl catches agents that write directly,
  and the bridge gives well-behaved agents a way to ask first.
- **Raqeeb** already indexes Obsidian vaults read-only for its memory (`rqb-memory`, source kind `obsidian`). The
  bridge adds scoped, live reads and the held write path. What Raqeeb would need to use it is written up in
  [RAQEEB_BRIDGE_PROPOSAL.md](RAQEEB_BRIDGE_PROPOSAL.md); the Raqeeb repository is unchanged.
