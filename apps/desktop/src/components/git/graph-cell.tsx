import type { GraphRow } from '@/lib/git-graph'

// Per-row SVG renderer for the commit graph. Draws a fixed-height cell with the
// lane edges (top→midline, midline→bottom) and the commit dot. Lane colors come
// from a CSS-var palette so they adapt to the active skin/theme.

// Theme-aware lane palette (8 hues cycling). Uses semantic-ish CSS color tokens
// that exist across skins, falling back to a hue ramp.
const LANE_COLORS = [
  'var(--git-graph-1, #4e9bff)',
  'var(--git-graph-2, #56c271)',
  'var(--git-graph-3, #d8863b)',
  'var(--git-graph-4, #c264d6)',
  'var(--git-graph-5, #e0556e)',
  'var(--git-graph-6, #3bc0c8)',
  'var(--git-graph-7, #b0b34a)',
  'var(--git-graph-8, #7d8df0)'
]

const COL_WIDTH = 14 // px per lane column
const ROW_HEIGHT = 24 // px — must match the commit row height
const DOT_RADIUS = 3.5

function laneColor(index: number): string {
  return LANE_COLORS[((index % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length]
}

const colX = (col: number) => col * COL_WIDTH + COL_WIDTH / 2

interface GraphCellProps {
  row: GraphRow
  // Max lane width across the visible page, so every cell reserves the same
  // horizontal space and the message column starts at a stable x.
  maxWidth: number
}

export function GraphCell({ row, maxWidth }: GraphCellProps) {
  const width = Math.max(maxWidth, 1) * COL_WIDTH
  const mid = ROW_HEIGHT / 2
  const dotX = colX(row.commitCol)

  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      height={ROW_HEIGHT}
      style={{ width }}
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      width={width}
    >
      {/* Top half: cell top → midline */}
      {row.top.map((edge, i) => (
        <path
          d={edgePath(colX(edge.fromCol), 0, colX(edge.toCol), mid)}
          fill="none"
          key={`t${i}`}
          stroke={laneColor(edge.color)}
          strokeWidth={1.5}
        />
      ))}
      {/* Bottom half: midline → cell bottom */}
      {row.bottom.map((edge, i) => (
        <path
          d={edgePath(colX(edge.fromCol), mid, colX(edge.toCol), ROW_HEIGHT)}
          fill="none"
          key={`b${i}`}
          stroke={laneColor(edge.color)}
          strokeWidth={1.5}
        />
      ))}
      {/* Commit dot */}
      <circle
        cx={dotX}
        cy={mid}
        fill={row.isMerge ? 'var(--ui-sidebar-surface-background)' : laneColor(row.commitColor)}
        r={DOT_RADIUS}
        stroke={laneColor(row.commitColor)}
        strokeWidth={row.isMerge ? 1.5 : 0}
      />
    </svg>
  )
}

// A lane edge: straight when columns match, else a smooth S-curve between
// columns (Bezier) so merges/forks read cleanly.
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }

  const midY = (y1 + y2) / 2

  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
}

export const GRAPH_COL_WIDTH = COL_WIDTH
export const GRAPH_ROW_HEIGHT = ROW_HEIGHT
