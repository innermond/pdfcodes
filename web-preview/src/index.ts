// Public entry point for consuming pdfcodes as a component rather than as the
// standalone page — pd.ro vendors this repo as a git submodule and mounts
// <PdfCodesApp /> into a Blade-rendered div (see its resources/js/pdfcodes-entry.tsx).
//
// `parseHostPreset` is exported alongside because such a host reads the preset
// descriptor off a DOM dataset, which is untrusted string input: it must be
// validated before it becomes an <App preset={…}> prop, and this is the same
// validator the standalone window-global path uses.
export { default as PdfCodesApp } from './App'
export { parseHostPreset, type HostPreset } from './lib/hostPreset'
