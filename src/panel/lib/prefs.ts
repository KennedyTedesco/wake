// View preferences live in the frame's own localStorage: Orca keeps one per plugin, and they
// need no capability.
export type DiffLayout = 'unified' | 'split'
export type ChangesView = 'tree' | 'list'

export type Prefs = {
  diffLayout: DiffLayout
  wrapLines: boolean
  ignoreWhitespace: boolean
  /** Shows every unchanged line, not only the context around changes. */
  fullFile: boolean
  /** The changed files as folders or as one flat list. */
  changesView: ChangesView
  /** Width of the list column in the wide layout, in px. */
  sidebarWidth: number
  /** The list column folded to a rail of icons, so the diff takes the width. */
  sidebarCollapsed: boolean
  /** The file tree beside a commit's diffs is hidden. */
  fileTreeHidden: boolean
}

const DEFAULTS: Prefs = {
  diffLayout: 'unified',
  wrapLines: true,
  ignoreWhitespace: false,
  fullFile: false,
  changesView: 'tree',
  sidebarWidth: 300,
  sidebarCollapsed: false,
  fileTreeHidden: false
}

const KEY = 'wake.prefs'

export function loadPrefs(): Prefs {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!stored || typeof stored !== 'object') return DEFAULTS
    const prefs = { ...DEFAULTS }
    if (
      'diffLayout' in stored &&
      (stored.diffLayout === 'unified' || stored.diffLayout === 'split')
    ) {
      prefs.diffLayout = stored.diffLayout
    }
    if ('wrapLines' in stored && typeof stored.wrapLines === 'boolean')
      prefs.wrapLines = stored.wrapLines
    if ('ignoreWhitespace' in stored && typeof stored.ignoreWhitespace === 'boolean') {
      prefs.ignoreWhitespace = stored.ignoreWhitespace
    }
    if ('fullFile' in stored && typeof stored.fullFile === 'boolean')
      prefs.fullFile = stored.fullFile
    if (
      'changesView' in stored &&
      (stored.changesView === 'tree' || stored.changesView === 'list')
    ) {
      prefs.changesView = stored.changesView
    }
    if ('sidebarWidth' in stored && typeof stored.sidebarWidth === 'number') {
      prefs.sidebarWidth = stored.sidebarWidth
    }
    if ('sidebarCollapsed' in stored && typeof stored.sidebarCollapsed === 'boolean')
      prefs.sidebarCollapsed = stored.sidebarCollapsed
    if ('fileTreeHidden' in stored && typeof stored.fileTreeHidden === 'boolean')
      prefs.fileTreeHidden = stored.fileTreeHidden
    return prefs
  } catch {
    return DEFAULTS
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Storage can be unavailable in browser clients; preferences then last for the session.
  }
}
