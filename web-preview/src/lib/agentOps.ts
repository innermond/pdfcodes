// What an outside agent may do to the pdfcodes editor, and nothing else.
//
// The shop assistant (a Claude tool call, run by the host page) sends a short list of
// operations as untrusted JSON. This file is the only door between that list and the
// editor's state: each operation is checked against a closed vocabulary and turned into a
// step the editor applies through the same setters a click uses, so an agent's edit is one
// undo entry like any other. No file access, no generation, no export: those are the
// customer's to press.
//
// The numeric, boolean, enum and colour settings are a table (`agentVocabulary.json`), read
// here and by the PHP tool, so a new setting is a row rather than a new branch. Colours come
// in as #rrggbb and leave as the CMYK string the editor stores.

import { formatCmyk, rgbToCmykPrint } from './cmyk'
import vocabulary from './agentVocabulary.json'

export const MAX_AGENT_OPS = vocabulary.max_ops
export const MAX_AGENT_TEXT = vocabulary.max_text
export const STEP_IDS = vocabulary.steps as readonly string[]
export const MODES = vocabulary.modes as readonly ('print' | 'contour' | 'both')[]
export const BLEND_MODES = vocabulary.blend_modes as readonly string[]
const CONTOUR_SOURCES = vocabulary.contour_sources as readonly ('shape' | 'card')[]

const HEX = /^#?[0-9a-f]{6}$/i

type ParamSpec = {
  prop: string
  type: 'number' | 'boolean' | 'enum' | 'color'
  min?: number
  max?: number
  integer?: boolean
  nullable?: boolean
  values?: string[]
}

type GenericOp = { target: 'word' | 'bg' | 'contour' | 'style'; params: Record<string, ParamSpec> }

const GENERIC_OPS = vocabulary.generic_ops as unknown as Record<string, GenericOp>

/** Something that is not a plain settings patch: it touches derived artifacts or navigation. */
export type HostSource =
  | { kind: 'background_simple' }
  | { kind: 'contour_source'; source: 'shape' | 'card' }
  | { kind: 'sample_text'; text: string }
  | { kind: 'select_word'; index: number }
  | { kind: 'show_step'; step: string }

export type AgentStep =
  | { patch: { target: 'word'; index: number; patch: Record<string, unknown> } }
  | { patch: { target: 'bg' | 'contour' | 'style'; patch: Record<string, unknown> } }
  | { mode: 'print' | 'contour' | 'both' }
  | { history: { kind: 'undo' | 'redo'; count: number } }
  | { host: HostSource }

export interface AgentContext {
  /** How many words (code fields) the card has now. */
  wordCount: number
  /** Whether the words come from an uploaded file: their text is then not the agent's to set. */
  textFromFile: boolean
}

export interface AgentResult {
  steps: AgentStep[]
  /** One line per refused operation, in the order given, for the agent to read. */
  rejected: string[]
}

declare global {
  interface Window {
    /** Registered by `App` while mounted. */
    pdfcodesAgent?: {
      read: () => unknown
      apply: (ops: unknown) => Promise<{ applied: number; rejected: string[] }>
    }
  }
}

/** A finite number from the agent, held to the editor's own bounds; null if it is not a number. */
function bounded(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null
}

/**
 * The CMYK string whose on-screen rendering is the requested colour, the same inversion the
 * editor's eyedropper uses, so what the customer sees is what the agent asked for.
 */
function hexToCmyk(hex: string): string {
  const h = hex.replace('#', '')
  const rgb = { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
  // Black, white and greys are pure K: the inversion would answer a rich CMYK mix that
  // prints as four plates and registers badly on small text.
  if (rgb.r === rgb.g && rgb.g === rgb.b) return formatCmyk({ c: 0, m: 0, y: 0, k: 1 - rgb.r / 255 })
  return formatCmyk(rgbToCmykPrint(rgb))
}

type Patch = { patch: Record<string, unknown> } | { error: string }

/**
 * The settings patch a table-driven operation names, or why it is refused. A wrong type, a
 * value outside a list, a malformed colour, or nothing named refuses the whole operation;
 * numbers are clamped to the editor's own range. `null` is a value only where a setting can
 * be cleared (`nullable`).
 */
function genericPatch(spec: GenericOp, o: Record<string, unknown>): Patch {
  const patch: Record<string, unknown> = {}
  for (const [key, param] of Object.entries(spec.params)) {
    const value = o[key]
    if (value === undefined) continue
    if (value === null) {
      if (!param.nullable) return { error: `${key} cannot be null` }
      patch[param.prop] = null
      continue
    }
    switch (param.type) {
      case 'number': {
        const n = bounded(value, param.min ?? -Infinity, param.max ?? Infinity)
        if (n === null) return { error: `${key} must be a number` }
        patch[param.prop] = param.integer ? Math.round(n) : n
        break
      }
      case 'boolean':
        if (typeof value !== 'boolean') return { error: `${key} must be true or false` }
        patch[param.prop] = value
        break
      case 'enum': {
        const hit = param.values?.find((v) => v === value)
        if (hit === undefined) return { error: `${key} must be one of ${param.values?.join(', ')}` }
        patch[param.prop] = hit
        break
      }
      case 'color':
        if (typeof value !== 'string' || !HEX.test(value.trim())) return { error: `${key} must be #rrggbb` }
        patch[param.prop] = hexToCmyk(value.trim())
        break
    }
  }
  if (Object.keys(patch).length === 0) return { error: 'nothing to change' }
  return { patch }
}

function wordIndex(value: unknown, count: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count ? value : null
}

/**
 * @param ops Whatever the agent sent. Anything that is not a list yields nothing.
 */
export function agentActions(ops: unknown, ctx: AgentContext): AgentResult {
  const steps: AgentStep[] = []
  const rejected: string[] = []

  if (!Array.isArray(ops)) {
    rejected.push('ops must be a list')
    return { steps, rejected }
  }

  ops.slice(0, MAX_AGENT_OPS).forEach((entry, i) => {
    const o = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const name = typeof o.op === 'string' ? o.op : ''
    const refuse = (why: string) => void rejected.push(`${name || `#${i + 1}`}: ${why}`)
    const spec = GENERIC_OPS[name]

    if (spec) {
      const result = genericPatch(spec, o)
      if ('error' in result) return refuse(result.error)

      switch (spec.target) {
        case 'word': {
          const index = wordIndex(o.word, ctx.wordCount)
          if (index === null) return refuse(`word must be a whole number from 0 to ${ctx.wordCount - 1}`)
          const patch = { ...result.patch }
          // A baseline set by hand is a custom position, or the vertical alignment would
          // put it back on the next render.
          if ('yMm' in patch && !('valign' in patch)) patch.valign = 'custom'
          steps.push({ patch: { target: 'word', index, patch } })
          return
        }
        case 'bg':
          steps.push({ host: { kind: 'background_simple' } })
          steps.push({ patch: { target: 'bg', patch: result.patch } })
          return
        case 'contour':
          steps.push({ patch: { target: 'contour', patch: result.patch } })
          return
        case 'style':
          steps.push({ patch: { target: 'style', patch: result.patch } })
          return
      }
    }

    switch (name) {
      case 'set_contour_source': {
        const source = CONTOUR_SOURCES.find((s) => s === o.source)
        if (!source) return refuse(`source must be one of ${CONTOUR_SOURCES.join(', ')}`)
        steps.push({ host: { kind: 'contour_source', source } })
        return
      }
      case 'set_mode': {
        const mode = MODES.find((m) => m === o.mode)
        if (!mode) return refuse(`mode must be one of ${MODES.join(', ')}`)
        steps.push({ mode })
        return
      }
      case 'set_sample_text': {
        if (ctx.textFromFile) return refuse('the codes come from an uploaded file; the customer changes them in the Date step')
        if (typeof o.text !== 'string' || o.text.trim() === '') return refuse('text must be a non-empty string')
        steps.push({ host: { kind: 'sample_text', text: o.text.trim().slice(0, MAX_AGENT_TEXT) } })
        return
      }
      case 'select_word': {
        const index = wordIndex(o.word, ctx.wordCount)
        if (index === null) return refuse(`word must be a whole number from 0 to ${ctx.wordCount - 1}`)
        steps.push({ host: { kind: 'select_word', index } })
        return
      }
      case 'show_step': {
        const step = STEP_IDS.find((s) => s === o.step)
        if (!step) return refuse(`step must be one of ${STEP_IDS.join(', ')}`)
        steps.push({ host: { kind: 'show_step', step } })
        return
      }
      case 'undo':
      case 'redo': {
        const count = o.count === undefined ? 1 : bounded(o.count, 1, 5)
        if (count === null) return refuse('count must be a number')
        steps.push({ history: { kind: name, count: Math.round(count) } })
        return
      }
      default:
        refuse('unknown operation')
    }
  })

  return { steps, rejected }
}
