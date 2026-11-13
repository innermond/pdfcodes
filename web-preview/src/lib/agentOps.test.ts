import { describe, expect, it } from 'vitest'
import { agentActions, MAX_AGENT_OPS } from './agentOps'

const ctx = { wordCount: 2, textFromFile: false }

describe('agentActions', () => {
  it('refuses anything that is not a list', () => {
    expect(agentActions({ op: 'set_word' }, ctx)).toEqual({ steps: [], rejected: ['ops must be a list'] })
  })

  it('patches a word, clamps numbers and turns a baseline into a custom position', () => {
    const { steps, rejected } = agentActions([{ op: 'set_word', word: 1, font_size_pt: 9999, y_mm: 12 }], ctx)
    expect(rejected).toEqual([])
    expect(steps).toEqual([{ patch: { target: 'word', index: 1, patch: { fontSizePt: 400, yMm: 12, valign: 'custom' } } }])
  })

  it('stores colours as CMYK and allows clearing the nullable ones', () => {
    const { steps } = agentActions([{ op: 'set_word', word: 0, color: '#000000', background: null }], ctx)
    expect(steps).toEqual([{ patch: { target: 'word', index: 0, patch: { color: '0:0:0:1', background: null } } }])
  })

  it('refuses a bad word, a bad colour, a wrong enum, null on a required field and an empty op', () => {
    const { steps, rejected } = agentActions(
      [
        { op: 'set_word', word: 2, opacity: 1 },
        { op: 'set_word', word: 0, color: 'red' },
        { op: 'set_word', word: 0, kind: 'hologram' },
        { op: 'set_word', word: 0, opacity: null },
        { op: 'set_word', word: 0 },
      ],
      ctx,
    )
    expect(steps).toEqual([])
    expect(rejected).toHaveLength(5)
  })

  it('switches the background to the simple source before patching it', () => {
    const { steps } = agentActions([{ op: 'set_background', width_mm: 90, fill_color: '#ffffff' }], ctx)
    expect(steps[0]).toEqual({ host: { kind: 'background_simple' } })
    expect(steps[1]).toMatchObject({ patch: { target: 'bg', patch: { simpleBgWidthMm: 90 } } })
  })

  it('patches the contour and the style', () => {
    const { steps } = agentActions([{ op: 'set_contour', shape_kind: 'heart' }, { op: 'set_style', bleed_mm: 3 }], ctx)
    expect(steps).toEqual([
      { patch: { target: 'contour', patch: { shapeKind: 'heart' } } },
      { patch: { target: 'style', patch: { bleedMm: 3 } } },
    ])
  })

  it('handles the mode, the contour source, steps, selection and history', () => {
    const { steps, rejected } = agentActions(
      [
        { op: 'set_mode', mode: 'both' },
        { op: 'set_contour_source', source: 'card' },
        { op: 'show_step', step: 'aspect' },
        { op: 'select_word', word: 1 },
        { op: 'undo', count: 99 },
        { op: 'set_mode', mode: 'x' },
        { op: 'launch_rocket' },
      ],
      ctx,
    )
    expect(steps).toEqual([
      { mode: 'both' },
      { host: { kind: 'contour_source', source: 'card' } },
      { host: { kind: 'show_step', step: 'aspect' } },
      { host: { kind: 'select_word', index: 1 } },
      { history: { kind: 'undo', count: 5 } },
    ])
    expect(rejected).toHaveLength(2)
  })

  it('leaves the text alone when the codes come from a file', () => {
    const { steps, rejected } = agentActions([{ op: 'set_sample_text', text: 'ABC' }], { wordCount: 1, textFromFile: true })
    expect(steps).toEqual([])
    expect(rejected).toHaveLength(1)
  })

  it('sets the sample text, trimmed', () => {
    expect(agentActions([{ op: 'set_sample_text', text: '  AB-12 ' }], ctx).steps).toEqual([{ host: { kind: 'sample_text', text: 'AB-12' } }])
  })

  it('reads no more than the allowed number of operations', () => {
    const many = Array.from({ length: MAX_AGENT_OPS + 5 }, () => ({ op: 'redo' }))
    expect(agentActions(many, ctx).steps).toHaveLength(MAX_AGENT_OPS)
  })
})
