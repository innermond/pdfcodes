// Sinks for assembling the print ZIP (one store-only entry per batch PDF).
//
// Small/medium archives are kept in memory (ArraySink). Large ones — which would
// otherwise buffer the whole ZIP (≈ Σ batch-PDFs) in the worker heap and risk an
// out-of-memory crash — are streamed to a unique OPFS temp file (OpfsSink) via a
// worker FileSystemSyncAccessHandle, keeping memory at ~one batch. When neither
// RAM nor OPFS can hold the estimated archive, `createZipSink` throws
// ZipTooLargeError so the caller can surface a clear message.

import { m } from '../paraglide/messages'
import { formatNumber } from './formatNumber'

// `navigator.deviceMemory` (approximate device RAM in GB) isn't in the current
// lib typings; OPFS sync-access types already are. Augment only what's missing.
declare global {
  interface WorkerNavigator {
    readonly deviceMemory?: number
  }
  interface Navigator {
    readonly deviceMemory?: number
  }
}

export interface ZipSink {
  /** Append a chunk emitted by the zip writer (called synchronously). */
  write(chunk: Uint8Array): void
  /** Flush/close and return the finished archive as a Blob. */
  finish(): Promise<Blob>
  /** Best-effort cleanup on cancel/error (removes any temp file). */
  dispose(): Promise<void>
}

export type SinkKind = 'memory' | 'opfs'

export class ZipTooLargeError extends Error {
  readonly estimateBytes: number
  constructor(estimateBytes: number) {
    const mb = Math.round(estimateBytes / (1024 * 1024))
    super(m.errors_zip_too_large({ mb: formatNumber(mb) }))
    this.name = 'ZipTooLargeError'
    this.estimateBytes = estimateBytes
  }
}

// Tunables for the RAM-safe budget and OPFS headroom (see plan).
const ZIP_RAM_FRACTION = 0.1 // share of device RAM we'll build a ZIP in (absorbs the ~2× transient peak)
const DEFAULT_DEVICE_GB = 4 // assumed RAM when navigator.deviceMemory is unavailable (Firefox/Safari)
const QUOTA_MARGIN = 0.8 // leave OPFS storage headroom
const GiB = 1024 ** 3

const OPFS_ZIP_PREFIX = 'cards-'
const OPFS_ZIP_SUFFIX = '.zip'

// Largest ZIP we're comfortable building entirely in RAM on this device.
function ramSafeZipBytes(): number {
  const gb = navigator.deviceMemory ?? DEFAULT_DEVICE_GB
  return gb * GiB * ZIP_RAM_FRACTION
}

// The OPFS root, but only when the worker-only synchronous write API is present
// (the fast path that fits the synchronous zip callback). Null otherwise.
async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!navigator.storage?.getDirectory) return null
    if (typeof FileSystemFileHandle === 'undefined' || !('createSyncAccessHandle' in FileSystemFileHandle.prototype)) return null
    return await navigator.storage.getDirectory()
  } catch {
    return null
  }
}

async function opfsFreeBytes(): Promise<number> {
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate()
    return Math.max(0, quota - usage)
  } catch {
    return 0
  }
}

class ArraySink implements ZipSink {
  // ArrayBuffer-backed copies so they're valid BlobParts (not SharedArrayBuffer),
  // and because fflate may reuse the emitted chunk after the callback returns.
  private chunks: Uint8Array<ArrayBuffer>[] = []
  write(chunk: Uint8Array): void {
    this.chunks.push(new Uint8Array(chunk))
  }
  async finish(): Promise<Blob> {
    return new Blob(this.chunks, { type: 'application/zip' })
  }
  async dispose(): Promise<void> {
    this.chunks = []
  }
}

class OpfsSink implements ZipSink {
  private offset = 0
  private readonly root: FileSystemDirectoryHandle
  private readonly fileHandle: FileSystemFileHandle
  private readonly name: string
  private readonly handle: FileSystemSyncAccessHandle

  private constructor(
    root: FileSystemDirectoryHandle,
    fileHandle: FileSystemFileHandle,
    name: string,
    handle: FileSystemSyncAccessHandle,
  ) {
    this.root = root
    this.fileHandle = fileHandle
    this.name = name
    this.handle = handle
  }

  static async create(root: FileSystemDirectoryHandle, name: string): Promise<OpfsSink> {
    const fileHandle = await root.getFileHandle(name, { create: true })
    const handle = await fileHandle.createSyncAccessHandle()
    handle.truncate(0)
    return new OpfsSink(root, fileHandle, name, handle)
  }

  // Synchronous disk write — no need to retain the chunk, so unlike ArraySink we
  // don't copy it (that's the whole point: keep memory at ~one batch).
  write(chunk: Uint8Array): void {
    this.offset += this.handle.write(chunk, { at: this.offset })
  }

  async finish(): Promise<Blob> {
    this.handle.flush()
    this.handle.close()
    // getFile() must run after the access handle is closed (it locks the file).
    return this.fileHandle.getFile()
  }

  async dispose(): Promise<void> {
    try {
      this.handle.close()
    } catch {
      /* already closed */
    }
    await this.root.removeEntry(this.name).catch(() => {})
  }
}

// Pick a sink for an estimated archive size: RAM when it fits the device budget,
// else a streamed OPFS temp file, else throw ZipTooLargeError.
export async function createZipSink(estimateBytes: number): Promise<{ sink: ZipSink; kind: SinkKind }> {
  if (estimateBytes <= ramSafeZipBytes()) return { sink: new ArraySink(), kind: 'memory' }
  const root = await getOpfsRoot()
  if (root && estimateBytes <= (await opfsFreeBytes()) * QUOTA_MARGIN) {
    const name = `${OPFS_ZIP_PREFIX}${crypto.randomUUID()}${OPFS_ZIP_SUFFIX}`
    return { sink: await OpfsSink.create(root, name), kind: 'opfs' }
  }
  throw new ZipTooLargeError(estimateBytes)
}

// Delete leftover temp ZIPs from previous runs. Called at the start of a run
// rather than after finishing one, because a finished archive's Blob is read
// lazily by the download and must outlive the worker.
export async function sweepStaleZips(): Promise<void> {
  const root = await getOpfsRoot()
  if (!root) return
  try {
    const dir = root as FileSystemDirectoryHandle & { keys?: () => AsyncIterableIterator<string> }
    if (!dir.keys) return
    for await (const name of dir.keys()) {
      if (name.startsWith(OPFS_ZIP_PREFIX) && name.endsWith(OPFS_ZIP_SUFFIX)) {
        await root.removeEntry(name).catch(() => {})
      }
    }
  } catch {
    /* ignore */
  }
}
