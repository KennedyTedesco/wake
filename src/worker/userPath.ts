// Finds the person's own CLIs (coding agents, gh) the way their terminal would.
import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

let searchPath: Promise<string> | null = null

/** PATH as the person's login shell sets it: Orca started from the Dock gives workers only a
 *  minimal PATH, while CLIs live in places such as ~/.local/bin or /opt/homebrew/bin. */
export function loginPath(): Promise<string> {
  searchPath ??= readLoginPath()
  return searchPath
}

function readLoginPath(): Promise<string> {
  const fallback = process.env.PATH ?? ''
  if (process.platform === 'win32') return Promise.resolve(fallback)
  const { promise, resolve } = Promise.withResolvers<string>()
  const shell = process.env.SHELL || '/bin/zsh'
  // The marker skips whatever the profile prints before the PATH.
  const child = spawn(shell, ['-lc', 'printf "\\n__PATH__%s" "$PATH"'], {
    stdio: ['ignore', 'pipe', 'ignore']
  })
  let out = ''
  const timer = setTimeout(() => child.kill(), 5000)
  child.stdout.on('data', (chunk) => {
    out += chunk
  })
  child.on('error', () => resolve(fallback))
  child.on('close', () => {
    clearTimeout(timer)
    const found = out.split('__PATH__').at(-1)?.trim()
    const home = process.env.HOME ?? ''
    const extra = [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']
    resolve([found || fallback, ...extra].join(delimiter))
  })
  return promise
}

export async function findBinary(bin: string, path: string): Promise<string | null> {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, bin)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {}
  }
  return null
}
