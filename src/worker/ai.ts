// Drafts a commit message with a coding agent CLI the person already has and is signed in to.
// Orca's own "Generate with AI" is not part of the plugin API, so the agent runs here, on the
// person's own subscription, with nothing but the prompt as input.
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePatch } from '../shared/diff/parse'
import { buildPartialPatch } from '../shared/diff/patch'
import type { FileSelection, OpResult } from '../shared/model'
import { patchHash, workingPatch } from './diff'
import { failure, ok } from './failure'
import type { RepoContext } from './repo'
import { findBinary, loginPath } from './userPath'

export type AiAgent = 'claude' | 'codex' | 'gemini' | 'opencode'
export type AiSettings = { agent: AiAgent | 'auto'; model: string; instructions: string }
export type CommitDraft = { summary: string; description: string; agent: string }

type AgentSpec = {
  label: string
  bin: string
  /** Arguments, and whether the prompt goes on stdin or as the last argument. */
  invoke(model: string, outputFile: string): { args: string[]; prompt: 'stdin' | 'argument' }
  /** Agents that print logs around the answer write it to `outputFile` instead. */
  readsOutputFile?: boolean
}

export const AGENTS: Record<AiAgent, AgentSpec> = {
  claude: {
    label: 'Claude Code',
    bin: 'claude',
    invoke: (model) => ({
      args: [
        '-p',
        '--output-format',
        'text',
        '--no-session-persistence',
        ...(model ? ['--model', model] : [])
      ],
      prompt: 'stdin'
    })
  },
  codex: {
    label: 'Codex',
    bin: 'codex',
    readsOutputFile: true,
    invoke: (model, outputFile) => ({
      args: [
        'exec',
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox',
        'read-only',
        '--color',
        'never',
        '--output-last-message',
        outputFile,
        ...(model ? ['--model', model] : []),
        '-'
      ],
      prompt: 'stdin'
    })
  },
  gemini: {
    label: 'Gemini CLI',
    bin: 'gemini',
    invoke: (model) => ({
      // Gemini appends `-p` to what arrives on stdin.
      args: [
        '-p',
        'Answer with the commit message only.',
        '--output-format',
        'text',
        ...(model ? ['--model', model] : [])
      ],
      prompt: 'stdin'
    })
  },
  opencode: {
    label: 'OpenCode',
    bin: 'opencode',
    invoke: (model) => ({ args: ['run', ...(model ? ['--model', model] : [])], prompt: 'argument' })
  }
}

const AUTO_ORDER: AiAgent[] = ['claude', 'codex', 'gemini', 'opencode']
const TIMEOUT_MS = 110_000
const PATCH_BUDGET = 60_000
const FILE_PATCH_LIMIT = 12_000
const MAX_FILES = 60

// ---------- finding the agent ----------

async function pickAgent(
  choice: AiSettings['agent'],
  path: string
): Promise<{ agent: AiAgent; binary: string } | null> {
  const order = choice === 'auto' ? AUTO_ORDER : [choice]
  for (const agent of order) {
    const binary = await findBinary(AGENTS[agent].bin, path)
    if (binary) return { agent, binary }
  }
  return null
}

/** The agent the settings name, or with `auto` the first one installed. */
export async function chosenAgent(choice: AiSettings['agent']): Promise<AiAgent | null> {
  if (choice !== 'auto') return choice
  return (await pickAgent(choice, await loginPath()))?.agent ?? null
}

// ---------- the prompt ----------

async function selectedPatch(ctx: RepoContext, file: FileSelection): Promise<string> {
  const { patch } = await workingPatch(ctx, file)
  if (file.selection.kind === 'all' || patchHash(patch) !== file.selection.hash) return patch
  return buildPartialPatch(parsePatch(patch), new Set(file.selection.lines), 'stage') ?? ''
}

function clip(text: string, limit: number): string {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n[… ${text.length - limit} more characters cut]\n`
}

export async function buildPrompt(
  ctx: RepoContext,
  files: FileSelection[],
  instructions: string
): Promise<string> {
  const branch = (
    await ctx.git.read(['symbolic-ref', '--short', '-q', 'HEAD'], {
      readOnly: true,
      okExitCodes: [1]
    })
  ).trim()
  const recent = (
    await ctx.git
      .read(['log', '-n', '12', '--format=%s'], { readOnly: true, okExitCodes: [128] })
      .catch(() => '')
  )
    .split('\n')
    .filter(Boolean)

  let budget = PATCH_BUDGET
  const patches: string[] = []
  for (const file of files.slice(0, MAX_FILES)) {
    if (budget <= 0) break
    const patch = clip(await selectedPatch(ctx, file), Math.min(FILE_PATCH_LIMIT, budget))
    budget -= patch.length
    patches.push(patch)
  }
  const unlisted = files.length - patches.length

  return [
    'Write the git commit message for the change below.',
    '',
    'Rules:',
    '- The first line is a summary in the imperative mood, at most 72 characters, with no trailing period.',
    '- Add a body only when the reason for the change is not obvious: a blank line, then short lines (at most 72 characters) that say what changed and why.',
    '- Match the language and conventions of the recent commits, such as "feat:" prefixes or ticket ids.',
    '- Answer with the commit message only: no quotes, no code fences, no introduction.',
    ...(instructions.trim()
      ? ['', 'Instructions from the person, which win over the rules above:', instructions.trim()]
      : []),
    '',
    `Branch: ${branch || '(detached)'}`,
    ...(recent.length ? ['', 'Recent commits:', ...recent.map((subject) => `- ${subject}`)] : []),
    '',
    `Files: ${files.map((file) => file.path).join(', ')}`,
    '',
    'Diff:',
    ...patches,
    ...(unlisted > 0 ? [`[${unlisted} more files not shown]`] : [])
  ].join('\n')
}

/** Splits an agent's answer into summary and body, without the wrapping agents tend to add. */
export function parseCommitMessage(
  output: string
): { summary: string; description: string } | null {
  const lines = output
    .replace(/\r\n/g, '\n')
    .trim()
    .split('\n')
    .filter((line) => !/^```/.test(line.trim()))
  while (lines.length && !lines[0]?.trim()) lines.shift()
  const first = lines.shift()
  if (!first) return null
  const summary = first
    .trim()
    .replace(/^(commit message|summary)\s*:\s*/i, '')
    // Only quotes that wrap the whole line: a summary may itself end in a quoted word.
    .replace(/^(["'`])(.*)\1$/, '$2')
    .trim()
  if (!summary) return null
  return { summary, description: lines.join('\n').trim() }
}

// ---------- running ----------

let running: ChildProcess | null = null

export function cancelDraft(): void {
  running?.kill()
}

function runAgent(
  binary: string,
  args: string[],
  input: string | null,
  cwd: string,
  path: string
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  const { promise, resolve } = Promise.withResolvers<{
    stdout: string
    stderr: string
    code: number | null
    timedOut: boolean
  }>()
  const child = spawn(binary, args, {
    cwd,
    env: { ...process.env, PATH: path, NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  running = child
  let stdout = ''
  let stderr = ''
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, TIMEOUT_MS)
  child.stdout?.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr?.on('data', (chunk) => {
    stderr += chunk
  })
  child.on('error', (error) => {
    stderr += error.message
  })
  child.on('close', (code) => {
    clearTimeout(timer)
    if (running === child) running = null
    resolve({ stdout, stderr, code, timedOut })
  })
  child.stdin?.on('error', () => {})
  child.stdin?.end(input ?? '')
  return promise
}

export async function draftCommitMessage(
  ctx: RepoContext,
  files: FileSelection[],
  settings: AiSettings
): Promise<OpResult<CommitDraft>> {
  if (files.length === 0) return failure('other', 'Include at least one file to describe.')
  const path = await loginPath()
  const picked = await pickAgent(settings.agent, path)
  if (!picked) {
    const wanted =
      settings.agent === 'auto'
        ? 'Claude Code, Codex, Gemini CLI or OpenCode'
        : AGENTS[settings.agent].label
    return failure(
      'other',
      `No agent to write the message: install and sign in to ${wanted}, or pick another one in Wake's settings.`
    )
  }

  const spec = AGENTS[picked.agent]
  const prompt = await buildPrompt(ctx, files, settings.instructions)
  const scratch = spec.readsOutputFile ? await mkdtemp(join(tmpdir(), 'wake-ai-')) : null
  const outputFile = scratch ? join(scratch, 'message.txt') : ''
  try {
    const { args, prompt: via } = spec.invoke(settings.model.trim(), outputFile)
    const result = await runAgent(
      picked.binary,
      via === 'argument' ? [...args, prompt] : args,
      via === 'stdin' ? prompt : null,
      ctx.root,
      path
    )
    if (result.timedOut)
      return failure('other', `${spec.label} took too long to answer.`, result.stderr.trim())
    if (result.code !== 0) {
      if (result.code === null) return failure('other', 'Stopped.')
      return failure(
        'other',
        `${spec.label} could not write the message. Check that it is signed in${settings.model ? ` and that the model “${settings.model}” exists` : ''}.`,
        (result.stderr || result.stdout).trim()
      )
    }
    const answer = scratch
      ? await readFile(outputFile, 'utf8').catch(() => result.stdout)
      : result.stdout
    const message = parseCommitMessage(answer)
    if (!message)
      return failure('other', `${spec.label} answered with an empty message.`, answer.trim())
    return ok({ ...message, agent: spec.label })
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true })
  }
}
