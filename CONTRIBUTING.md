# Contributing to Brief Coder

Bug reports and pull requests are welcome. Use [GitHub Issues](https://github.com/Ahmad-AlModhayan/brief-coder/issues) for bugs and ideas. Report security problems privately, as [SECURITY.md](SECURITY.md) describes.

## Set up

You need Node.js 22 (the version CI uses).

```bash
npm install
npm run dev        # rebuilds main.js on change
```

To try it in Obsidian, copy `main.js`, `manifest.json` and `styles.css` to `<a test vault>/.obsidian/plugins/brief-coder/`. Use a separate test vault.

## Check your change

CI runs these on Linux for every pull request:

```bash
npm ci
npm run build      # type-check + production build
npm run test:unit
```

CI also fails if `main.js` goes over 150 KiB.

`npm test` runs the unit tests and real snippets in every language installed on your machine. Languages that aren't installed are skipped. Run it if you change how code runs (`src/run/`, `src/languages.ts`).

[docs/TESTING.md](docs/TESTING.md) is the record of a full test run, including the checks done by hand in Obsidian. Use it as the list of what to try when you change the interface.

## Rules the tests enforce

- Every `t("…")` string in `src/` needs Arabic text in `src/i18n.ts`, and the Arabic must keep every `{placeholder}`.
- The bridge (`bridge/coder-bridge.mjs`) has no dependencies and its scope rules are tested in `tests/bridge.test.ts`.

## Pull requests

- Keep each one to one change, and link the issue it closes.
- Add a test for a bug fix or new behaviour.
- Say which systems you ran it on. CI covers Linux only, so Windows and macOS results need to come from you or a maintainer.
- Don't change the version: a new version in `manifest.json` on `main` publishes a release.

Contributions are under the [MIT licence](LICENSE).
