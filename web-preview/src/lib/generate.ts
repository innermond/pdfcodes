// Result shape for a generation job. The actual generation runs off the main
// thread in `generateWorker.ts` (driven via `generateBatched.ts`); this module
// only holds the shared result type consumed by the UI.
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
