# Contributing to Wake

You need Node.js 22 or later, pnpm, git, and Orca 1.4.260 or later.

## Run it

```sh
pnpm install
pnpm preview              # the panel in a browser, against a repository of your choice
pnpm dev                  # rebuild the panel on every change
orca plugin dev watch .   # load the folder into Orca and stream its logs
pnpm check                # lint, typecheck, tests and build
```

`pnpm preview` runs the real worker inside the Vite dev server, so the panel in the browser reads and changes a real repository. Set `WAKE_REPO` to the repository to show. Add `?tab` to the URL to see the full-size tab layout:

```sh
WAKE_REPO=~/code/my-app pnpm preview
# then open http://localhost:5199/tab.html?tab
```

## How the code is organized

| Path           | What it holds                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/worker/`  | The Node worker that Orca starts. One module per area: status, diff, commit, history, branches, sync, stash, conflicts, AI, review notes, tab. |
| `src/panel/`   | The React panel, built with Vite into `dist/panel`. `index.html` is the sidebar panel and `tab.html` is the full-size tab.                     |
| `src/shared/`  | The contract between the panel and the worker (`protocol.ts`, `model.ts`), and the diff parser and patch builder that both sides use.          |
| `test/`        | Integration tests that run git against temporary repositories.                                                                                 |
| `types/`       | Orca's plugin typings. `pnpm types:sync` copies them from your Orca.                                                                           |
| `docs/images/` | The icon and the screenshots for the README and the Orca plugin directory.                                                                     |

Orca transpiles the worker's TypeScript when it loads it, so the worker uses only Node built-ins. The panel is bundled. `dist/` is in git because Orca installs a plugin straight from its repository: run `pnpm build` before you commit a panel change. CI fails when `dist/` is out of date.

## Diff engine

- The worker asks git for diffs with `--diff-algorithm=histogram` and `--indent-heuristic`.
- A line selection travels as ordinals of the changed lines, together with a hash of the patch. The worker rebuilds the patch and refuses the commit when the file changed in between (`src/shared/diff/patch.ts`).
- The panel pairs removed and added lines by similarity (`src/panel/diff/align.ts`), marks changed words (`intraline.ts`), and finds moved code (`moved.ts`).
- Syntax colors come from Shiki in a web worker (`highlight.worker.ts`).

## Review notes

- The panel keeps the notes in `localStorage`, per repository (`src/panel/state/notes.ts`). Orca gives each plugin one storage, so the sidebar and the tab share the notes, and a `storage` event keeps both up to date.
- `src/panel/lib/notesFormat.ts` writes the notes in the format of Orca's own diff notes (`File:`, `Line:` or `Lines:`, `User comment:`), with the code of the noted lines.
- The worker (`src/worker/review.ts`) lists the workspace's agents with `agents.list`. It sends the text with `terminal.sendText` as one bracketed paste, then a carriage return as a second write after a short delay, as Orca does for its own notes. An escape byte in a note becomes `␛`, so a note cannot end the paste early. Orca refuses an empty `text`, so Enter cannot go as `enter: true` alone.
- **New agent** calls `agent.launch` with the agent of the `aiAgent` setting.
- `pnpm preview` answers `agents.list`, `terminal.sendText` and `agent.launch` with stubs and logs what the worker sends.

## Tests

`pnpm test` runs vitest. The worker tests create real repositories, with a bare repository as the remote, so they need `git` on your PATH. Test behavior that a person sees, such as "the commit holds only the selected lines", not the shape of internal calls.
