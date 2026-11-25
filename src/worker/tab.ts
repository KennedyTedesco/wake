// Wake's full-size view is a custom editor, and Orca opens an editor tab only for a file. A small
// marker file at the workspace root is that file; git never sees it, through info/exclude.
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { OpResult } from '../shared/model'
import { failure, ok } from './failure'
import type { RepoContext } from './repo'

/** The marker's name: Orca titles the tab after it. Listed in the manifest's `filenames`. */
export const TAB_FILE = 'Wake'

const NOTE =
  'This file opens Wake, the Git panel, in a full-size Orca tab.\n' +
  'Git ignores it through .git/info/exclude. You can delete it at any time.\n'

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  )
}

async function excludeFromGit(ctx: RepoContext, file: string): Promise<void> {
  const root = await realpath(ctx.root).catch(() => ctx.root)
  const pattern = `/${relative(root, file).split(sep).join('/')}`
  const exclude = join(ctx.commonDir, 'info', 'exclude')
  const current = await readFile(exclude, 'utf8').catch(() => '')
  if (current.split(/\r?\n/).includes(pattern)) return
  const separator = current && !current.endsWith('\n') ? '\n' : ''
  await mkdir(dirname(exclude), { recursive: true })
  await writeFile(
    exclude,
    `${current}${separator}# Wake opens its full-size tab from this file\n${pattern}\n`
  )
}

/**
 * Makes sure the marker exists at the workspace root and git ignores it. Answers its path
 * relative to the workspace, which `editor.open` takes.
 */
export async function prepareTabFile(
  workspacePath: string,
  ctx: RepoContext | null
): Promise<OpResult<string>> {
  const base = await realpath(workspacePath).catch(() => workspacePath)
  const file = join(base, TAB_FILE)
  if (ctx) {
    const tracked = await ctx.git.run(['ls-files', '--error-unmatch', '--', file], {
      readOnly: true
    })
    if (tracked.exitCode === 0) {
      return failure(
        'other',
        `This repository tracks a file named ${TAB_FILE}, so Wake cannot open its tab here.`
      )
    }
    await excludeFromGit(ctx, file)
  }
  if (!(await exists(file))) await writeFile(file, NOTE)
  return ok(TAB_FILE)
}
