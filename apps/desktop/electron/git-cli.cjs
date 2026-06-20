'use strict'

/**
 * Local git operations for the desktop Commit tool window. Spawns the resolved
 * git binary (PortableGit-aware via resolveGitBinary in main.cjs) inside a repo
 * root, with every incoming path forced through resolveRequestedPathForIpc so a
 * renderer can't escape to arbitrary locations. Status uses porcelain v2 so we
 * get a stable, parseable staged/unstaged breakdown.
 */

const { execFile } = require('node:child_process')
const { resolveRequestedPathForIpc } = require('./hardening.cjs')

const MAX_BUFFER = 32 * 1024 * 1024 // 32 MB — big diffs / large status lists.
const GIT_TIMEOUT_MS = 15000

function safeRepoRoot(repoRoot) {
  // Throws on unsafe syntax; the handlers translate that into an error result.
  return resolveRequestedPathForIpc(repoRoot, { purpose: 'Git repo' })
}

// runGit resolves with { code, stdout, stderr }. Never rejects on a non-zero
// git exit — callers decide whether stderr is fatal — but rejects when git
// can't be spawned at all (ENOENT, etc.).
function runGit(gitBinary, repoRoot, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      gitBinary,
      ['-C', repoRoot, ...args],
      {
        maxBuffer: MAX_BUFFER,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        // Keep git from trying to read the user's pager / prompt for creds.
        env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
        ...options
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          // Spawn failure (binary missing, timeout) — surface it.
          reject(error)

          return
        }

        resolve({ code: error ? error.code : 0, stderr: stderr || '', stdout: stdout || '' })
      }
    )
  })
}

// XY status codes from `git status --porcelain=v2`. X = staged (index), Y =
// worktree. '.' means unchanged on that side.
function describeCode(code) {
  switch (code) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typechange'
    case 'U':
      return 'unmerged'
    default:
      return 'modified'
  }
}

// Parse porcelain v2 (NUL-terminated with -z). Returns one entry per path with
// independent staged/unstaged flags so the UI can show a file in both sections.
function parseStatus(stdout) {
  const entries = []
  const tokens = stdout.split('\0')
  let i = 0

  while (i < tokens.length) {
    const line = tokens[i]

    if (!line) {
      i += 1

      continue
    }

    const kind = line[0]

    if (kind === '1') {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = line.split(' ')
      const xy = parts[1] || '..'
      const path = parts.slice(8).join(' ')
      const x = xy[0]
      const y = xy[1]

      entries.push({
        path,
        staged: x !== '.' && x !== '?',
        stagedStatus: x !== '.' ? describeCode(x) : null,
        unstaged: y !== '.' && y !== '?',
        unstagedStatus: y !== '.' ? describeCode(y) : null,
        untracked: false
      })
      i += 1

      continue
    }

    if (kind === '2') {
      // Renamed/copied. Path + origPath are the next two NUL fields combined;
      // git emits "<path>\0<origPath>" so the current token holds <path> after
      // the header and the following token is <origPath>.
      const parts = line.split(' ')
      const xy = parts[1] || '..'
      const x = xy[0]
      const y = xy[1]
      const path = parts.slice(9).join(' ')
      // Consume the origPath token that follows a rename/copy entry.
      i += 1
      const origPath = tokens[i] || ''

      entries.push({
        origPath,
        path,
        staged: x !== '.' && x !== '?',
        stagedStatus: x !== '.' ? describeCode(x) : null,
        unstaged: y !== '.' && y !== '?',
        unstagedStatus: y !== '.' ? describeCode(y) : null,
        untracked: false
      })
      i += 1

      continue
    }

    if (kind === '?') {
      // ? <path>
      const path = line.slice(2)

      entries.push({
        path,
        staged: false,
        stagedStatus: null,
        unstaged: true,
        unstagedStatus: 'untracked',
        untracked: true
      })
      i += 1

      continue
    }

    if (kind === 'u') {
      // Unmerged (conflict).
      const parts = line.split(' ')
      const path = parts.slice(10).join(' ')

      entries.push({
        path,
        staged: false,
        stagedStatus: 'unmerged',
        unstaged: true,
        unstagedStatus: 'unmerged',
        untracked: false,
        unmerged: true
      })
      i += 1

      continue
    }

    // '#' headers (branch info) and anything else: skip.
    i += 1
  }

  return entries
}

async function gitStatus(gitBinary, repoRootInput) {
  const repoRoot = safeRepoRoot(repoRootInput)
  // Branch header via -b; entries via porcelain v2 -z (NUL-safe paths).
  const { code, stderr, stdout } = await runGit(gitBinary, repoRoot, [
    'status',
    '--porcelain=v2',
    '--branch',
    '-z'
  ])

  if (code !== 0) {
    return { error: stderr.trim() || `git status exited with code ${code}`, ok: false }
  }

  let branch = null
  let ahead = 0
  let behind = 0
  // Branch headers are space-delimited (not part of the NUL entry stream) and
  // appear before the first entry; pull them out of the leading chunk.
  const headerChunk = stdout.split('\0', 1)[0] || ''

  for (const header of stdout.split('\0')) {
    if (!header.startsWith('# ')) {
      continue
    }

    if (header.startsWith('# branch.head ')) {
      branch = header.slice('# branch.head '.length).trim()
    } else if (header.startsWith('# branch.ab ')) {
      const ab = header.slice('# branch.ab '.length).trim().split(' ')
      ahead = Math.abs(Number.parseInt(ab[0], 10) || 0)
      behind = Math.abs(Number.parseInt(ab[1], 10) || 0)
    }
  }

  void headerChunk

  return { ahead, behind, branch, entries: parseStatus(stdout), ok: true, repoRoot }
}

async function gitDiff(gitBinary, repoRootInput, filePath, staged) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const args = ['diff', '--no-color']

  if (staged) {
    args.push('--cached')
  }

  args.push('--', String(filePath || ''))

  const { code, stderr, stdout } = await runGit(gitBinary, repoRoot, args)

  if (code !== 0 && !stdout) {
    return { error: stderr.trim() || `git diff exited with code ${code}`, ok: false }
  }

  return { diff: stdout, ok: true }
}

// Untracked files have no diff target; synthesize an all-added diff so the UI
// can preview the new file's contents the same way as tracked changes.
async function gitDiffUntracked(gitBinary, repoRootInput, filePath) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const { code, stdout } = await runGit(gitBinary, repoRoot, [
    'diff',
    '--no-color',
    '--no-index',
    '--',
    '/dev/null',
    String(filePath || '')
  ])

  // --no-index returns exit 1 when files differ (which is always, vs /dev/null).
  if (code !== 0 && !stdout) {
    return { diff: '', ok: true }
  }

  return { diff: stdout, ok: true }
}

async function gitStage(gitBinary, repoRootInput, paths) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const list = (Array.isArray(paths) ? paths : [paths]).map(String).filter(Boolean)

  if (!list.length) {
    return { ok: true }
  }

  const { code, stderr } = await runGit(gitBinary, repoRoot, ['add', '--', ...list])

  if (code !== 0) {
    return { error: stderr.trim() || `git add exited with code ${code}`, ok: false }
  }

  return { ok: true }
}

async function gitUnstage(gitBinary, repoRootInput, paths) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const list = (Array.isArray(paths) ? paths : [paths]).map(String).filter(Boolean)

  if (!list.length) {
    return { ok: true }
  }

  // `restore --staged` is the modern unstage; works for adds + modifications.
  const { code, stderr } = await runGit(gitBinary, repoRoot, ['restore', '--staged', '--', ...list])

  if (code !== 0) {
    return { error: stderr.trim() || `git restore --staged exited with code ${code}`, ok: false }
  }

  return { ok: true }
}

async function gitCommit(gitBinary, repoRootInput, message, options = {}) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const text = String(message || '').trim()

  if (!text && !options.amend) {
    return { error: 'Commit message is empty.', ok: false }
  }

  const args = ['commit', '-m', text]

  if (options.amend) {
    args.push('--amend')
  }

  const { code, stderr, stdout } = await runGit(gitBinary, repoRoot, args)

  if (code !== 0) {
    return { error: (stderr || stdout).trim() || `git commit exited with code ${code}`, ok: false }
  }

  return { ok: true, output: (stdout || stderr).trim() }
}

// List local + remote branches. for-each-ref gives stable, parseable output:
// "<refname>\x1f<refname:short>\x1f<upstream:short>\x1f<HEAD marker>" per line.
// The full refname tells heads from remotes reliably (a local "feature/foo" and
// a remote "origin/foo" both have slashes in their short name).
async function gitBranches(gitBinary, repoRootInput) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const format = '%(refname)%1f%(refname:short)%1f%(upstream:short)%1f%(HEAD)'
  const { code, stderr, stdout } = await runGit(gitBinary, repoRoot, [
    'for-each-ref',
    '--sort=-committerdate',
    `--format=${format}`,
    'refs/heads',
    'refs/remotes'
  ])

  if (code !== 0) {
    return { error: stderr.trim() || `git for-each-ref exited with code ${code}`, ok: false }
  }

  const local = []
  const remote = []

  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      continue
    }

    const [fullRef, name, upstream, head] = line.split('\x1f')

    // Skip the symbolic "origin/HEAD" alias.
    if (fullRef.endsWith('/HEAD') || name.endsWith('/HEAD')) {
      continue
    }

    if (fullRef.startsWith('refs/remotes/')) {
      remote.push({ current: false, name, upstream: '' })
    } else {
      local.push({ current: head === '*', name, upstream: upstream || '' })
    }
  }

  return { local, ok: true, remote }
}

async function gitCreateBranch(gitBinary, repoRootInput, branch, startPoint) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const name = String(branch || '').trim()

  if (!name) {
    return { error: 'No branch name.', ok: false }
  }

  // -b creates and switches in one step; an optional start point lets the UI
  // branch off another ref ("New Branch from '<branch>'").
  const args = ['checkout', '-b', name]
  const start = String(startPoint || '').trim()

  if (start) {
    args.push(start)
  }

  const { code, stderr, stdout } = await runGit(gitBinary, repoRoot, args)

  if (code !== 0) {
    return { error: (stderr || stdout).trim() || `git checkout -b exited with code ${code}`, ok: false }
  }

  return { ok: true }
}

async function gitRenameBranch(gitBinary, repoRootInput, branch, newName) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const from = String(branch || '').trim()
  const to = String(newName || '').trim()

  if (!from || !to) {
    return { error: 'Rename needs both names.', ok: false }
  }

  const { code, stderr, stdout } = await runGit(gitBinary, repoRoot, ['branch', '-m', from, to])

  if (code !== 0) {
    return { error: (stderr || stdout).trim() || `git branch -m exited with code ${code}`, ok: false }
  }

  return { ok: true }
}

async function gitDeleteBranch(gitBinary, repoRootInput, branch, force) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const name = String(branch || '').trim()

  if (!name) {
    return { error: 'No branch specified.', ok: false }
  }

  const { code, stderr, stdout } = await runGit(gitBinary, repoRoot, [
    'branch',
    force ? '-D' : '-d',
    name
  ])

  if (code !== 0) {
    return { error: (stderr || stdout).trim() || `git branch -d exited with code ${code}`, ok: false }
  }

  return { ok: true }
}

// Merge <branch> into the current branch.
async function gitMerge(gitBinary, repoRootInput, branch) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const name = String(branch || '').trim()

  if (!name) {
    return { error: 'No branch specified.', ok: false }
  }

  const { code, stderr, stdout } = await runGit(gitBinary, repoRoot, ['merge', name])

  if (code !== 0) {
    return { error: (stderr || stdout).trim() || `git merge exited with code ${code}`, ok: false }
  }

  return { ok: true, output: (stdout || stderr).trim() }
}

// Rebase the current branch onto <branch>.
async function gitRebase(gitBinary, repoRootInput, branch) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const name = String(branch || '').trim()

  if (!name) {
    return { error: 'No branch specified.', ok: false }
  }

  const { code, stderr, stdout } = await runGit(gitBinary, repoRoot, ['rebase', name])

  if (code !== 0) {
    return { error: (stderr || stdout).trim() || `git rebase exited with code ${code}`, ok: false }
  }

  return { ok: true, output: (stdout || stderr).trim() }
}

async function gitCheckout(gitBinary, repoRootInput, branch) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const name = String(branch || '').trim()

  if (!name) {
    return { error: 'No branch specified.', ok: false }
  }

  const { code, stderr, stdout } = await runGit(gitBinary, repoRoot, ['checkout', name])

  if (code !== 0) {
    return { error: (stderr || stdout).trim() || `git checkout exited with code ${code}`, ok: false }
  }

  return { ok: true }
}

async function gitPull(gitBinary, repoRootInput) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const { code, stderr, stdout } = await runGit(gitBinary, repoRoot, ['pull', '--ff-only'], {
    timeout: 120000
  })

  if (code !== 0) {
    return { error: (stderr || stdout).trim() || `git pull exited with code ${code}`, ok: false }
  }

  return { ok: true, output: (stdout || stderr).trim() }
}

async function gitPush(gitBinary, repoRootInput) {
  const repoRoot = safeRepoRoot(repoRootInput)
  // --porcelain keeps output parseable; first push of a new branch still needs
  // an upstream, so fall back to setting it when push reports "no upstream".
  let { code, stderr, stdout } = await runGit(gitBinary, repoRoot, ['push'], { timeout: 120000 })

  if (code !== 0 && /no upstream|set-upstream|has no upstream/i.test(stderr)) {
    const head = await runGit(gitBinary, repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const branch = head.stdout.trim()

    if (branch && branch !== 'HEAD') {
      ;({ code, stderr, stdout } = await runGit(gitBinary, repoRoot, [
        'push',
        '--set-upstream',
        'origin',
        branch
      ], { timeout: 120000 }))
    }
  }

  if (code !== 0) {
    return { error: (stderr || stdout).trim() || `git push exited with code ${code}`, ok: false }
  }

  return { ok: true, output: (stdout || stderr).trim() }
}

// Diff the working tree against a ref ("Show Diff with Working Tree").
async function gitDiffWorkingTree(gitBinary, repoRootInput, ref) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const name = String(ref || '').trim()

  if (!name) {
    return { error: 'No ref specified.', ok: false }
  }

  const { code, stderr, stdout } = await runGit(gitBinary, repoRoot, ['diff', '--no-color', name])

  if (code !== 0 && !stdout) {
    return { error: stderr.trim() || `git diff exited with code ${code}`, ok: false }
  }

  return { diff: stdout, ok: true }
}

// Diff two refs ("Compare with '<branch>'") — base..target as a plain range.
async function gitCompareBranches(gitBinary, repoRootInput, base, target) {
  const repoRoot = safeRepoRoot(repoRootInput)
  const a = String(base || '').trim()
  const b = String(target || '').trim()

  if (!a || !b) {
    return { error: 'Compare needs two refs.', ok: false }
  }

  const { code, stderr, stdout } = await runGit(gitBinary, repoRoot, ['diff', '--no-color', a, b])

  if (code !== 0 && !stdout) {
    return { error: stderr.trim() || `git diff exited with code ${code}`, ok: false }
  }

  return { diff: stdout, ok: true }
}

module.exports = {
  gitBranches,
  gitCheckout,
  gitCommit,
  gitCompareBranches,
  gitCreateBranch,
  gitDeleteBranch,
  gitDiff,
  gitDiffUntracked,
  gitDiffWorkingTree,
  gitMerge,
  gitPull,
  gitPush,
  gitRebase,
  gitRenameBranch,
  gitStage,
  gitStatus,
  gitUnstage,
  parseStatus,
  runGit
}
