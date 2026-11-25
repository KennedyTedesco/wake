import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/base.css'
import './styles/app.css'
import './styles/diff.css'

// The browser preview has no Orca around it: a stand-in reaches the worker over HTTP.
if (import.meta.env.DEV && !('orca' in globalThis)) await import('./dev/browser-orca')

// Imported after the stand-in above, because it reads `orca` when it loads.
const { acknowledgeDocument, surface } = await import('./lib/surface')
acknowledgeDocument()
document.documentElement.dataset.surface = surface

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
