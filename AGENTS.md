# Wake

An Orca plugin: a GitHub Desktop style Git panel. Architecture and the diff engine are in `CONTRIBUTING.md`.

## Layout

- `src/worker/`: Node worker. Orca transpiles it at load, so it imports only Node built-ins and `src/shared/`.
- `src/panel/`: React panel, bundled by Vite into `dist/`. `dist/` is committed because Orca installs straight from the repository: run `pnpm build` and commit `dist/` with every panel change. CI fails on a stale `dist/`.
- `src/shared/protocol.ts`: the one panel ↔ worker contract. A new request is a type there, a handler in `src/worker/main.ts`, and a call through `src/panel/lib/bridge.ts`.
- `types/`: Orca's typings, copied by `pnpm types:sync`. Read them before you call a host API; never guess one.

## Verify

- `pnpm check` runs lint, typecheck, tests and build. Run it before every commit.
- UI: `WAKE_REPO=<repo> pnpm preview`, then `http://localhost:5199/tab.html?tab` for the full-size tab. The preview runs the real worker; `scripts/browser-host.ts` stubs the host APIs it lacks.
- In Orca: every file change in the plugin folder needs approval again:
  `fp=$(orca plugin dev reload . --json | jq -r '.error.data.approvalFingerprint // empty'); orca plugin dev reload . --approve $fp`

## Traps

- `terminal.sendText` refuses an empty `text`, also with `enter: true`. Send `'\r'` for Enter.
- A selection carries a patch hash. The worker refuses a commit when the file changed after the selection.
- Keep `publisher` out of `orca-plugin.json`: the directory takes it from the repository owner.

## Release

Raise `version` in `orca-plugin.json` and `package.json`, commit, then push a `vX.Y.Z` tag. The Orca directory lists the newest tag of a public repository with the `orca-plugin` topic, usually within an hour. Its status page is `https://orca.dev/plugins/KennedyTedesco/wake`.

## Writing

Code, comments and docs are in English, in plain short sentences. Write a comment only for a reason or a trap the code cannot show.
