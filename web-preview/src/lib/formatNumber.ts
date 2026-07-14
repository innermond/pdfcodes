// Locale-aware number formatting driven by the build-time Paraglide locale,
// replacing the hardcoded 'ro-RO' toLocaleString calls scattered through the UI.
import { getLocale } from '../paraglide/runtime'

export function formatNumber(n: number): string {
  return n.toLocaleString(getLocale())
}
