// Turns what a failed git command printed into an `OpResult` the panel can explain and act on.
import type { FailureKind, OpResult } from '../shared/model'
import { cleanGitMessage, commandLine, type GitResult } from './git'

export type Failure = Extract<OpResult, { ok: false }>

const PATTERNS: readonly [FailureKind, RegExp][] = [
  [
    'auth',
    /terminal prompts disabled|could not read (?:Username|Password)|Authentication failed|Permission denied \(publickey|Host key verification failed|invalid username or password/i
  ],
  ['rejected', /\[rejected\]|non-fast-forward|fetch first|Updates were rejected/i],
  ['conflicts', /CONFLICT|Automatic merge failed|could not apply|after resolving the conflicts/],
  [
    'dirty',
    /would be overwritten|Please commit your changes or stash them|Your local changes to the following files/i
  ]
]

const FRIENDLY: Partial<Record<FailureKind, string>> = {
  auth: 'Git could not sign in to the remote. Run the command in a terminal to enter your credentials.',
  rejected: 'The remote has commits that this branch does not have. Pull first, then push again.',
  conflicts: 'There are conflicts to resolve before you can continue.',
  dirty: 'Your changes would be overwritten. Commit or stash them first.'
}

export type ClassifyOptions = {
  /** The command ran hooks (a commit with a hook installed): an unknown failure is the hook's. */
  hookRan?: boolean
}

export function classifyFailure(output: string, options: ClassifyOptions = {}): FailureKind {
  for (const [kind, pattern] of PATTERNS) if (pattern.test(output)) return kind
  return options.hookRan ? 'hook' : 'other'
}

export function failure(
  kind: FailureKind,
  message: string,
  detail = '',
  command: string | null = null
): Failure {
  return { ok: false, kind, message, detail, command }
}

/** The `OpResult` of a git command that exited with an error. */
export function gitFailure(
  args: readonly string[],
  result: GitResult,
  options: ClassifyOptions & { command?: string } = {}
): Failure {
  const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n')
  const kind = classifyFailure(detail, options)
  const message =
    FRIENDLY[kind] ??
    (kind === 'hook'
      ? 'A git hook stopped the commit. Read its output below.'
      : cleanGitMessage(result.stderr) ||
        cleanGitMessage(result.stdout) ||
        `git ${args[0] ?? ''} failed`)
  return failure(kind, message, detail, options.command ?? commandLine(args))
}

export function ok(): OpResult
export function ok<T>(value: T, message?: string): OpResult<T>
export function ok<T>(value?: T, message?: string): OpResult<T | null> {
  return message === undefined
    ? { ok: true, value: value ?? null }
    : { ok: true, value: value ?? null, message }
}

export type ErrorCode = 'invalid_params' | 'action_failed' | 'unavailable' | 'conflict'

/** An error the host passes to the panel with its `code`. */
export function hostError(code: ErrorCode, message: string): Error & { code: ErrorCode } {
  return Object.assign(new Error(message), { code })
}
