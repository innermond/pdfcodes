import { describe, expect, it, vi } from 'vitest'
import { runAgentSteps } from './agentRun'

function deps() {
  return {
    patchWord: vi.fn(),
    patchConfig: vi.fn(),
    setMode: vi.fn(),
    history: vi.fn(),
    host: vi.fn(async () => {}),
  }
}

describe('runAgentSteps', () => {
  it('runs steps in order, one history call per count', async () => {
    const d = deps()
    const { applied, failures } = await runAgentSteps(
      [
        { patch: { target: 'word', index: 1, patch: { opacity: 0.5 } } },
        { patch: { target: 'style', patch: { bleedMm: 2 } } },
        { mode: 'both' },
        { history: { kind: 'undo', count: 3 } },
      ],
      d,
    )
    expect(applied).toBe(4)
    expect(failures).toEqual([])
    expect(d.patchWord).toHaveBeenCalledWith(1, { opacity: 0.5 })
    expect(d.patchConfig).toHaveBeenCalledWith('style', { bleedMm: 2 })
    expect(d.setMode).toHaveBeenCalledWith('both')
    expect(d.history).toHaveBeenCalledTimes(3)
  })

  it('reports a failed host step and keeps going', async () => {
    const d = deps()
    d.host.mockRejectedValueOnce(new Error('nu merge'))
    const { applied, failures } = await runAgentSteps(
      [{ host: { kind: 'show_step', step: 'date' } }, { mode: 'print' }],
      d,
    )
    expect(applied).toBe(1)
    expect(failures).toEqual(['show_step: nu merge'])
    expect(d.setMode).toHaveBeenCalled()
  })
})
