import { useRef } from 'react'
import { fontFamilyForWord, type LoadedFont } from '../lib/fonts'
import type { WordStyle } from '../lib/options'
import { WordOverlay } from './WordOverlay'

export function CardCanvas({
  backgroundImageUrl,
  cardWidthPt,
  cardHeightPt,
  contourImageUrl,
  contourWidthPt,
  contourHeightPt,
  contourOpacity,
  words,
  fonts,
  safeMarginMm,
  backgroundPaddingMm,
  selectedIndex,
  onSelect,
  onChangeWord,
}: {
  backgroundImageUrl: string | null
  cardWidthPt: number
  cardHeightPt: number
  contourImageUrl: string | null
  contourWidthPt: number
  contourHeightPt: number
  contourOpacity: number
  words: WordStyle[]
  fonts: (LoadedFont | null)[]
  safeMarginMm: number
  backgroundPaddingMm: number
  selectedIndex: number | null
  onSelect: (index: number) => void
  onChangeWord: (index: number, next: Partial<WordStyle>) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${cardWidthPt} ${cardHeightPt}`}
      className="w-full rounded border border-gray-200 bg-white dark:border-gray-700"
      style={{ aspectRatio: `${cardWidthPt} / ${cardHeightPt}` }}
    >
      {backgroundImageUrl && (
        <image href={backgroundImageUrl} x={0} y={0} width={cardWidthPt} height={cardHeightPt} preserveAspectRatio="none" />
      )}
      {contourImageUrl && (
        <image
          href={contourImageUrl}
          x={0}
          y={cardHeightPt - contourHeightPt}
          width={contourWidthPt}
          height={contourHeightPt}
          preserveAspectRatio="none"
          opacity={contourOpacity}
        />
      )}
      {words.map((word, index) => (
        <WordOverlay
          key={index}
          word={word}
          cardWidthPt={cardWidthPt}
          cardHeightPt={cardHeightPt}
          safeMarginMm={safeMarginMm}
          backgroundPaddingMm={backgroundPaddingMm}
          fontFamily={fontFamilyForWord(fonts, index)}
          selected={selectedIndex === index}
          svgRef={svgRef}
          onSelect={() => onSelect(index)}
          onChange={(next) => onChangeWord(index, next)}
        />
      ))}
    </svg>
  )
}
