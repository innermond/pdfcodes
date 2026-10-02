// One code-split module, fetched at most once.
//
// The same helper bizcard and wallcal use for their panels. `load` is what
// `React.lazy` goes through; `preload` is for a hover or a focus, so the chunk
// is usually there by the click. A failed fetch is forgotten rather than cached, so a later attempt
// can retry a transient network error instead of failing for the whole visit.

export interface LazyChunk<M> {
  /** The module, fetched on the first call and shared by every later one. */
  load: () => Promise<M>
  /** Warms the chunk without waiting on it or caring whether it failed. */
  preload: () => void
}

export function lazyChunk<M>(importer: () => Promise<M>): LazyChunk<M> {
  let pending: Promise<M> | null = null

  const load = (): Promise<M> => {
    pending ??= importer().catch((err: unknown) => {
      pending = null
      throw err
    })
    return pending
  }

  return {
    load,
    preload: () => {
      load().catch(() => undefined)
    },
  }
}
