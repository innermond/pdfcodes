import { ensureWasmInit, generate_with_options, type WasmGenerateOutput } from './wasm'
import { toJsOptions, type FormState } from './options'

export interface GenerateInput {
  form: FormState
  contour: boolean
  csvFile: File | null
  backgroundFile: File
  contourBackgroundFile: File | null
  fontFiles: File[]
}

export interface GenerateResult {
  pdf: Uint8Array
  cardsPerPage: number
  pathLengthPerCardMm?: number
  pathLengthTotalMm?: number
  nodeCountPerCard?: number
  nodeCountTotal?: number
  sharpTurnCountPerCard?: number
  sharpTurnCountTotal?: number
  timeCuttingPerCardS?: number
  timeCuttingTotalS?: number
}

async function toUint8Array(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

function toResult(out: WasmGenerateOutput): GenerateResult {
  const result: GenerateResult = {
    pdf: out.pdf,
    cardsPerPage: out.cards_per_page,
    pathLengthPerCardMm: out.path_length_per_card_mm,
    pathLengthTotalMm: out.path_length_total_mm,
    nodeCountPerCard: out.node_count_per_card,
    nodeCountTotal: out.node_count_total,
    sharpTurnCountPerCard: out.sharp_turn_count_per_card,
    sharpTurnCountTotal: out.sharp_turn_count_total,
    timeCuttingPerCardS: out.time_cutting_per_card_s,
    timeCuttingTotalS: out.time_cutting_total_s,
  }
  out.free()
  return result
}

export async function generatePdf(input: GenerateInput): Promise<GenerateResult> {
  await ensureWasmInit()

  const csvData = input.csvFile ? await input.csvFile.text() : undefined
  const background = await toUint8Array(input.backgroundFile)
  const contourBackground = input.contourBackgroundFile
    ? await toUint8Array(input.contourBackgroundFile)
    : undefined
  const fontData = await Promise.all(input.fontFiles.map(toUint8Array))

  const out = generate_with_options(
    csvData,
    background,
    contourBackground,
    fontData,
    toJsOptions(input.form, input.contour),
  )

  return toResult(out)
}
