// Parse a (possibly multi-file) unified diff into a structured form the diff
// viewer renders. Pure + dependency-free so it's reusable by the Commit pane,
// branch compare, and the future Git/log panel.

export type DiffLineType = 'add' | 'context' | 'del' | 'meta'

export interface DiffLine {
  type: DiffLineType
  text: string
  // 1-based line numbers in the old/new file; null on the side where the line
  // doesn't exist (an add has no old line, a delete has no new line).
  oldLine: null | number
  newLine: null | number
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  // Display path (new path for renames, falling back to old).
  path: string
  oldPath: null | string
  hunks: DiffHunk[]
  additions: number
  deletions: number
  // True for binary files (git emits "Binary files ... differ").
  binary: boolean
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

function stripPrefix(path: string): string {
  // git diff paths come prefixed with a/ and b/ (and may be quoted).
  let p = path.trim()

  if (p.startsWith('"') && p.endsWith('"')) {
    p = p.slice(1, -1)
  }

  if (p === '/dev/null') {
    return p
  }

  if (p.startsWith('a/') || p.startsWith('b/')) {
    return p.slice(2)
  }

  return p
}

export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  const lines = diff.split('\n')
  let current: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  const pushFile = () => {
    if (current) {
      files.push(current)
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    if (line.startsWith('diff --git')) {
      pushFile()
      current = { additions: 0, binary: false, deletions: 0, hunks: [], oldPath: null, path: '' }
      hunk = null

      // "diff --git a/foo b/bar" — seed path from here; refined by ---/+++.
      const match = line.match(/^diff --git (.+) (.+)$/)

      if (match) {
        current.oldPath = stripPrefix(match[1])
        current.path = stripPrefix(match[2])
      }

      continue
    }

    if (!current) {
      // Diffs from `git diff --no-index` (untracked files) may omit the
      // "diff --git" header; synthesize a file on the first ---/+++/@@.
      if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('@@')) {
        current = { additions: 0, binary: false, deletions: 0, hunks: [], oldPath: null, path: '' }
        hunk = null
      } else {
        continue
      }
    }

    if (line.startsWith('Binary files')) {
      current.binary = true

      continue
    }

    if (line.startsWith('--- ')) {
      const p = stripPrefix(line.slice(4))

      if (p !== '/dev/null') {
        current.oldPath = p
      }

      continue
    }

    if (line.startsWith('+++ ')) {
      const p = stripPrefix(line.slice(4))

      if (p !== '/dev/null') {
        current.path = p
      }

      continue
    }

    const hunkMatch = line.match(HUNK_RE)

    if (hunkMatch) {
      oldLine = Number.parseInt(hunkMatch[1], 10)
      newLine = Number.parseInt(hunkMatch[2], 10)
      hunk = { header: line, lines: [] }
      current.hunks.push(hunk)

      continue
    }

    if (!hunk) {
      // index / mode / rename headers between the file header and first hunk.
      continue
    }

    const marker = line[0]

    if (marker === '+') {
      hunk.lines.push({ newLine, oldLine: null, text: line.slice(1), type: 'add' })
      current.additions += 1
      newLine += 1
    } else if (marker === '-') {
      hunk.lines.push({ newLine: null, oldLine, text: line.slice(1), type: 'del' })
      current.deletions += 1
      oldLine += 1
    } else if (marker === '\\') {
      // "\ No newline at end of file" — attach as meta, no line numbers.
      hunk.lines.push({ newLine: null, oldLine: null, text: line, type: 'meta' })
    } else {
      // Context line (leading space) or an empty trailing line.
      hunk.lines.push({ newLine, oldLine, text: line.slice(1), type: 'context' })
      oldLine += 1
      newLine += 1
    }
  }

  pushFile()

  // Fall back to oldPath when a file only had a --- header (pure deletion).
  for (const file of files) {
    if (!file.path && file.oldPath) {
      file.path = file.oldPath
    }
  }

  return files
}
