// Runs git. Every call goes through `runGit`, which pins the output format (no colors, no pager,
// no quoted paths, C locale) so the parsers in this folder can trust what they read.
import { spawn } from 'node:child_process'

export type GitOptions = {
  stdin?: string | Buffer
  /** Exit codes that are answers, not failures, such as 1 for `diff --no-index`. */
  okExitCodes?: readonly number[]
  timeoutMs?: number
  env?: Record<string, string>
  /** Read-only commands must not take `index.lock`, or they race the person's own git. */
  readOnly?: boolean
  /** The command names files: read them as file names, never as globs. Not global: `git stash
   *  push -u` misses untracked files under literal pathspecs. */
  literalPaths?: boolean
  maxOutputBytes?: number
  onStderr?: (chunk: string) => void
}

export type GitOutput = { stdout: Buffer; stderr: string; exitCode: number }
export type GitResult = { stdout: string; stderr: string; exitCode: number }

export const DEFAULT_TIMEOUT_MS = 30_000
export const NETWORK_TIMEOUT_MS = 5 * 60_000
/** Commits, merges and the like run hooks, which can take as long as a test suite. */
export const HOOK_TIMEOUT_MS = 5 * 60_000
const DEFAULT_MAX_OUTPUT = 64 * 1024 * 1024

const CONFIG_ARGS = [
  '-c',
  'core.quotepath=false',
  '-c',
  'color.ui=false',
  '-c',
  'core.pager=cat',
  '-c',
  'log.showSignature=false'
]

export class GitError extends Error {
  readonly args: readonly string[]
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string

  constructor(args: readonly string[], result: GitResult) {
    super(cleanGitMessage(result.stderr) || `git ${args[0] ?? ''} exited with ${result.exitCode}`)
    this.name = 'GitError'
    this.args = args
    this.exitCode = result.exitCode
    this.stderr = result.stderr
    this.stdout = result.stdout
  }
}

/** The first meaningful line of git's error output, without its `error:`/`fatal:` prefix. */
export function cleanGitMessage(stderr: string): string {
  for (const raw of stderr.split(/\r?\n|\r/)) {
    const line = raw.replace(/^(?:error|fatal|warning|hint|remote):\s*/i, '').trim()
    if (line && !/^\s*hint:/i.test(raw)) return line
  }
  return ''
}

export class GitAbortError extends Error {
  readonly code = 'cancelled'
  constructor() {
    super('The git command was cancelled')
    this.name = 'GitAbortError'
  }
}

export type Git = {
  readonly cwd: string
  /** Runs git and answers whatever it exits with. Throws only when git cannot run at all. */
  exec(args: readonly string[], options?: GitOptions): Promise<GitOutput>
  run(args: readonly string[], options?: GitOptions): Promise<GitResult>
  /** Stdout of a command that must succeed; throws `GitError` otherwise. */
  read(args: readonly string[], options?: GitOptions): Promise<string>
}

export type GitConfig = {
  cwd: string
  /** Added to the process environment, such as an author identity in tests. */
  env?: Record<string, string | undefined>
  signal?: AbortSignal
}

export function createGit({ cwd, env, signal }: GitConfig): Git {
  const exec = (args: readonly string[], options: GitOptions = {}) =>
    execGit(cwd, args, { ...options, env: { ...definedEntries(env), ...options.env } }, signal)
  const run = async (args: readonly string[], options?: GitOptions): Promise<GitResult> => {
    const output = await exec(args, options)
    return { ...output, stdout: output.stdout.toString('utf8') }
  }
  return {
    cwd,
    exec,
    run,
    async read(args, options) {
      const result = await run(args, options)
      const ok = result.exitCode === 0 || (options?.okExitCodes ?? []).includes(result.exitCode)
      if (!ok) throw new GitError(args, result)
      return result.stdout
    }
  }
}

function definedEntries(env: Record<string, string | undefined> | undefined) {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env ?? {})) if (value !== undefined) out[key] = value
  return out
}

function execGit(
  cwd: string,
  args: readonly string[],
  options: GitOptions,
  signal: AbortSignal | undefined
): Promise<GitOutput> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new GitAbortError())
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LC_ALL: 'C',
      GIT_TERMINAL_PROMPT: '0',
      ...options.env
    }
    if (options.readOnly) env.GIT_OPTIONAL_LOCKS = '0'
    if (options.literalPaths) env.GIT_LITERAL_PATHSPECS = '1'

    const child = spawn('git', [...CONFIG_ARGS, ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT
    let outputBytes = 0
    let failure: Error | null = null

    const kill = (error: Error) => {
      failure ??= error
      child.kill('SIGTERM')
    }
    const timer = setTimeout(() => {
      const seconds = Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)
      kill(new Error(`git ${args[0] ?? ''} took longer than ${seconds} s and was stopped`))
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const onAbort = () => kill(new GitAbortError())
    signal?.addEventListener('abort', onAbort, { once: true })

    const collect = (into: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > maxOutput) {
        kill(new Error(`git ${args[0] ?? ''} printed more than ${maxOutput} bytes`))
        return
      }
      into.push(chunk)
    }
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      collect(stderr, chunk)
      options.onStderr?.(chunk.toString('utf8'))
    })
    // git may exit before reading all of stdin (for example on a bad argument).
    child.stdin.on('error', () => {})
    child.stdin.end(options.stdin ?? '')

    child.on('error', (error) => {
      failure ??= error
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (failure) return reject(failure)
      resolve({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: code ?? -1
      })
    })
  })
}

/** Quotes an argument for a POSIX shell when it needs it, for commands shown to the person. */
export function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`
}

export function commandLine(args: readonly string[]): string {
  return ['git', ...args].map(shellQuote).join(' ')
}
