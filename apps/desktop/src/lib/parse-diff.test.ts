import { describe, expect, it } from 'vitest'

import { parseUnifiedDiff } from './parse-diff'

describe('parseUnifiedDiff', () => {
  it('parses a single-file modification with line numbers', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index 111..222 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      '+const c = 4',
      ' const d = 5'
    ].join('\n')

    const files = parseUnifiedDiff(diff)

    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('src/foo.ts')
    expect(files[0].additions).toBe(2)
    expect(files[0].deletions).toBe(1)
    expect(files[0].hunks).toHaveLength(1)

    const lines = files[0].hunks[0].lines
    // context, del, add, add, context
    expect(lines.map(l => l.type)).toEqual(['context', 'del', 'add', 'add', 'context'])
    // First context line is old 1 / new 1.
    expect(lines[0]).toMatchObject({ newLine: 1, oldLine: 1 })
    // Deletion has an old line, no new line.
    expect(lines[1]).toMatchObject({ newLine: null, oldLine: 2 })
    // Additions have new lines, no old line.
    expect(lines[2]).toMatchObject({ newLine: 2, oldLine: null })
    expect(lines[3]).toMatchObject({ newLine: 3, oldLine: null })
    // Trailing context resumes numbering (old 3 / new 4).
    expect(lines[4]).toMatchObject({ newLine: 4, oldLine: 3 })
  })

  it('parses multiple files in one diff', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/b.ts b/b.ts',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -0,0 +1 @@',
      '+added'
    ].join('\n')

    const files = parseUnifiedDiff(diff)

    expect(files.map(f => f.path)).toEqual(['a.ts', 'b.ts'])
    expect(files[1].additions).toBe(1)
    expect(files[1].deletions).toBe(0)
  })

  it('marks binary files', () => {
    const diff = [
      'diff --git a/img.png b/img.png',
      'index 111..222 100644',
      'Binary files a/img.png and b/img.png differ'
    ].join('\n')

    const files = parseUnifiedDiff(diff)

    expect(files).toHaveLength(1)
    expect(files[0].binary).toBe(true)
  })

  it('handles a pure deletion (new path is /dev/null)', () => {
    const diff = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line one',
      '-line two'
    ].join('\n')

    const files = parseUnifiedDiff(diff)

    expect(files[0].path).toBe('gone.ts')
    expect(files[0].deletions).toBe(2)
    expect(files[0].additions).toBe(0)
  })

  it('returns an empty array for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })
})
