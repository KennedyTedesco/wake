// Sends review notes to an agent's terminal the way Orca's own "Annotate AI Diff" does: one
// bracketed paste, so a multi-line message stays one prompt, then Enter once the agent took it.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AgentTarget, OpResult } from '../shared/model'
import { failure, ok } from './failure'

const ESC = '\u001b'
const PASTE_START = `${ESC}[200~`
const PASTE_END = `${ESC}[201~`

/**
 * The paste frame for `text`. An escape byte inside the text would end the frame early and run
 * the rest as keys, so it becomes a visible ␛. Line feeds become carriage returns, as xterm's
 * own paste writes them.
 */
export function pasteFrame(text: string): string {
  const safe = text.replaceAll(ESC, '␛').replace(/\r?\n/g, '\r')
  return `${PASTE_START}${safe}${PASTE_END}`
}

/** Time for the agent to take in the paste before Enter: longer pastes need longer. */
export function submitDelayMs(text: string): number {
  return Math.min(1500, 250 + Math.ceil(text.length / 200))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function listTargets(
  orca: OrcaWorkerApi,
  workspaceId: string
): Promise<AgentTarget[]> {
  if (!orca.host.has('agents.list')) return []
  const { agents } = await orca.host
    .call('agents.list', { workspaceId })
    .catch(() => ({ agents: [] }))
  return agents
    .flatMap((agent) =>
      agent.terminalId
        ? [
            {
              terminalId: agent.terminalId,
              title: agent.task?.title ?? agent.title ?? 'Agent',
              agent: agent.agent,
              state: agent.state,
              since: agent.stateStartedAt
            }
          ]
        : []
    )
    .sort((a, b) => b.since - a.since)
}
export async function sendToAgent(
  orca: OrcaWorkerApi,
  input: { terminalId: string; text: string; submit: boolean }
): Promise<OpResult> {
  if (!input.text.trim()) return failure('other', 'There are no notes to send.')
  if (!orca.host.has('terminal.sendText'))
    return failure('other', 'This Orca cannot type into terminals.')
  const pasted = await orca.host.call('terminal.sendText', {
    terminalId: input.terminalId,
    text: pasteFrame(input.text),
    enter: false
  })
  if (!pasted.accepted)
    return failure('other', 'The terminal did not take the notes. Is the agent still running?')
  if (input.submit) {
    await sleep(submitDelayMs(input.text))
    // Orca refuses an empty `text`, even with `enter`, so the Enter key goes as its own byte.
    await orca.host.call('terminal.sendText', {
      terminalId: input.terminalId,
      text: '\r',
      enter: false
    })
  }
  return ok()
}

/** Starts a new agent in the workspace with the notes as its first prompt. */
export async function launchWithNotes(
  orca: OrcaWorkerApi,
  input: { workspaceId: string; agent: string; text: string }
): Promise<OpResult> {
  if (!orca.host.has('agent.launch'))
    return failure('other', 'This Orca cannot start agents for plugins.')
  await orca.host.call('agent.launch', {
    workspaceId: input.workspaceId,
    agent: input.agent,
    prompt: input.text
  })
  return ok()
}
