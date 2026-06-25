/// <reference lib="webworker" />
// Off-main-thread PDF generation. The print job is produced in page-aligned
// row batches: each batch is a complete small PDF built by `generate_with_options`
// and then freed, so peak wasm memory stays ~one batch instead of the whole job.
// Batch PDFs are streamed into a ZIP (fflate, store-only). The contour sheet is a
// single PDF. Progress (incl. live wasm memory) and cancellation are messaged.
import init, { cards_per_page, generate_with_options, type WasmGenerateOutput } from '../wasm/pdfcodes'
import { Zip, ZipPassThrough } from 'fflate'

interface StartData {
  mode: 'print' | 'contour' | 'both'
  background: ArrayBuffer
  contour: ArrayBuffer | null
  fonts: ArrayBuffer[]
  printOptions: Record<string, unknown> | null
  contourOptions: Record<string, unknown> | null
  pagesPerBatch: number
  totalRows: number | null
  csv: Blob | null
}

interface ContourResult {
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

let memory: WebAssembly.Memory | null = null
let inited = false
let cancelled = false

function post(msg: unknown, transfer: Transferable[] = []) {
  ;(self as unknown as Worker).postMessage(msg, transfer)
}

function wasmBytes(): number {
  return memory ? memory.buffer.byteLength : 0
}

async function ensureInit() {
  if (!inited) {
    const out = await init()
    memory = out.memory
    inited = true
  }
}

function extractContour(out: WasmGenerateOutput): ContourResult {
  const result: ContourResult = {
    pdf: out.pdf.slice(),
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

// Yield CSV records one line at a time without ever holding the whole file. The
// app's generated codes never contain embedded newlines, so a line is a record.
async function* readLines(blob: Blob): AsyncGenerator<string> {
  const reader = blob.stream().pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += value
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '')
      buf = buf.slice(nl + 1)
      if (line.length > 0) yield line
    }
  }
  const last = buf.replace(/\r$/, '')
  if (last.length > 0) yield last
}

async function generatePrint(
  d: StartData,
  bg: Uint8Array,
  contourBg: Uint8Array | null,
  fonts: Uint8Array[],
): Promise<{ blob: Blob; isZip: boolean; name: string } | null> {
  const perPage = Math.max(1, cards_per_page(bg, d.printOptions))
  const batchRows = Math.max(1, d.pagesPerBatch * perPage)
  const combine = d.printOptions!.combine === true
  const contourArg = combine ? contourBg ?? undefined : undefined

  // ArrayBuffer-backed copies so they're valid BlobParts (not SharedArrayBuffer).
  //
  // MEMORY: unlike the CSV input (streamed line-by-line in `readLines`, only one
  // batch ever copied into wasm), the ZIP *output* is fully buffered here —
  // `zipChunks` holds every emitted chunk until `new Blob(zipChunks)` below, and
  // ZipPassThrough is store-only, so the archive ≈ the sum of all batch PDFs.
  // For "lots" of pages this is the app's real memory ceiling (hundreds of MB in
  // the worker heap, ~2× transiently while the Blob is built). If that becomes a
  // problem, stream chunks straight to disk instead of accumulating: write each
  // chunk to a unique OPFS temp file via a worker FileSystemSyncAccessHandle
  // (sync, fits this callback), then getFile() it for download — needs stale-file
  // cleanup at next run + QuotaExceededError handling. (File System Access'
  // showSaveFilePicker→createWritable would stream to the final download with no
  // temp file, but is Chromium-only and must prompt before generating.)
  const zipChunks: Uint8Array<ArrayBuffer>[] = []
  let zipErr: unknown = null
  // ZipPassThrough is synchronous (no deflate), so the sink fills during push/end.
  // Copy each emitted chunk immediately so fflate can't reuse the buffer later.
  const zip = new Zip((err, chunk) => {
    if (err) zipErr = err
    if (chunk) zipChunks.push(new Uint8Array(chunk))
  })

  let rowsDone = 0
  let batchIndex = 0
  // Object holder so the first-batch PDF survives TS control-flow narrowing
  // (it's assigned inside the `flush` closure).
  const first: { pdf: Uint8Array<ArrayBuffer> | null } = { pdf: null }
  let batch: string[] = []

  const flush = () => {
    const out = generate_with_options(batch.join('\n'), bg, contourArg, fonts, d.printOptions)
    const pdf = new Uint8Array(out.pdf)
    out.free()
    batch = []
    batchIndex++
    if (batchIndex === 1) first.pdf = pdf
    const entry = new ZipPassThrough(`cards-${String(batchIndex).padStart(4, '0')}.pdf`)
    zip.add(entry)
    entry.push(pdf, true)
    post({ type: 'progress', phase: 'print', rowsDone, totalRows: d.totalRows, batchesDone: batchIndex, wasmBytes: wasmBytes() })
  }

  for await (const line of readLines(d.csv!)) {
    if (cancelled) break
    batch.push(line)
    rowsDone++
    if (batch.length >= batchRows) flush()
  }
  if (cancelled) return null
  if (batch.length > 0) flush()
  if (zipErr) throw zipErr instanceof Error ? zipErr : new Error(String(zipErr))
  if (batchIndex === 0) return null

  // One batch → hand back a single PDF (today's UX) rather than a 1-entry ZIP.
  if (batchIndex === 1 && first.pdf) {
    return { blob: new Blob([first.pdf], { type: 'application/pdf' }), isZip: false, name: 'cards.pdf' }
  }
  zip.end()
  return { blob: new Blob(zipChunks, { type: 'application/zip' }), isZip: true, name: 'cards.zip' }
}

async function run(d: StartData) {
  await ensureInit()
  const bg = new Uint8Array(d.background)
  const contourBg = d.contour ? new Uint8Array(d.contour) : null
  const fonts = d.fonts.map((f) => new Uint8Array(f))

  let print: { blob: Blob; isZip: boolean; name: string } | null = null
  if ((d.mode === 'print' || d.mode === 'both') && d.printOptions && d.csv) {
    print = await generatePrint(d, bg, contourBg, fonts)
    if (cancelled) {
      post({ type: 'cancelled' })
      return
    }
  }

  let contour: ContourResult | null = null
  if ((d.mode === 'contour' || d.mode === 'both') && d.contourOptions && contourBg) {
    post({ type: 'progress', phase: 'contour', rowsDone: 0, totalRows: d.totalRows, batchesDone: 0, wasmBytes: wasmBytes() })
    // The contour sheet only needs the CSV to scale cutting-time metrics, and
    // only when path measurement is enabled — otherwise skip loading it.
    const needCsv = d.contourOptions.measurePaths === true && d.csv !== null
    const csvText = needCsv ? await d.csv!.text() : undefined
    // Pass no fonts: contour PDFs contain no text so embedding fonts is
    // wasteful. The Rust side also skips embed_fonts in contour mode, but
    // passing an empty array here makes the intent explicit and prevents
    // accidental font bloat if that guard ever changes.
    const out = generate_with_options(csvText, contourBg, undefined, [], d.contourOptions)
    contour = extractContour(out)
  }

  post({ type: 'done', print, contour }, contour ? [contour.pdf.buffer] : [])
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data
  if (msg?.type === 'cancel') {
    cancelled = true
    return
  }
  if (msg?.type !== 'start') return
  run(msg.data as StartData).catch((err) => {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  })
}
