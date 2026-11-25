// Throwaway git repositories for tests: real git, no mocks.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export type Fixture = {
  root: string
  git(...args: string[]): string
  write(path: string, content: string): void
  read(path: string): string
  commitAll(message: string): string
  dispose(): void
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Ada Lovelace',
  GIT_AUTHOR_EMAIL: 'ada@example.com',
  GIT_COMMITTER_NAME: 'Ada Lovelace',
  GIT_COMMITTER_EMAIL: 'ada@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1'
}

export function createRepo({
  bare = false,
  root
}: {
  bare?: boolean
  root?: string
} = {}): Fixture {
  const dir = root ?? mkdtempSync(join(tmpdir(), 'wake-test-'))
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, env: GIT_ENV, encoding: 'utf8', stdio: 'pipe' })
  git('init', '-q', '-b', 'main', ...(bare ? ['--bare'] : []))
  if (!bare) {
    git('config', 'commit.gpgsign', 'false')
    git('config', 'core.autocrlf', 'false')
  }
  return {
    root: dir,
    git,
    write(path, content) {
      const full = join(dir, path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    },
    read: (path) => readFileSync(join(dir, path), 'utf8'),
    commitAll(message) {
      git('add', '-A')
      git('commit', '-q', '-m', message)
      return git('rev-parse', 'HEAD').trim()
    },
    dispose: () => rmSync(dir, { recursive: true, force: true })
  }
}

export { GIT_ENV }
