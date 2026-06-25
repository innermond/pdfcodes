/// <reference lib="webworker" />
// Off-main-thread PDF generation. The print job is produced in page-aligned
// row batches: each batch is a complete small PDF built by `generate_with_options`
// and then freed, so peak wasm memory stays ~one batch instead of the whole job.
// Batch PDFs are streamed into a ZIP (fflate, store-only). The contour sheet is a
// single PDF. Progress (incl. live wasm memory) and cancellation are messaged.
import init, { cards_per_page, generate_with_options, type WasmGenerateOutput } from '../wasm/pdfcodes'
import { Zip, ZipPassThrough } from 'fflate'
import { createZipSink, sweepStaleZips, type SinkKind, type ZipSink } from './zipSink'

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
  // "cu contur": bundle the contour PDF as a separate entry in the print
  // archive (which is then always a ZIP). Only set when there is a print job
  // and a contour input; the standalone contour output is suppressed instead.
  bundleContour: boolean
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
  // When set ("cu contur"), this single contour PDF is added as the first entry
  // of the print archive, which is then always emitted as a ZIP.
  bundledContourPdf: Uint8Array | null,
): Promise<{ blob: Blob; isZip: boolean; name: string; sink?: SinkKind } | null> {
  const perPage = Math.max(1, cards_per_page(bg, d.printOptions))
  const batchRows = Math.max(1, d.pagesPerBatch * perPage)
  const combine = d.printOptions!.combine === true
  const contourArg = combine ? contourBg ?? undefined : undefined
  // Expected batch count (known up front), used to estimate the final ZIP size
  // from the measured first batch. Null when the row total is unknown.
  const batchCount = d.totalRows != null ? Math.max(1, Math.ceil(d.totalRows / batchRows)) : null

  // The ZIP output (≈ Σ batch-PDFs, store-only) is the app's real memory ceiling.
  // Rather than buffer it all in RAM, we defer choosing where it goes until the
  // first batch is produced: `createZipSink` measures `firstPdf.length * batchCount`
  // and returns an in-memory sink when it fits a RAM budget, or a streamed OPFS
  // temp-file sink when it doesn't (throwing ZipTooLargeError when neither can).
  // The zip writer is therefore created lazily, only once a 2nd batch proves a
  // ZIP is needed (a single batch is returned as a lone PDF, as before).
  // Object holders so the sink/zip survive TS control-flow narrowing (they're
  // assigned inside the `ensureZip`/`flush` closures), mirroring `first` below.
  const z: { sink: ZipSink | null; zip: Zip | null } = { sink: null, zip: null }
  let sinkKind: SinkKind = 'memory'
  let zipErr: unknown = null

  let rowsDone = 0
  let batchIndex = 0
  const first: { pdf: Uint8Array<ArrayBuffer> | null } = { pdf: null }
  let batch: string[] = []

  const addEntry = (pdf: Uint8Array, index: number) => {
    addNamedEntry(pdf, `cards-${String(index).padStart(4, '0')}.pdf`)
  }

  const addNamedEntry = (pdf: Uint8Array, name: string) => {
    const entry = new ZipPassThrough(name)
    z.zip!.add(entry)
    entry.push(pdf, true)
  }

  // Create the sink + zip writer on the first batch that proves a ZIP is needed,
  // then (re)emit the held first-batch entry. ZipPassThrough is synchronous, so
  // the sink fills during push/end.
  const ensureZip = async () => {
    if (z.zip) return
    const estimate = (first.pdf?.length ?? 0) * (batchCount ?? 1) + (bundledContourPdf?.length ?? 0)
    const picked = await createZipSink(estimate) // may throw ZipTooLargeError
    z.sink = picked.sink
    sinkKind = picked.kind
    z.zip = new Zip((err, chunk) => {
      if (err) zipErr = err
      if (chunk) z.sink!.write(chunk)
    })
    // The contour goes in first so it leads the archive.
    if (bundledContourPdf) addNamedEntry(bundledContourPdf, 'contur.pdf')
    addEntry(first.pdf!, 1)
  }

  const flush = async () => {
    const out = generate_with_options(batch.join('\n'), bg, contourArg, fonts, d.printOptions)
    const pdf = new Uint8Array(out.pdf)
    out.free()
    batch = []
    batchIndex++
    if (batchIndex === 1) {
      first.pdf = pdf // hold; its zip entry is deferred until a 2nd batch appears
    } else {
      await ensureZip()
      addEntry(pdf, batchIndex)
    }
    post({ type: 'progress', phase: 'print', rowsDone, totalRows: d.totalRows, batchesDone: batchIndex, wasmBytes: wasmBytes() })
  }

  try {
    for await (const line of readLines(d.csv!)) {
      if (cancelled) break
      batch.push(line)
      rowsDone++
      if (batch.length >= batchRows) await flush()
    }
    if (cancelled) {
      await z.sink?.dispose()
      return null
    }
    if (batch.length > 0) await flush()
    if (zipErr) throw zipErr instanceof Error ? zipErr : new Error(String(zipErr))
    if (batchIndex === 0) return null

    // One batch → hand back a single PDF (today's UX) rather than a 1-entry ZIP,
    // unless a contour is bundled in, which forces an archive.
    if (batchIndex === 1 && first.pdf && !bundledContourPdf) {
      return { blob: new Blob([first.pdf], { type: 'application/pdf' }), isZip: false, name: 'cards.pdf' }
    }
    // `ensureZip` may not have run yet (e.g. a single batch with a bundled
    // contour); create the archive now and emit the held first batch.
    await ensureZip()
    z.zip!.end()
    const blob = await z.sink!.finish()
    return { blob, isZip: true, name: 'cards.zip', sink: sinkKind }
  } catch (e) {
    await z.sink?.dispose()
    throw e
  }
}

async function run(d: StartData) {
  await ensureInit()
  const bg = new Uint8Array(d.background)
  const contourBg = d.contour ? new Uint8Array(d.contour) : null
  const fonts = d.fonts.map((f) => new Uint8Array(f))

  const hasPrintJob = (d.mode === 'print' || d.mode === 'both') && d.printOptions !== null && d.csv !== null
  const bundleContour = d.bundleContour && hasPrintJob && contourBg !== null && d.contourOptions !== null

  // "cu contur": build the single contour page once, up front, so it can lead
  // the print archive. No CSV/fonts needed — it's just the outline.
  let bundledContourPdf: Uint8Array | null = null
  if (bundleContour) {
    const out = generate_with_options(undefined, contourBg!, undefined, [], d.contourOptions!)
    bundledContourPdf = out.pdf.slice()
    out.free()
  }

  let print: { blob: Blob; isZip: boolean; name: string; sink?: SinkKind } | null = null
  if (hasPrintJob) {
    // Clear any leftover OPFS temp ZIPs from previous runs before this one starts
    // (a finished archive's file must outlive its own run, so it can't self-clean).
    await sweepStaleZips()
    print = await generatePrint(d, bg, contourBg, fonts, bundledContourPdf)
    if (cancelled) {
      post({ type: 'cancelled' })
      return
    }
  }

  // The standalone contour output is suppressed when it's bundled into the
  // print archive, so the contour isn't produced twice.
  let contour: ContourResult | null = null
  if ((d.mode === 'contour' || d.mode === 'both') && d.contourOptions && contourBg && !bundleContour) {
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
