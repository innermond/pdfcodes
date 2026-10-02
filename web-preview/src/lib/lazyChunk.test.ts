import { describe, expect, it, vi } from 'vitest'
import { lazyChunk } from './lazyChunk'

describe('a lazy chunk', () => {
  it('is not fetched until it is asked for', () => {
    const importer = vi.fn(() => Promise.resolve({ value: 1 }))
    lazyChunk(importer)
    expect(importer).not.toHaveBeenCalled()
  })

  it('is fetched once however often it is loaded', async () => {
    const importer = vi.fn(() => Promise.resolve({ value: 1 }))
    const chunk = lazyChunk(importer)

    const [a, b] = await Promise.all([chunk.load(), chunk.load()])
    await chunk.load()

    expect(importer).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('is fetched again after a failure', async () => {
    const importer = vi
      .fn<() => Promise<{ value: number }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ value: 2 })
    const chunk = lazyChunk(importer)

    await expect(chunk.load()).rejects.toThrow('offline')
    await expect(chunk.load()).resolves.toEqual({ value: 2 })
    expect(importer).toHaveBeenCalledTimes(2)
  })

  it('swallows a failed preload, which leaves the chunk retryable', async () => {
    const importer = vi
      .fn<() => Promise<{ value: number }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ value: 3 })
    const chunk = lazyChunk(importer)

    chunk.preload()
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(chunk.load()).resolves.toEqual({ value: 3 })
  })
})
