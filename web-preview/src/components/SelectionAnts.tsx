// "Marching ants" selection: a static white dashed track with dark dashes filling
// its gaps, both animated in lockstep so the dashes appear to crawl. The two colors
// keep it visible on any background.
export function SelectionAnts({
  x,
  y,
  width,
  height,
  transform,
}: {
  x: number
  y: number
  width: number
  height: number
  transform?: string
}) {
  return (
    <g transform={transform} pointerEvents="none">
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke="#ffffff"
        strokeWidth={0.75}
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
      >
        <animate attributeName="stroke-dashoffset" values="0;8" dur="0.5s" repeatCount="indefinite" />
      </rect>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke="#1e3a8a"
        strokeWidth={0.75}
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
      >
        <animate attributeName="stroke-dashoffset" values="4;12" dur="0.5s" repeatCount="indefinite" />
      </rect>
    </g>
  )
}
