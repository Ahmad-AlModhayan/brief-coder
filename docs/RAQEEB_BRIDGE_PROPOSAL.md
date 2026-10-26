# Proposal for the Raqeeb repository: use the Brief Coder bridge

Status: proposal, 2026-10-26. Nothing in `raqib` was changed. This is what Raqeeb would add to use the bridge
described in [AGENT_BRIDGE.md](AGENT_BRIDGE.md).

## What Raqeeb has today (checked against the repo)

- `rqb-memory` indexes an Obsidian vault read-only as a memory source (`SourceKind::Obsidian`, `**/*.md`, excluding
  `.obsidian/**` and `.trash/**`), with Arabic-normalised FTS5 search.
- The SRS plans an MCP client in the hub (FR-T3: "connect to extra MCP servers listed in config"), not yet built.
- The whitepaper describes Raqeeb on PydanticAI with `MCPServerStdio`. The repository today is a Rust core with a
  Python LangGraph planner, so the bridge must work with either. It does: it is plain MCP over stdio.

## What to add

1. **Config (FR-T3).** One entry in `hub.toml`:

   ```toml
   [[mcp.servers]]
   name = "brief-coder"
   command = "node"
   args = ["D:/Notes/.obsidian/plugins/brief-coder/coder-bridge.mjs", "--vault", "D:/Notes", "--as", "raqeeb"]
   tier = "read"          # list_notes, search_notes, read_note, list_code_blocks, list_changes
   stage_tools = ["propose_change"]
   ```

2. **Tiering.** `propose_change` fits Raqeeb's *Tier 2: autonomous stage* exactly: it writes nothing a person sees
   until they accept it in Obsidian. The read tools are Tier 1. The bridge has no accept tool, so Tier 3 (commit)
   stays with the person, in Obsidian.

3. **Memory vs bridge.** Keep `rqb-memory` for bulk indexing and recall. Use the bridge for:
   - live reads of a note the planner is about to act on (fresher than the index), and
   - the user's sharing choices: the bridge honours **Folders to keep private** from Obsidian's settings, which the
     memory indexer doesn't know about today. Suggested follow-up: `rqb-memory` reads the same `bridge.json`
     (`folders`, `exclude`) for its Obsidian source, so one setting governs both.

4. **Reporting back.** After `propose_change`, the planner shows the returned `id` and "held for review in Brief
   Coder" in its own UI. `list_changes` with `status: "held"` tells it whether the person has decided yet, so it doesn't
   propose the same edit twice.

5. **Acceptance test (for `rqb-cli/tests/acceptance.rs`).** Make a temp vault with `bridge.json` enabled, run the
   bridge, search with Arabic diacritics, propose one change, and assert the note is unchanged and
   `.coder/agent-changes/<id>.json` exists with `actor: "agent:raqeeb"`. The bridge's own tests
   (`tests/bridge.test.ts` here) show the exact JSON-RPC exchange.

## Open questions for Raqeeb's owner

- Should Raqeeb run the bridge on the Proxmox node (vault synced there by Wasl) or on the desktop? The bridge works
  on either; held changes surface in whichever Obsidian opens the vault.
- Should the planner be allowed to propose deletions, or only edits and new notes? The bridge allows all three. A
  Raqeeb-side policy can filter `content: null` before calling it.
