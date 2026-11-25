import { describe, expect, it } from 'vitest'
import { readPullRequest } from './pullRequest'

const open = {
  number: 111,
  title: 'One version for the release and the desktop app',
  url: 'https://github.com/acme/app/pull/111',
  state: 'OPEN',
  isDraft: false,
  reviewDecision: '',
  statusCheckRollup: []
}

describe('readPullRequest', () => {
  it('reads an open pull request from gh pr view --json', () => {
    expect(readPullRequest(open)).toEqual({
      number: 111,
      title: 'One version for the release and the desktop app',
      url: 'https://github.com/acme/app/pull/111',
      draft: false,
      checks: null,
      review: null
    })
  })

  it('shows nothing for a merged or closed pull request', () => {
    expect(readPullRequest({ ...open, state: 'MERGED' })).toBeNull()
    expect(readPullRequest({ ...open, state: 'CLOSED' })).toBeNull()
  })

  it('lets a failed check win over running ones, and running ones over passed ones', () => {
    const run = (status: string, conclusion = '') => ({
      __typename: 'CheckRun',
      status,
      conclusion
    })
    const checks = (...rollup: object[]) =>
      readPullRequest({ ...open, statusCheckRollup: rollup })?.checks
    expect(checks(run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED'))).toBe('passing')
    expect(checks(run('COMPLETED', 'SUCCESS'), run('IN_PROGRESS'))).toBe('pending')
    expect(checks(run('IN_PROGRESS'), run('COMPLETED', 'FAILURE'))).toBe('failing')
    expect(checks({ __typename: 'StatusContext', state: 'ERROR' })).toBe('failing')
  })

  it('reads the review decision', () => {
    expect(readPullRequest({ ...open, reviewDecision: 'CHANGES_REQUESTED' })?.review).toBe(
      'changes-requested'
    )
  })
})
