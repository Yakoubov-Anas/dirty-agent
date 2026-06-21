import { atom } from 'nanostores'

import type { HermesGitCommitDetail, HermesGitLogCommit } from '@/global'
import { gitCommitDetail, gitCommitDiff, gitLog, isGitAvailable } from '@/lib/desktop-git'

import { $gitRepoRoot } from './git'

const PAGE_SIZE = 100

export const $gitLogCommits = atom<HermesGitLogCommit[]>([])
export const $gitLogLoading = atom(false)
export const $gitLogLoadingMore = atom(false)
export const $gitLogError = atom<null | string>(null)
export const $gitLogHasMore = atom(false)
// Selected commit hash + its loaded detail/diff.
export const $gitLogSelectedHash = atom<null | string>(null)
export const $gitLogDetail = atom<HermesGitCommitDetail | null>(null)
export const $gitLogDetailLoading = atom(false)
export const $gitLogDiff = atom<string>('')
// Active branch filter for the log. null = current HEAD; 'all' = every branch;
// otherwise a specific branch/ref name.
export const $gitLogBranch = atom<null | string>(null)

let logToken = 0

// Load the first page of history for the current repo root. Resets selection.
export async function refreshGitLog() {
  const repoRoot = $gitRepoRoot.get()

  if (!isGitAvailable() || !repoRoot) {
    $gitLogCommits.set([])
    $gitLogHasMore.set(false)

    return
  }

  const token = ++logToken
  $gitLogLoading.set(true)
  $gitLogError.set(null)

  const branch = $gitLogBranch.get() ?? undefined
  const result = await gitLog(repoRoot, { branch, limit: PAGE_SIZE, skip: 0 })

  if (token !== logToken) {
    return
  }

  $gitLogLoading.set(false)

  if (!result.ok) {
    $gitLogError.set(result.error)
    $gitLogCommits.set([])
    $gitLogHasMore.set(false)

    return
  }

  $gitLogCommits.set(result.commits)
  $gitLogHasMore.set(result.hasMore)

  // Drop a stale selection that's no longer in the page.
  const selected = $gitLogSelectedHash.get()

  if (selected && !result.commits.some(commit => commit.hash === selected)) {
    clearGitLogSelection()
  }
}

export async function loadMoreGitLog() {
  const repoRoot = $gitRepoRoot.get()

  if (!repoRoot || $gitLogLoadingMore.get() || !$gitLogHasMore.get()) {
    return
  }

  const token = logToken
  $gitLogLoadingMore.set(true)

  const branch = $gitLogBranch.get() ?? undefined
  const result = await gitLog(repoRoot, { branch, limit: PAGE_SIZE, skip: $gitLogCommits.get().length })

  // A full refresh started while paging — discard this stale page.
  if (token !== logToken) {
    return
  }

  $gitLogLoadingMore.set(false)

  if (!result.ok) {
    $gitLogError.set(result.error)

    return
  }

  // Dedupe defensively (skip-based paging can overlap if history changed).
  const existing = new Set($gitLogCommits.get().map(commit => commit.hash))
  const fresh = result.commits.filter(commit => !existing.has(commit.hash))
  $gitLogCommits.set([...$gitLogCommits.get(), ...fresh])
  $gitLogHasMore.set(result.hasMore)
}

let detailToken = 0

// Switch the branch filter and reload the log. null = HEAD, 'all' = all branches.
export async function setGitLogBranch(branch: null | string) {
  if ($gitLogBranch.get() === branch) {
    return
  }

  $gitLogBranch.set(branch)
  clearGitLogSelection()
  await refreshGitLog()
}

export function clearGitLogSelection() {
  $gitLogSelectedHash.set(null)
  $gitLogDetail.set(null)
  $gitLogDiff.set('')
}

export async function selectGitLogCommit(hash: string) {
  const repoRoot = $gitRepoRoot.get()

  if (!repoRoot) {
    return
  }

  $gitLogSelectedHash.set(hash)

  const token = ++detailToken
  $gitLogDetailLoading.set(true)
  $gitLogDetail.set(null)
  $gitLogDiff.set('')

  // Fetch metadata + diff in parallel.
  const [detail, diff] = await Promise.all([
    gitCommitDetail(repoRoot, hash),
    gitCommitDiff(repoRoot, hash)
  ])

  if (token !== detailToken) {
    return
  }

  $gitLogDetailLoading.set(false)

  if (detail.ok) {
    $gitLogDetail.set(detail.commit)
  } else {
    $gitLogError.set(detail.error)
  }

  if (diff.ok) {
    $gitLogDiff.set(diff.diff)
  }
}
