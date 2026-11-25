import { afterEach } from 'vitest'
import { openRepo, type RepoContext } from '../../src/worker/repo'
import { createRepo, type Fixture, GIT_ENV } from '../fixture'

/** The worker's view of a fixture repository. */
export async function contextOf(repo: Fixture): Promise<RepoContext> {
  const ctx = await openRepo(repo.root, { env: GIT_ENV })
  if (!ctx) throw new Error(`${repo.root} is not a repository`)
  return ctx
}

export type MakeRepo = (options?: { bare?: boolean }) => Fixture

/** Fixtures made through this helper are deleted after each test. */
export function tempRepos(): MakeRepo {
  const repos: Fixture[] = []
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.dispose()
  })
  return (options) => {
    const repo = createRepo(options)
    repos.push(repo)
    return repo
  }
}

/** A repository with one commit, pushed to a bare remote so `main` has an upstream. */
export function withRemote(make: MakeRepo) {
  const remote = make({ bare: true })
  const repo = make()
  repo.write('README.md', 'hello\n')
  repo.commitAll('init')
  repo.git('remote', 'add', 'origin', remote.root)
  repo.git('push', '-q', '-u', 'origin', 'main')
  return { remote, repo }
}
