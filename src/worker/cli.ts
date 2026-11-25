// Opens the panel through Orca's CLI: the host API has no method that shows a plugin panel.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const MANIFEST_ID = 'wake'
const PANEL_ID = 'git'
const CLI_TIMEOUT_MS = 10_000

/** Orca's bundled CLI next to the running app, else `orca` on PATH. */
function orcaCli(): string {
  const exe = process.platform === 'win32' ? 'orca.exe' : 'orca'
  for (const dir of [process.cwd(), dirname(process.execPath)]) {
    for (const candidate of [join(dir, 'resources', 'bin', exe), join(dir, '..', 'bin', exe)]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return exe
}

async function runCli(args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)(orcaCli(), args, {
    timeout: CLI_TIMEOUT_MS,
    windowsHide: true,
    encoding: 'utf8'
  })
  return stdout
}

/** The installed plugin's key, such as `kennedytedesco.wake`, from `orca plugin list --json`. */
export function findPluginKey(listJson: string): string | null {
  const keys: string[] = []
  try {
    JSON.parse(listJson, (field, value: unknown) => {
      if (field === 'pluginKey' && typeof value === 'string') keys.push(value)
      return value
    })
  } catch {
    return null
  }
  return keys.find((key) => key === MANIFEST_ID || key.endsWith(`.${MANIFEST_ID}`)) ?? null
}

let pluginKey: string | null = null

/** Shows the Wake panel; throws when the CLI cannot. */
export async function openPanelWithCli(): Promise<void> {
  pluginKey ??= findPluginKey(await runCli(['plugin', 'list', '--json']))
  if (!pluginKey) throw new Error('Orca does not list the Wake plugin')
  await runCli(['plugin', 'open', pluginKey, '--panel', PANEL_ID, '--json'])
}
