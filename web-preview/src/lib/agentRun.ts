// Runs the steps `agentActions` produced, in the order the agent gave them.
//
// Split from App.tsx so the order of things — a refused step not stopping the ones after it,
// one undo per count — can be tested without rendering the editor. The host supplies the
// editor's own setters.

import type { AgentStep, HostSource } from './agentOps'

export interface AgentRunDeps {
  patchWord: (index: number, patch: Record<string, unknown>) => void
  patchConfig: (target: 'bg' | 'contour' | 'style', patch: Record<string, unknown>) => void
  setMode: (mode: 'print' | 'contour' | 'both') => void
  history: (kind: 'undo' | 'redo') => void
  host: (source: HostSource) => Promise<void>
}

const why = (err: unknown) => (err instanceof Error && err.message ? err.message : 'nu s-a putut aplica')

export async function runAgentSteps(
  steps: AgentStep[],
  deps: AgentRunDeps,
): Promise<{ applied: number; failures: string[] }> {
  const failures: string[] = []
  let applied = 0

  for (const step of steps) {
    if ('patch' in step) {
      if (step.patch.target === 'word') deps.patchWord(step.patch.index, step.patch.patch)
      else deps.patchConfig(step.patch.target, step.patch.patch)
      applied++
    } else if ('mode' in step) {
      deps.setMode(step.mode)
      applied++
    } else if ('history' in step) {
      for (let i = 0; i < step.history.count; i++) deps.history(step.history.kind)
      applied++
    } else {
      try {
        await deps.host(step.host)
        applied++
      } catch (err) {
        failures.push(`${step.host.kind}: ${why(err)}`)
      }
    }
  }

  return { applied, failures }
}
