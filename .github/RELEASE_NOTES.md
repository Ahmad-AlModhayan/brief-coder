A performance update: lighter on long notes, phones and memory.

- **Faster typing in code blocks.** In long notes, every keystroke inside a code block used to re-read the whole note. Now only that block is read again, so each keystroke costs less than half as much as before, which you notice most on phones.
- **HTML previews load once.** In Reading view, an HTML block's page also loaded in the hidden editor, so its console output appeared twice. Previews now load only when they are on screen.
- **Nothing runs in the background.** The 10-minute clean-up timer is gone. Unused run state is cleared as you go.
- **Opening code files no longer adds to memory.** Syntax colours are set up once per language, not every time a file opens.
- Disabling Coder now also frees its stored output.

**Install:** with BRAT (`Ahmad-AlModhayan/obsidian-coder`), or download `main.js`, `manifest.json` and `styles.css` below into `<vault>/.obsidian/plugins/coder-studio/`.
