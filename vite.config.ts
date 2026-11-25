import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { browserHost } from './scripts/browser-host.ts'

const panelRoot = fileURLToPath(new URL('./src/panel', import.meta.url))

// Stable names keep rebuilds from churning git history and Orca's dev reloads; Orca already
// keys its frame cache on the plugin's content hash.
const output = {
  entryFileNames: 'assets/[name].js',
  chunkFileNames: 'assets/[name].js',
  assetFileNames: 'assets/[name][extname]'
}

// The panel runs in Orca's isolated plugin frame: everything loads by relative URL from the
// plugin folder, and the frame has no network, so the build must be self-contained.
export default defineConfig(({ mode }) => ({
  root: panelRoot,
  base: './',
  plugins: [react(), browserHost()],
  worker: { format: 'es', rolldownOptions: { output } },
  build: {
    outDir: fileURLToPath(new URL('./dist/panel', import.meta.url)),
    emptyOutDir: true,
    target: 'es2024',
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2048,
    rolldownOptions: {
      // The sidebar panel and the full-size tab (a custom editor) load the same app.
      input: {
        index: fileURLToPath(new URL('./src/panel/index.html', import.meta.url)),
        tab: fileURLToPath(new URL('./src/panel/tab.html', import.meta.url))
      },
      output
    }
  }
}))
