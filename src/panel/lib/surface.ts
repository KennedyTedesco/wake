// Wake runs in two places: the right sidebar panel and a full-size tab, which Orca opens as a
// custom editor. Only the editor gets `orca.document`. The browser preview takes `?tab`.
export type Surface = 'panel' | 'tab'

export const surface: Surface =
  (typeof orca === 'object' && orca !== null && orca.document !== undefined) ||
  new URLSearchParams(location.search).has('tab')
    ? 'tab'
    : 'panel'

/** Orca waits for a custom editor to ask for its document; the tab has no use for the marker's
 *  text, so it asks once and ignores the answer. */
export function acknowledgeDocument(): void {
  if (surface === 'tab' && typeof orca === 'object' && orca?.document)
    void orca.document.get().catch(() => {})
}
