import { describe, it, expect } from 'vitest'
import { pickImageType } from './clipboardImage'

// Only the pure MIME-selection helper is unit-tested; `readImageBlobFromClipboard`,
// `imageBlobFromDataTransfer` and `blobToPngFile` need a browser (Clipboard API /
// createImageBitmap / canvas), so they're covered by the smoke + manual verification.
describe('pickImageType', () => {
  it('prefers png over other supported types', () => {
    expect(pickImageType(['image/webp', 'image/png', 'image/jpeg'])).toBe('image/png')
  })

  it('falls back to the declared order when png is absent', () => {
    expect(pickImageType(['image/webp', 'image/jpeg'])).toBe('image/jpeg')
  })

  it('accepts any image/* even if not in the preference list', () => {
    expect(pickImageType(['text/plain', 'image/avif'])).toBe('image/avif')
  })

  it('returns null when there is no image type', () => {
    expect(pickImageType(['text/plain', 'text/html'])).toBeNull()
    expect(pickImageType([])).toBeNull()
  })
})
