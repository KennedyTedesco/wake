// Mirrors the rules of `git check-ref-format --branch`, so a bad name is caught while typing.
// The worker validates again with git itself.

/** Turns what was typed into a usable name, as GitHub Desktop does: spaces become dashes. */
export function sanitizeRefName(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[~^:?*[\\\p{Cc}]+/gu, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/\/{2,}/g, '/')
    .replace(/^[-/.]+/, '')
    .replace(/[/.]+$/, '')
    .replace(/\.lock$/, '')
    .replace(/@\{/g, '-')
}

export function refNameError(name: string, existing: readonly string[]): string | null {
  const clean = sanitizeRefName(name)
  if (!clean) return 'Enter a name.'
  if (clean === '@' || clean === 'HEAD') return `“${clean}” is reserved by git.`
  if (existing.includes(clean)) return `A branch named “${clean}” already exists.`
  return null
}
