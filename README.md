# Obsidian Coder

Run, view and edit code inside Obsidian. Every code block gets **Run** and **Copy**, output appears live under the block, and code files open in a real editor. It supports 40 languages and stays light: about 70 KB, with nothing running until you press Run.

![Code blocks with Run, Copy and live output](docs/code-blocks.png)

## What it does

- **Run and Copy on every code block**, in Reading view and Live Preview, including blocks inside lists and callouts.
- **Live output.**
  - Output streams in as the program prints.
  - Errors show in red, with the exit code and how long it took.
  - **Stop** ends long or stuck programs, along with anything they started.
  - Programs that ask for input (`input()`, `Scanner`, `read`) get a box to type into.
- **No boilerplate for snippets.** Go, Rust, Java, C, C++, Dart and PHP blocks run without `main`, a class or `<?php`; Coder adds them for you.
- **HTML renders as a live preview**, and its `console.log` output appears with the rest.
- **Code files open in an editor.** `.py`, `.js`, `.ts`, `.go`, `.rs`, `.java`, `.c`, `.cs`, `.sh` and more get:
  - Syntax colours from your theme, line numbers, bracket matching, search and undo.
  - **Ctrl/Cmd + Enter** to run, with output below.
- **Works on phones and tablets.** JavaScript and HTML run inside Obsidian; other languages keep their Copy button.

![A Python file open in Obsidian Coder](docs/code-file.png)

## Languages

On desktop, Coder uses the languages installed on your computer. **Settings → Obsidian Coder → Check** shows which ones it found.

| Group | Languages (code block names) |
| --- | --- |
| Built in, no install | JavaScript (`js`), HTML (`html`) |
| Scripting | Python (`python`, `py`), JavaScript with Node.js / Bun / Deno, TypeScript (`ts`), Shell (`bash`, `sh`), Zsh, Fish, PowerShell (`pwsh`), Batch (Windows), Ruby, PHP, Perl, Lua, R, Julia, AppleScript (macOS), SQL (`sql`, runs in a temporary SQLite database) |
| Compiled | Go, Rust, C, C++ (`cpp`), C# (`cs`), F#, Java, Kotlin, Scala, Groovy, Swift, Dart, Haskell, Elixir, Clojure, OCaml, Nim, Zig, Crystal, Racket, Common Lisp, Fortran, Octave / MATLAB |
| Copy only | CSS, JSON, YAML, TOML, XML, Dockerfile, Makefile, diff, LaTeX and about 70 more |

Blocks that Obsidian or other plugins render, such as `mermaid`, `dataview`, `tasks` and `query`, are left untouched.

## Install

**With BRAT (recommended until it's in the community directory)**

1. Install **BRAT** from Settings → Community plugins.
2. Run **BRAT: Add a beta plugin** and enter `Ahmad-AlModhayan/obsidian-coder`.
3. Enable **Obsidian Coder** in Settings → Community plugins.

**Manually**

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Ahmad-AlModhayan/obsidian-coder/releases/latest).
2. Put them in `<your vault>/.obsidian/plugins/coder-studio/`.
3. Reload Obsidian and enable **Obsidian Coder**.

## Using it

### Code blocks

````markdown
```python title="Squares"
print([n * n for n in range(5)])
```
````

- `title="…"` shows a name in the block's bar.
- `norun` keeps the Copy button but hides Run, for example ```` ```python norun ````.
- Output stays when you switch between Live Preview and Reading view. Clear it with **×**, or with **Clear all outputs in this note**.
- Code blocks run in the note's folder, so `open("data.csv")` reads a file next to the note. Settings can switch this to a temporary folder.

### Code files

- Code files open straight from the file list.
- To make one, run **Create new code file** and type a name such as `scratch.py` or `tools/convert.js`.
- Edits save automatically, like notes. **Ctrl/Cmd + Enter**, or ▷ in the tab header, runs the file in place.

### HTML

![HTML preview](docs/html-preview.png)

HTML blocks and `.html` files render in a sandboxed frame that grows to fit the page. Drag its bottom edge to resize it.

### Commands

- Run code block at cursor
- Run all code blocks in this note
- Copy code block at cursor
- Clear all outputs in this note
- Stop all running code
- Create new code file
- Run current code file

Assign hotkeys to any of them in Settings → Hotkeys.

## Settings

![Languages settings](docs/settings.png)

| Setting | What it does |
| --- | --- |
| Show Run and Copy bar | Turns the bar under code blocks on or off. |
| Hide Obsidian's copy button | Avoids two copy buttons on one block. |
| Click inline code to copy | In Reading view, clicking `inline code` copies it. |
| Ask before running | Asks before each run. Useful for vaults shared with other people. |
| Time limit | Stops programs after this many seconds. 0 means no limit. |
| Output kept per run | Keeps the newest output (200 KB by default), so endless printing can't slow Obsidian. |
| JavaScript runs with | Auto (Node.js if installed), Node.js, or the in-app sandbox. |
| Code files | Which extensions open in Coder's editor, plus line numbers, wrapping and tab size. |
| Languages | Per-language command, e.g. `/opt/homebrew/bin/python3.12` or `py -3.12`. |

## Safety

- **Code runs on your computer with your permissions**, the same as running it in a terminal. Only run code you trust.
- If your vault contains notes from other people, turn on **Ask before running**.
- The **in-app JavaScript sandbox** runs like JavaScript in a browser tab: it has no access to your files, your vault or Obsidian.
- **HTML previews** run in a sandboxed frame with no access to Obsidian or your files.
- Coder itself makes no network requests and collects nothing.

## Performance

Coder was built to keep Obsidian fast. Measured in Obsidian 1.13:

- **Small:** about 70 KB, with no bundled libraries. The code editor and syntax colours reuse what Obsidian already ships.
- **Quick to load:** its own startup work is a few milliseconds.
  - Desktop-only modules load the first time you press Run.
  - File types are registered in one step, so the file list refreshes once instead of 70 times.
- **Cheap in notes:**
  - A note is parsed once, however many code blocks it has.
  - Bars are added only to blocks on screen.
  - Output panels are created only after a block runs.
  - Typing in a note costs about 0.06 ms per keystroke (under 1% of the editor's own work).
- **Never blocks Obsidian:**
  - Programs run in their own process; JavaScript in a background worker; HTML previews in a separate sandboxed frame.
  - Obsidian stayed at about 60 frames per second while a program printed 300,000 lines. Output is drawn incrementally in small pages, and pages scrolled out of view aren't drawn at all.
  - Stop works at once, even while a program is still starting, and also ends anything the program started.
- **Faster re-runs:** an unchanged C#, Scala, Nim or Crystal block reuses its build cache, so C# re-runs take about 0.3 s instead of several seconds.

## Troubleshooting

- **"… isn't installed, or Obsidian can't find it"**: install the language, or enter its full path in Settings → Obsidian Coder → Languages. On macOS and Linux, Coder reads your shell's PATH, so tools from Homebrew, pyenv, nvm, cargo and similar are found automatically.
- **C#** files run with **.NET 10 or newer** (`dotnet run app.cs`). On older .NET, install `dotnet-script` and set it as the C# command.
- **Java** files run directly with **Java 11 or newer**.
- **TypeScript** needs one of `tsx`, Bun, Deno or Node.js 22.6+.
- **Windows:** Python runs through the `py` launcher, and `bash` blocks use Git Bash.

## Development

```bash
npm install
npm run dev     # rebuilds main.js on change
npm run build   # type-check + production build
npm test        # unit tests + runs real snippets in every language installed on the machine
```

- `src/languages.ts`: the language table (names, file types, commands, snippet helpers).
- `src/run/`: desktop process runner, in-app runners, output buffer and run sessions.
- `src/ui/`: code-block bar (Reading view and Live Preview), output panel, code file editor, settings.

The test suite runs snippets in 32 languages end to end, and also covers Stop, the time limit, typed input, output limits, temporary-file cleanup and error messages.

**Releasing:** run `npm version patch` (or `minor` / `major`), update `.github/RELEASE_NOTES.md`, and push to `main`. GitHub Actions builds, tests and publishes the release with `main.js`, `manifest.json` and `styles.css`.

## Name in the community directory

Obsidian's plugin directory doesn't allow "Obsidian" in plugin names. A directory submission would therefore need a different display name; the plugin ID is already `coder-studio`.

## License

[MIT](LICENSE) © Ahmad AlModhayan
