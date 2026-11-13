// What the shop's assistant is told about the open pdfcodes editor.
//
// The other half of the door `agentOps.ts` describes: that file turns an untrusted list of
// operations into editor changes, this one produces the snapshot the assistant reads before
// writing any. The host posts it as `editor_state`, so it is a wire format. Every setting an
// operation can change is read back under the same property name the vocabulary table gives
// it (colours as #rrggbb), so a new row in `agentVocabulary.json` is reported without a
// change here. Deliberately *not* here: files, the generated PDF, the code list of an upload.

import vocabulary from './agentVocabulary.json'
import { cmykToRgb, parseCmyk } from './cmyk'

/** A stored colour as #rrggbb, for the snapshot the agent reads. */
function cmykToHex(value: string): string {
  const { r, g, b } = cmykToRgb(parseCmyk(value))
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

type Param = { prop: string; type: string }
type Table = Record<string, { target: string; params: Record<string, Param> }>
const OPS = vocabulary.generic_ops as unknown as Table

/** The properties the table-driven operations of one target can set. */
function props(target: string): Param[] {
  return Object.values(OPS)
    .filter((op) => op.target === target)
    .flatMap((op) => Object.values(op.params))
}

function read(source: Record<string, unknown>, params: Param[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const { prop, type } of params) {
    const value = source[prop]
    if (value === undefined) continue
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    out[prop] = type === 'color' && typeof value === 'string' ? cmykToHex(value) : value
  }
  return out
}

export interface PdfCodesDescription {
  step: string
  mode: string
  selectedWord: number | null
  /** True when the codes come from an uploaded file, so their text is not the agent's to set. */
  textFromFile: boolean
  sampleText: string
  words: Record<string, unknown>[]
  background: Record<string, unknown>
  contour: Record<string, unknown>
  style: Record<string, unknown>
}

export interface PdfCodesStateSource {
  step: string
  mode: string
  selectedIndex: number | null
  textFromFile: boolean
  sampleText: string
  words: Record<string, unknown>[]
  bgConfig: Record<string, unknown>
  contourConfig: Record<string, unknown>
  styleConfig: Record<string, unknown>
}

export function describePdfCodes(s: PdfCodesStateSource): PdfCodesDescription {
  return {
    step: s.step,
    mode: s.mode,
    selectedWord: s.selectedIndex,
    textFromFile: s.textFromFile,
    sampleText: s.sampleText.slice(0, vocabulary.max_text),
    words: s.words.slice(0, vocabulary.max_words).map((w, index) => ({
      index,
      text: String(w.text ?? '').slice(0, vocabulary.max_text),
      payloadTemplate: String(w.payloadTemplate ?? '').slice(0, vocabulary.max_text),
      ...read(w, props('word')),
    })),
    background: { source: s.bgConfig.backgroundSource, ...read(s.bgConfig, props('bg')) },
    contour: { source: s.contourConfig.contourSource, ...read(s.contourConfig, props('contour')) },
    style: read(s.styleConfig, props('style')),
  }
}
