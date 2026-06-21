import { describe, expect, it } from 'vitest'

import { computeGraph } from './git-graph'

describe('computeGraph', () => {
  it('places a linear history in a single lane', () => {
    // c -> b -> a (newest first); each has one parent.
    const rows = computeGraph([
      { hash: 'c', parents: ['b'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] }
    ])

    expect(rows).toHaveLength(3)
    // All commits sit in lane 0.
    expect(rows.map(r => r.commitCol)).toEqual([0, 0, 0])
    expect(rows.every(r => r.width === 1)).toBe(true)
    // No merges.
    expect(rows.some(r => r.isMerge)).toBe(false)
  })

  it('continues the first-parent lane straight down', () => {
    const rows = computeGraph([
      { hash: 'c', parents: ['b'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] }
    ])

    // First row routes commitCol(0) → parent lane 0 on the bottom.
    expect(rows[0].bottom).toContainEqual({ color: rows[0].commitColor, fromCol: 0, toCol: 0 })
    // Middle row receives lane 0 from the top.
    expect(rows[1].top).toContainEqual({ color: rows[1].commitColor, fromCol: 0, toCol: 0 })
  })

  it('opens a second lane for a merge and converges it back', () => {
    // m is a merge of mainline a-parent and feature f.
    //   m (parents: a, f)
    //   f (parents: a)
    //   a (parents: -)
    const rows = computeGraph([
      { hash: 'm', parents: ['a', 'f'] },
      { hash: 'f', parents: ['a'] },
      { hash: 'a', parents: [] }
    ])

    // Merge row flagged + fans out to two parent columns.
    expect(rows[0].isMerge).toBe(true)
    const mergeTargets = rows[0].bottom.map(e => e.toCol).sort()
    expect(mergeTargets).toEqual([0, 1])
    // The merge row is at least 2 lanes wide.
    expect(rows[0].width).toBeGreaterThanOrEqual(2)

    // f sits in the second lane (col 1).
    expect(rows[1].commitCol).toBe(1)
    // The feature lane rejoins the mainline at the BOTTOM of f's row: lane 1
    // routes down into lane 0 (a's lane).
    expect(rows[1].bottom).toContainEqual({ color: rows[1].bottom[0].color, fromCol: 1, toCol: 0 })

    // a (the shared base) is now reached via a single lane 0 (the feature
    // already merged down a row above), and all lanes free after it (root).
    const aRow = rows[2]
    expect(aRow.commitCol).toBe(0)
    expect(aRow.top.filter(e => e.toCol === 0).map(e => e.fromCol)).toContain(0)
    // After a (root), all lanes free → width collapses back to 1.
    expect(aRow.width).toBe(1)
  })

  it('handles a root commit with no parents (frees its lane)', () => {
    const rows = computeGraph([{ hash: 'a', parents: [] }])

    expect(rows).toHaveLength(1)
    expect(rows[0].commitCol).toBe(0)
    // No outgoing edges past a root.
    expect(rows[0].bottom).toEqual([])
  })

  it('returns an empty array for no commits', () => {
    expect(computeGraph([])).toEqual([])
  })

  it('keeps an unrelated parallel lane passing straight through', () => {
    // Two independent tips x and y that never converge in this window.
    //   x (parents: x1)
    //   y (parents: y1)
    //   x1 (parents: -)
    //   y1 (parents: -)
    const rows = computeGraph([
      { hash: 'x', parents: ['x1'] },
      { hash: 'y', parents: ['y1'] },
      { hash: 'x1', parents: [] },
      { hash: 'y1', parents: [] }
    ])

    // x in lane 0, y in a separate lane.
    expect(rows[0].commitCol).toBe(0)
    expect(rows[1].commitCol).not.toBe(0)
    // While y's row renders, lane 0 (waiting for x1) passes straight through.
    const passThrough = rows[1].top.find(e => e.fromCol === 0 && e.toCol === 0)
    expect(passThrough).toBeDefined()
  })
})
