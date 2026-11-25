// Copies the typings that `orca plugin types` writes into `types/`, so the repository
// type-checks on machines and CI runners without Orca installed. Run it after an Orca update.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The test-kit typings are left out: the tests run on vitest.
const PACKAGES = ['orca', 'orca-host', 'orca-frame', 'orca-worker', 'orca-services']

const scratch = mkdtempSync(join(tmpdir(), 'wake-types-'))
try {
  execFileSync('orca', ['plugin', 'types', scratch], { stdio: 'inherit' })
  for (const name of PACKAGES) {
    const target = new URL(`../types/${name}`, import.meta.url).pathname
    rmSync(target, { recursive: true, force: true })
    cpSync(join(scratch, '.orca', 'types', name), target, { recursive: true })
  }
  console.log(`Copied ${PACKAGES.join(', ')} into types/`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
