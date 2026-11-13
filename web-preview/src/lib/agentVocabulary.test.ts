import { describe, expect, it } from 'vitest'
import vocabulary from './agentVocabulary.json'
import { BLEND_MODES, MAX_AGENT_OPS, MAX_AGENT_TEXT, MODES, STEP_IDS } from './agentOps'
import { BLEND_MODES as EDITOR_BLEND_MODES } from './options'

describe('agentVocabulary.json', () => {
  it('agrees with the constants agentOps.ts exports', () => {
    expect(MAX_AGENT_OPS).toBe(vocabulary.max_ops)
    expect(MAX_AGENT_TEXT).toBe(vocabulary.max_text)
    expect([...STEP_IDS]).toEqual(vocabulary.steps)
    expect([...MODES]).toEqual(vocabulary.modes)
  })

  it('lists the blend modes the editor has, wherever the table repeats them', () => {
    expect([...BLEND_MODES]).toEqual(EDITOR_BLEND_MODES)
    const word = vocabulary.generic_ops.set_word.params.blend_mode.values
    const contour = vocabulary.generic_ops.set_contour.params.contour_blend_mode.values
    expect(word).toEqual(EDITOR_BLEND_MODES)
    expect(contour).toEqual(EDITOR_BLEND_MODES)
  })

  it('uses each parameter name once across operations', () => {
    const names = Object.values(vocabulary.generic_ops).flatMap((op) => Object.keys(op.params))
    expect(new Set(names).size).toBe(names.length)
  })
})
