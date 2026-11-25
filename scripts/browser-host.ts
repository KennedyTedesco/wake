// A Vite plugin that runs the real worker inside the dev server and serves it to the panel over
// HTTP, so `pnpm preview` shows the panel in an ordinary browser against any repository.
// Only the dev server loads it; it never ships in the plugin.
import type { ServerResponse } from 'node:http'
import { basename, resolve } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'

type Handler = (input: unknown, context: { panel: object; signal: AbortSignal }) => unknown
type Listener = (payload: unknown) => void

const API = '/__wake'

function fakeOrca(repo: string, post: (event: string, payload: unknown) => void) {
  const handlers = new Map<string, Handler>()
  const name = basename(repo)
  const context = { workspaceId: 'preview', branch: '', displayName: name, terminals: [] }
  const settings: Record<string, unknown> = { autoFetchMinutes: 0 }
  const disposable = { dispose() {} }
  const hostMethods: Record<string, (params: unknown) => unknown> = {
    'workspace.readContext': () => context,
    'workspace.list': () => ({
      workspaces: [
        { id: 'preview', kind: 'worktree', name, path: repo, branch: null, hostId: 'local' }
      ],
      truncated: false
    }),
    'editor.open': (params) => {
      console.log('[preview] editor.open', params)
      return { opened: true }
    },
    'terminal.create': (params) => {
      console.log('[preview] terminal.create', params)
      return { terminalId: 'preview-terminal' }
    },
    'statusBar.update': (params) => {
      console.log('[preview] status bar', params)
      return { ok: true }
    },
    'agents.list': () => ({
      agents: [
        {
          terminalId: 'preview-agent',
          title: 'Show relative times as 3m ago',
          agent: 'claude',
          state: 'waiting',
          stateStartedAt: Date.now() - 4 * 60_000
        },
        {
          terminalId: 'preview-agent-2',
          title: 'Speed up the history list',
          agent: 'codex',
          state: 'working',
          stateStartedAt: Date.now() - 30_000
        }
      ]
    }),
    'terminal.sendText': (params) => {
      console.log('[preview] terminal.sendText', JSON.stringify(params))
      return { accepted: true }
    },
    'agent.launch': (params) => {
      console.log('[preview] agent.launch', params)
      return { terminalId: 'preview-agent-3' }
    }
  }
  const orca = {
    api: { major: 1, minor: 10 },
    grantedCapabilities: [],
    host: {
      has: (method: string) => method in hostMethods,
      call: async (method: string, params: unknown) => {
        const run = hostMethods[method]
        if (!run)
          throw Object.assign(new Error(`${method} is not available in the preview`), {
            code: 'unknown_method'
          })
        return run(params)
      }
    },
    panels: {
      handle(requestName: string, handler: Handler) {
        handlers.set(requestName, handler)
        return disposable
      },
      post: (event: string, payload: unknown) => post(event, payload)
    },
    events: {
      on(event: string, listener: Listener) {
        if (event === 'workspace.changed') setTimeout(() => listener({ context }), 0)
        return disposable
      }
    },
    hooks: { on: () => disposable },
    commands: { register: () => disposable },
    settings: {
      get: async (key?: string) => (key === undefined ? settings : settings[key]),
      set: async (key: string, value: unknown) => {
        settings[key] = value
      },
      onDidChange: () => disposable
    },
    storage: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      keys: async () => [],
      onDidChange: () => disposable
    },
    secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
    log: (message: string) => console.log(`[worker] ${message}`)
  }
  return { orca, handlers }
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}

export function browserHost(): Plugin {
  return {
    name: 'wake-browser-host',
    apply: 'serve',
    async configureServer(server: ViteDevServer) {
      const repo = resolve(process.env.WAKE_REPO ?? process.cwd())
      const clients = new Set<ServerResponse>()
      const post = (event: string, payload: unknown) => {
        for (const client of clients)
          client.write(`data: ${JSON.stringify({ event, payload })}\n\n`)
      }
      const { orca, handlers } = fakeOrca(repo, post)
      const worker = await server.ssrLoadModule(
        resolve(import.meta.dirname, '../src/worker/main.ts')
      )
      await worker.default(orca)
      server.config.logger.info(`  Wake preview on ${repo}`)

      server.middlewares.use(`${API}/events`, (_request, response) => {
        response.setHeader('content-type', 'text/event-stream')
        response.setHeader('cache-control', 'no-cache')
        response.write(': connected\n\n')
        clients.add(response)
        response.on('close', () => clients.delete(response))
      })

      server.middlewares.use(`${API}/request`, (request, response) => {
        let body = ''
        request.on('data', (chunk) => {
          body += chunk
        })
        request.on('end', async () => {
          const { name, input } = JSON.parse(body || '{}')
          const handler = handlers.get(name)
          if (!handler)
            return json(response, 404, {
              code: 'unknown_method',
              message: `No handler for ${name}`
            })
          try {
            const output = await handler(input, {
              panel: { id: 'preview', surface: 'panel', contributionId: 'git' },
              signal: new AbortController().signal
            })
            json(response, 200, { output: output ?? null })
          } catch (error) {
            const code =
              error && typeof error === 'object' && 'code' in error
                ? String(error.code)
                : 'action_failed'
            json(response, 500, {
              code,
              message: error instanceof Error ? error.message : String(error)
            })
          }
        })
      })
    }
  }
}
