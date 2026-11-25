import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { browserHost } from './scripts/browser-host.ts'

const panelRoot = fileURLToPath(new URL('./src/panel', import.meta.url))

// Stable names keep rebuilds from churning git history and Orca's dev reloads; Orca already
// keys its frame cache on the plugin's content hash.
const output = {
  entryFileNames: 'assets/[name].js',
  chunkFileNames: 'assets/[name].js',
  assetFileNames: 'assets/[name][extname]'
}

/**
 * Each Shiki language module re-exports every grammar it embeds (Ruby pulls in C++, 780 KB).
 * This keeps only a module's own grammar; the highlight worker loads the embedded languages
 * Wake knows on demand, and the rest stay uncolored.
 */
function shikiGrammarOnly(): Plugin {
  return {
    name: 'wake-shiki-grammar-only',
    enforce: 'pre',
    transform(code, id) {
      if (!/@shikijs[\\/]langs[\\/]dist[\\/][^\\/]+\.mjs$/.test(id)) return null
      const own = code
        .replace(/^import .*$/gm, '')
        .replace(/export default \[[\s\S]*\]\s*$/, 'export default [lang]\n')
      if (!own.includes('export default [lang]'))
        this.error(`Unexpected Shiki language module: ${id}`)
      return { code: own, map: null }
    }
  }
}

// The panel runs in Orca's isolated plugin frame: everything loads by relative URL from the
// plugin folder, and the frame has no network, so the build must be self-contained.
export default defineConfig(({ mode }) => ({
  root: panelRoot,
  base: './',
  plugins: [react(), browserHost(), shikiGrammarOnly()],
  worker: { format: 'es', plugins: () => [shikiGrammarOnly()], rolldownOptions: { output } },
  // Pre-bundled, Shiki would skip `shikiGrammarOnly`, and `pnpm preview` would not load grammars the way the build does.
  optimizeDeps: { exclude: ['shiki', '@shikijs/langs'] },
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
