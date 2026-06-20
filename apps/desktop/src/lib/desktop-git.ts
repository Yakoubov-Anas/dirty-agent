import type {
  HermesGitBranchesResult,
  HermesGitCommitResult,
  HermesGitDiffResult,
  HermesGitMutationResult,
  HermesGitStatusResult
} from '@/global'

// Local-only git bridge for the Commit tool window. Mirrors the desktop-fs
// pattern: thin wrappers over window.hermesDesktop.git. Remote (gateway-backed)
// repos aren't wired yet — callers should gate on isGitAvailable().

export function isGitAvailable(): boolean {
  return Boolean(window.hermesDesktop?.git)
}

const NO_BRIDGE = 'Git is only available in the desktop app.'

export async function gitStatus(repoRoot: string): Promise<HermesGitStatusResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.status(repoRoot)
}

export async function gitDiff(
  repoRoot: string,
  filePath: string,
  staged: boolean,
  untracked = false
): Promise<HermesGitDiffResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.diff(repoRoot, filePath, staged, untracked)
}

export async function gitStage(repoRoot: string, paths: string[]): Promise<HermesGitMutationResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.stage(repoRoot, paths)
}

export async function gitUnstage(repoRoot: string, paths: string[]): Promise<HermesGitMutationResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.unstage(repoRoot, paths)
}

export async function gitCommit(
  repoRoot: string,
  message: string,
  options?: { amend?: boolean }
): Promise<HermesGitCommitResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.commit(repoRoot, message, options)
}

export async function gitBranches(repoRoot: string): Promise<HermesGitBranchesResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.branches(repoRoot)
}

export async function gitCheckout(repoRoot: string, branch: string): Promise<HermesGitMutationResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.checkout(repoRoot, branch)
}

export async function gitCreateBranch(
  repoRoot: string,
  branch: string,
  startPoint?: string
): Promise<HermesGitMutationResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.createBranch(repoRoot, branch, startPoint)
}

export async function gitRenameBranch(
  repoRoot: string,
  branch: string,
  newName: string
): Promise<HermesGitMutationResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.renameBranch(repoRoot, branch, newName)
}

export async function gitDeleteBranch(
  repoRoot: string,
  branch: string,
  force?: boolean
): Promise<HermesGitMutationResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.deleteBranch(repoRoot, branch, force)
}

export async function gitMerge(repoRoot: string, branch: string): Promise<HermesGitCommitResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.merge(repoRoot, branch)
}

export async function gitRebase(repoRoot: string, branch: string): Promise<HermesGitCommitResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.rebase(repoRoot, branch)
}

export async function gitDiffWorkingTree(repoRoot: string, ref: string): Promise<HermesGitDiffResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.diffWorkingTree(repoRoot, ref)
}

export async function gitCompareBranches(
  repoRoot: string,
  base: string,
  target: string
): Promise<HermesGitDiffResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.compareBranches(repoRoot, base, target)
}

export async function gitPull(repoRoot: string): Promise<HermesGitCommitResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.pull(repoRoot)
}

export async function gitPush(repoRoot: string): Promise<HermesGitCommitResult> {
  const git = window.hermesDesktop?.git

  if (!git) {
    return { error: NO_BRIDGE, ok: false }
  }

  return git.push(repoRoot)
}
