// The repository a request works on. Handlers are plain functions over a `RepoContext`, so tests
// call them on a temp repository without Orca.
import { basename, dirname } from 'node:path'
import type { PanelEvents } from '../shared/protocol'
import { createGit, type Git, type GitConfig } from './git'

export type SyncProgress = PanelEvents['sync.progress']

export type RepoContext = {
  /** The working tree's top folder. */
  root: string
  /** This worktree's git directory (absolute). */
  gitDir: string
  /** The git directory shared by every worktree of the repository (absolute). */
  commonDir: string
  git: Git
  onProgress?: (progress: SyncProgress) => void
}

export type RepoOptions = Omit<GitConfig, 'cwd'> & {
  onProgress?: (progress: SyncProgress) => void
}

/** The repository that holds `path`, or null when it is not inside a working tree. */
export async function openRepo(
  path: string,
  options: RepoOptions = {}
): Promise<RepoContext | null> {
  const probe = createGit({ ...options, cwd: path })
  const result = await probe
    .run(
      ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'],
      {
        readOnly: true
      }
    )
    .catch(() => null)
  if (result?.exitCode !== 0) return null
  const [root, gitDir, commonDir] = result.stdout.split('\n')
  if (!root || !gitDir || !commonDir) return null
  return {
    root,
    gitDir,
    commonDir,
    git: createGit({ ...options, cwd: root }),
    onProgress: options.onProgress
  }
}

/** The repository's name: the folder that holds its shared git directory, the same for every
 *  linked worktree. */
export function repoName(ctx: RepoContext): string {
  return basename(ctx.commonDir) === '.git' ? basename(dirname(ctx.commonDir)) : basename(ctx.root)
}

/** The well-known hash of the empty tree, the "parent" of a root commit or an unborn HEAD. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
