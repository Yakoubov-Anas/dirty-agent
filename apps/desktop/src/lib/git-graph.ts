// Commit-graph lane assignment. Turns a topologically-ordered commit list
// (newest first, each with parent hashes — exactly how `git log` emits) into
// per-row geometry the renderer draws.
//
// Model: each row's cell has a horizontal midline where the commit dot sits.
//   - `top` edges run from the cell's TOP boundary to the midline.
//   - `bottom` edges run from the midline to the cell's BOTTOM boundary.
// Columns are kept stable across rows (we never re-pack interior lanes, only
// trim trailing empties for width), so a column index means the same lane in
// the row above and below — letting edges line up seamlessly.
//
// Single pass, maintaining `lanes`: lanes[col] = the parent hash that lane is
// currently waiting to render as a commit (or null = free).

export interface GraphCommitInput {
  hash: string
  parents: string[]
}

export interface GraphEdge {
  fromCol: number
  toCol: number
  color: number
}

export interface GraphRow {
  commitCol: number
  commitColor: number
  // Active lane count this row (for width sizing).
  width: number
  // Cell top → midline.
  top: GraphEdge[]
  // Midline → cell bottom.
  bottom: GraphEdge[]
  isMerge: boolean
}

const NUM_COLORS = 8

export function computeGraph(commits: GraphCommitInput[]): GraphRow[] {
  // lanes[col] = hash this lane waits for; null = free. Colors are stable per
  // lane slot until the slot is reused by a new branch.
  const lanes: (null | string)[] = []
  const colors: number[] = []
  let nextColor = 0

  const allocColor = () => {
    const c = nextColor
    nextColor = (nextColor + 1) % NUM_COLORS

    return c
  }

  const firstFree = () => {
    const idx = lanes.indexOf(null)

    return idx === -1 ? lanes.length : idx
  }

  const trimTrailing = () => {
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop()
      colors.pop()
    }
  }

  const rows: GraphRow[] = []

  for (const commit of commits) {
    // --- Incoming lane snapshot (top boundary of this cell) ---
    const incoming = lanes.map(h => h) // shallow copy of hashes by column
    const incomingColors = [...colors]

    // The commit's column: the (first) lane waiting for it, else a fresh lane.
    let commitCol = incoming.indexOf(commit.hash)

    if (commitCol === -1) {
      commitCol = firstFree()

      // Extend arrays if firstFree pointed past the end.
      while (lanes.length <= commitCol) {
        lanes.push(null)
        colors.push(0)
      }

      colors[commitCol] = allocColor()
    }

    const commitColor = colors[commitCol]
    const isMerge = commit.parents.length > 1

    // --- top edges: every incoming lane → midline ---
    // A lane waiting for THIS commit converges into commitCol; any other lane
    // passes straight to its own column.
    const top: GraphEdge[] = []

    for (let col = 0; col < incoming.length; col += 1) {
      const hash = incoming[col]

      if (hash == null) {
        continue
      }

      if (hash === commit.hash) {
        top.push({ color: incomingColors[col], fromCol: col, toCol: commitCol })
      } else {
        top.push({ color: incomingColors[col], fromCol: col, toCol: col })
      }
    }

    // Free every lane that converged into this commit (merge targets included).
    for (let col = 0; col < lanes.length; col += 1) {
      if (lanes[col] === commit.hash) {
        lanes[col] = null
      }
    }

    // --- assign parents to outgoing lanes ---
    // First parent reuses commitCol (continuing the lane + color); additional
    // parents (a merge's other sides) take fresh lanes. A parent already on a
    // lane keeps that lane (history reconverges).
    const parentCols: number[] = []

    commit.parents.forEach((parent, index) => {
      const existing = lanes.indexOf(parent)

      if (existing !== -1) {
        parentCols.push(existing)

        return
      }

      if (index === 0) {
        lanes[commitCol] = parent
        colors[commitCol] = commitColor
        parentCols.push(commitCol)
      } else {
        const col = firstFree()

        while (lanes.length <= col) {
          lanes.push(null)
          colors.push(0)
        }

        lanes[col] = parent
        colors[col] = allocColor()
        parentCols.push(col)
      }
    })

    // Root commit (no parents) or a commit whose lane no parent reused: free it.
    if (!parentCols.includes(commitCol) && lanes[commitCol] === commit.hash) {
      lanes[commitCol] = null
    }

    // --- bottom edges: midline → cell bottom ---
    // Pass-through lanes (active both before and after, not the commit's own)
    // continue straight; the commit dot routes to each distinct parent column.
    const bottom: GraphEdge[] = []
    const outgoing = lanes.map(h => h)

    for (let col = 0; col < outgoing.length; col += 1) {
      if (outgoing[col] == null) {
        continue
      }

      if (col === commitCol || parentCols.includes(col)) {
        // Handled by the parent routing below (avoid double line on commitCol).
        continue
      }

      bottom.push({ color: colors[col], fromCol: col, toCol: col })
    }

    for (const pc of parentCols) {
      bottom.push({ color: colors[pc], fromCol: commitCol, toCol: pc })
    }

    trimTrailing()

    const width = Math.max(
      incoming.length,
      lanes.length,
      commitCol + 1,
      ...top.map(e => Math.max(e.fromCol, e.toCol) + 1),
      ...bottom.map(e => Math.max(e.fromCol, e.toCol) + 1),
      1
    )

    rows.push({ bottom, commitCol, commitColor, isMerge, top, width })
  }

  return rows
}

export const GRAPH_COLORS = NUM_COLORS
