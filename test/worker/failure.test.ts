import { describe, expect, it } from 'vitest'
import { classifyFailure, gitFailure } from '../../src/worker/failure'
import { cleanGitMessage } from '../../src/worker/git'

describe('classifyFailure', () => {
  it.each([
    ['auth', "fatal: could not read Username for 'https://github.com': terminal prompts disabled"],
    [
      'auth',
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'
    ],
    ['auth', 'Host key verification failed.'],
    ['auth', "remote: Invalid username or password.\nfatal: Authentication failed for 'https://x'"],
    [
      'rejected',
      ' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs'
    ],
    ['rejected', 'hint: Updates were rejected because the tip of your current branch is behind'],
    [
      'conflicts',
      'CONFLICT (content): Merge conflict in a.txt\nAutomatic merge failed; fix conflicts'
    ],
    ['conflicts', 'error: could not apply 1a2b3c4... message'],
    ['dirty', 'error: Your local changes to the following files would be overwritten by checkout:'],
    ['dirty', 'Please commit your changes or stash them before you switch branches.'],
    ['other', "fatal: 'origin' does not appear to be a git repository"]
  ] as const)('classifies %s', (kind, stderr) => {
    expect(classifyFailure(stderr)).toBe(kind)
  })

  it('blames a hook only when one ran', () => {
    expect(classifyFailure('lint failed', { hookRan: true })).toBe('hook')
    expect(classifyFailure('lint failed')).toBe('other')
  })
})

describe('gitFailure', () => {
  it('cleans the message and keeps the full output', () => {
    const result = gitFailure(['branch', '-d', 'x'], {
      stdout: '',
      stderr: "error: branch 'x' not found\n",
      exitCode: 1
    })
    expect(result).toEqual({
      ok: false,
      kind: 'other',
      message: "branch 'x' not found",
      detail: "error: branch 'x' not found",
      command: 'git branch -d x'
    })
  })

  it('skips hint lines', () => {
    expect(cleanGitMessage('hint: try this\nfatal: the real problem\n')).toBe('the real problem')
  })
})
