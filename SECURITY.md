# Security policy

Brief Coder runs code from your notes and, if you turn it on, lets local agents read the folders you share through
the agent bridge. Flaws in either can hurt people, so please report them privately first.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:
[report a vulnerability](https://github.com/Ahmad-AlModhayan/brief-coder/security/advisories/new).

Please don't open a public issue, discussion or pull request for a security problem.

Include what you found, the steps to reproduce it, the Brief Coder and Obsidian versions, and your operating
system. A proof of concept helps; keep it to your own test vault.

## What happens next

- You get a first answer within two weeks.
- A confirmed flaw is fixed in a release before anything is said in public; the advisory is published with the
  fix, and you're credited unless you'd rather not be.

## Supported versions

Only the latest release gets security fixes. Update through Obsidian's community plugins, or from the
[latest release](https://github.com/Ahmad-AlModhayan/brief-coder/releases/latest).

## In scope

- The plugin's code runner: running something the user didn't ask to run, or outside the trusted-folder rules.
- The agent bridge (`coder-bridge.mjs`): reading folders the user kept private, writing without review, or running
  code.

Code blocks you choose to run do whatever their code does; that's the plugin's purpose, not a vulnerability.
