import { atom } from 'nanostores'

import type { HermesGitBranch, HermesGitFileEntry } from '@/global'
import {
  gitBranches,
  gitCheckout,
  gitCommit,
  gitCompareBranches,
  gitCreateBranch,
  gitDeleteBranch,
  gitDiff,
  gitDiffWorkingTree,
  gitMerge,
  gitPull,
  gitPush,
  gitRebase,
  gitRenameBranch,
  gitStage,
  gitStatus,
  gitUnstage,
  isGitAvailable
} from '@/lib/desktop-git'

export interface GitSelection {
  path: string
  staged: boolean
  untracked: boolean
}

export const $gitRepoRoot = atom<string | null>(null)
export const $gitBranch = atom<string | null>(null)
export const $gitAhead = atom(0)
export const $gitBehind = atom(0)
export const $gitEntries = atom<HermesGitFileEntry[]>([])
export const $gitLoading = atom(false)
export const $gitError = atom<string | null>(null)
export const $gitNotARepo = atom(false)
// Which file's diff is shown in the preview, and from which side.
export const $gitSelection = atom<GitSelection | null>(null)
export const $gitDiffText = atom<string>('')
export const $gitDiffLoading = atom(false)
export const $gitCommitMessage = atom('')
export const $gitCommitting = atom(false)
// Branch dropdown state.
export const $gitLocalBranches = atom<HermesGitBranch[]>([])
export const $gitRemoteBranches = atom<HermesGitBranch[]>([])
export const $gitBranchesLoading = atom(false)
export const $gitBusy = atom(false)

let refreshToken = 0

// Refresh status for the active repo root. cwd is resolved to a repo root by the
// caller (it passes the file-browser's cwd through gitRoot first), so an empty
// root means "not in a repo".
export async function refreshGitStatus(repoRoot: null | string) {
  if (!isGitAvailable()) {
    $gitError.set('Git is only available in the desktop app.')
    $gitNotARepo.set(false)

    return
  }

  if (!repoRoot) {
    $gitRepoRoot.set(null)
    $gitEntries.set([])
    $gitBranch.set(null)
    $gitNotARepo.set(true)
    $gitError.set(null)
    $gitSelection.set(null)
    $gitDiffText.set('')

    return
  }

  const token = ++refreshToken
  $gitLoading.set(true)
  $gitError.set(null)
  $gitNotARepo.set(false)

  const result = await gitStatus(repoRoot)

  // A newer refresh started while we awaited — discard this stale result.
  if (token !== refreshToken) {
    return
  }

  $gitLoading.set(false)

  if (!result.ok) {
    $gitError.set(result.error)
    $gitEntries.set([])

    return
  }

  $gitRepoRoot.set(result.repoRoot)
  $gitBranch.set(result.branch)
  $gitAhead.set(result.ahead)
  $gitBehind.set(result.behind)
  $gitEntries.set(result.entries)

  // Drop a selection whose file no longer appears in either section.
  const selection = $gitSelection.get()

  if (selection && !result.entries.some(entry => entry.path === selection.path)) {
    $gitSelection.set(null)
    $gitDiffText.set('')
  }
}

let diffToken = 0

export async function selectGitFile(selection: GitSelection) {
  $gitSelection.set(selection)

  const repoRoot = $gitRepoRoot.get()

  if (!repoRoot) {
    return
  }

  const token = ++diffToken
  $gitDiffLoading.set(true)
  $gitDiffText.set('')

  const result = await gitDiff(repoRoot, selection.path, selection.staged, selection.untracked)

  if (token !== diffToken) {
    return
  }

  $gitDiffLoading.set(false)
  $gitDiffText.set(result.ok ? result.diff : '')

  if (!result.ok) {
    $gitError.set(result.error)
  }
}

async function mutateThenRefresh(action: () => Promise<{ ok: boolean; error?: string }>) {
  const repoRoot = $gitRepoRoot.get()

  if (!repoRoot) {
    return
  }

  const result = await action()

  if (!result.ok && result.error) {
    $gitError.set(result.error)
  }

  await refreshGitStatus(repoRoot)

  // Re-render the diff for the still-selected file (its staged/unstaged side may
  // have flipped after staging).
  const selection = $gitSelection.get()

  if (selection) {
    await selectGitFile(selection)
  }
}

export async function stageGitPaths(paths: string[]) {
  const repoRoot = $gitRepoRoot.get()

  if (!repoRoot || !paths.length) {
    return
  }

  // Staging an unstaged file flips the selection to its staged side so the diff
  // preview keeps tracking the same file.
  const selection = $gitSelection.get()

  if (selection && paths.includes(selection.path)) {
    $gitSelection.set({ ...selection, staged: true, untracked: false })
  }

  await mutateThenRefresh(() => gitStage(repoRoot, paths))
}

export async function unstageGitPaths(paths: string[]) {
  const repoRoot = $gitRepoRoot.get()

  if (!repoRoot || !paths.length) {
    return
  }

  const selection = $gitSelection.get()

  if (selection && paths.includes(selection.path)) {
    $gitSelection.set({ ...selection, staged: false })
  }

  await mutateThenRefresh(() => gitUnstage(repoRoot, paths))
}

export async function stageAllGit() {
  const paths = $gitEntries.get()
    .filter(entry => entry.unstaged || entry.untracked)
    .map(entry => entry.path)

  await stageGitPaths(paths)
}

export async function unstageAllGit() {
  const paths = $gitEntries.get()
    .filter(entry => entry.staged)
    .map(entry => entry.path)

  await unstageGitPaths(paths)
}

// Commit the staged changes. Returns true on success so the UI can clear the
// message box.
export async function commitGit(): Promise<boolean> {
  const repoRoot = $gitRepoRoot.get()
  const message = $gitCommitMessage.get().trim()

  if (!repoRoot || !message) {
    return false
  }

  $gitCommitting.set(true)
  $gitError.set(null)

  const result = await gitCommit(repoRoot, message)

  $gitCommitting.set(false)

  if (!result.ok) {
    $gitError.set(result.error)

    return false
  }

  $gitCommitMessage.set('')
  $gitSelection.set(null)
  $gitDiffText.set('')
  await refreshGitStatus(repoRoot)

  return true
}

// ─── Branch dropdown ──────────────────────────────────────────────────────

export async function refreshGitBranches() {
  const repoRoot = $gitRepoRoot.get()

  if (!repoRoot) {
    $gitLocalBranches.set([])
    $gitRemoteBranches.set([])

    return
  }

  $gitBranchesLoading.set(true)

  const result = await gitBranches(repoRoot)

  $gitBranchesLoading.set(false)

  if (result.ok) {
    $gitLocalBranches.set(result.local)
    $gitRemoteBranches.set(result.remote)
  } else {
    $gitError.set(result.error)
  }
}

async function runBranchOp(op: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
  const repoRoot = $gitRepoRoot.get()

  if (!repoRoot || $gitBusy.get()) {
    return false
  }

  $gitBusy.set(true)
  $gitError.set(null)

  const result = await op()

  $gitBusy.set(false)

  if (!result.ok) {
    $gitError.set(result.error || 'Git operation failed.')

    return false
  }

  await refreshGitStatus(repoRoot)
  await refreshGitBranches()

  return true
}

export function checkoutGitBranch(branch: string): Promise<boolean> {
  const repoRoot = $gitRepoRoot.get()

  return runBranchOp(() => gitCheckout(repoRoot as string, branch))
}

export function createGitBranch(branch: string, startPoint?: string): Promise<boolean> {
  const repoRoot = $gitRepoRoot.get()

  return runBranchOp(() => gitCreateBranch(repoRoot as string, branch, startPoint))
}

export function renameGitBranch(branch: string, newName: string): Promise<boolean> {
  const repoRoot = $gitRepoRoot.get()

  return runBranchOp(() => gitRenameBranch(repoRoot as string, branch, newName))
}

export function deleteGitBranch(branch: string, force?: boolean): Promise<boolean> {
  const repoRoot = $gitRepoRoot.get()

  return runBranchOp(() => gitDeleteBranch(repoRoot as string, branch, force))
}

export function mergeGitBranch(branch: string): Promise<boolean> {
  const repoRoot = $gitRepoRoot.get()

  return runBranchOp(() => gitMerge(repoRoot as string, branch))
}

export function rebaseOntoGitBranch(branch: string): Promise<boolean> {
  const repoRoot = $gitRepoRoot.get()

  return runBranchOp(() => gitRebase(repoRoot as string, branch))
}

// ─── Diff dialog (Compare with / Show Diff with Working Tree) ──────────────

export interface GitDiffDialog {
  title: string
  diff: string
}

export const $gitDiffDialog = atom<GitDiffDialog | null>(null)
export const $gitDiffDialogLoading = atom(false)

let diffDialogToken = 0

export function closeGitDiffDialog() {
  $gitDiffDialog.set(null)
  $gitDiffDialogLoading.set(false)
}

// Working tree vs a ref ("Show Diff with Working Tree").
export async function showGitDiffWithWorkingTree(ref: string, title: string) {
  const repoRoot = $gitRepoRoot.get()

  if (!repoRoot) {
    return
  }

  const token = ++diffDialogToken
  $gitDiffDialog.set({ diff: '', title })
  $gitDiffDialogLoading.set(true)

  const result = await gitDiffWorkingTree(repoRoot, ref)

  if (token !== diffDialogToken) {
    return
  }

  $gitDiffDialogLoading.set(false)

  if (result.ok) {
    $gitDiffDialog.set({ diff: result.diff, title })
  } else {
    $gitError.set(result.error)
    closeGitDiffDialog()
  }
}

// Compare two refs ("Compare with '<branch>'").
export async function showGitCompare(base: string, target: string, title: string) {
  const repoRoot = $gitRepoRoot.get()

  if (!repoRoot) {
    return
  }

  const token = ++diffDialogToken
  $gitDiffDialog.set({ diff: '', title })
  $gitDiffDialogLoading.set(true)

  const result = await gitCompareBranches(repoRoot, base, target)

  if (token !== diffDialogToken) {
    return
  }

  $gitDiffDialogLoading.set(false)

  if (result.ok) {
    $gitDiffDialog.set({ diff: result.diff, title })
  } else {
    $gitError.set(result.error)
    closeGitDiffDialog()
  }
}

export function pullGit(): Promise<boolean> {
  const repoRoot = $gitRepoRoot.get()

  return runBranchOp(() => gitPull(repoRoot as string))
}

export function pushGit(): Promise<boolean> {
  const repoRoot = $gitRepoRoot.get()

  return runBranchOp(() => gitPush(repoRoot as string))
}
