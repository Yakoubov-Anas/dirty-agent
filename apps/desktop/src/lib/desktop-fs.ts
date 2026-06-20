import type {
  HermesConnection,
  HermesReadDirResult,
  HermesReadFileTextResult,
  HermesSelectPathsOptions,
  HermesWorktreeInfo,
  HermesWriteFileTextResult
} from '@/global'
import { $connection } from '@/store/session'

export interface DesktopFsRemotePicker {
  selectPaths: (options?: HermesSelectPathsOptions) => Promise<string[]>
}

let remotePicker: DesktopFsRemotePicker | null = null

export function setDesktopFsRemotePicker(next: DesktopFsRemotePicker | null) {
  remotePicker = next
}

function connectionCacheKey(connection: HermesConnection | null) {
  if (!connection) {
    return 'local:'
  }

  return `${connection.mode || 'local'}:${connection.profile || ''}:${connection.baseUrl || ''}`
}

export function desktopFsCacheKey() {
  return connectionCacheKey($connection.get())
}

export function isDesktopFsRemoteMode() {
  return $connection.get()?.mode === 'remote'
}

function fsPath(endpoint: string, filePath: string) {
  return `/api/fs/${endpoint}?path=${encodeURIComponent(filePath)}`
}

function bridge() {
  const desktop = window.hermesDesktop

  if (!desktop) {
    throw new Error('Hermes Desktop bridge is unavailable')
  }

  return desktop
}

export async function readDesktopDir(path: string): Promise<HermesReadDirResult> {
  const desktop = bridge()

  if (!isDesktopFsRemoteMode()) {
    return desktop.readDir(path)
  }

  return desktop.api<HermesReadDirResult>({ path: fsPath('list', path) })
}

export async function readDesktopFileText(path: string): Promise<HermesReadFileTextResult> {
  const desktop = bridge()

  if (!isDesktopFsRemoteMode()) {
    return desktop.readFileText(path)
  }

  return desktop.api<HermesReadFileTextResult>({ path: fsPath('read-text', path) })
}

export async function writeDesktopFileText(path: string, content: string): Promise<HermesWriteFileTextResult> {
  const desktop = bridge()

  if (!isDesktopFsRemoteMode()) {
    return desktop.writeFileText(path, content)
  }

  return desktop.api<HermesWriteFileTextResult>({
    path: '/api/fs/write-text',
    method: 'POST',
    body: { path, content }
  })
}

export async function readDesktopFileDataUrl(path: string): Promise<string> {
  const desktop = bridge()

  if (!isDesktopFsRemoteMode()) {
    return desktop.readFileDataUrl(path)
  }

  const result = await desktop.api<string | { dataUrl?: string }>({ path: fsPath('read-data-url', path) })

  return typeof result === 'string' ? result : result.dataUrl || ''
}

// Reveal a path in the OS file manager (Finder/Explorer). Local-only — a remote
// backend's paths don't exist on this machine, so there is nothing to show.
// Returns false when unavailable (remote mode, no bridge, or the reveal failed).
export async function revealDesktopPathInOS(path: string): Promise<boolean> {
  if (!path || isDesktopFsRemoteMode()) {
    return false
  }

  const reveal = window.hermesDesktop?.revealInOS

  if (!reveal) {
    return false
  }

  try {
    const result = await reveal(path)

    return Boolean(result?.ok)
  } catch {
    return false
  }
}

export type DesktopEntryKind = 'file' | 'folder'

// Create an empty file or a folder named `name` inside `parentPath`. Local mode
// goes through Electron IPC; remote mode posts to the backend. Returns the new
// entry's absolute path. Throws on conflict / permission / sensitive-file block.
export async function createDesktopEntry(
  parentPath: string,
  name: string,
  kind: DesktopEntryKind
): Promise<string> {
  const desktop = bridge()

  if (!isDesktopFsRemoteMode()) {
    const result = await desktop.createEntry(parentPath, name, kind)

    return result.path
  }

  const result = await desktop.api<{ path: string }>({
    path: '/api/fs/create',
    method: 'POST',
    body: { path: parentPath, name, kind }
  })

  return result.path
}

// Rename `sourcePath` to `newName` within its own directory. Returns the new
// absolute path.
export async function renameDesktopEntry(sourcePath: string, newName: string): Promise<string> {
  const desktop = bridge()

  if (!isDesktopFsRemoteMode()) {
    const result = await desktop.renameEntry(sourcePath, newName)

    return result.path
  }

  const result = await desktop.api<{ path: string }>({
    path: '/api/fs/rename',
    method: 'POST',
    body: { path: sourcePath, newName }
  })

  return result.path
}

// Delete `targetPath`. Local mode moves it to the OS trash (recoverable); remote
// mode removes it on the backend host.
export async function deleteDesktopEntry(targetPath: string): Promise<void> {
  const desktop = bridge()

  if (!isDesktopFsRemoteMode()) {
    await desktop.deleteEntry(targetPath)

    return
  }

  await desktop.api<{ path: string }>({
    path: '/api/fs/delete',
    method: 'POST',
    body: { path: targetPath }
  })
}

export interface FileSearchOptions {
  query: string
  root?: string
  caseSensitive?: boolean
  regexp?: boolean
  wholeWord?: boolean
}

export interface FileSearchMatch {
  line: number
  column: number
  matchEnd: number
  preview: string
}

export interface FileSearchFile {
  path: string
  matches: FileSearchMatch[]
}

export interface FileSearchResult {
  files: FileSearchFile[]
  total: number
  truncated: boolean
}

export interface FileReplaceResult {
  filesChanged: number
  replacements: number
}

// Project-wide content search. Always routed through the backend (the desktop
// always has one) since it uses ripgrep — there's no local IPC equivalent.
export async function searchDesktopFiles(options: FileSearchOptions): Promise<FileSearchResult> {
  return bridge().api<FileSearchResult>({
    path: '/api/fs/search',
    method: 'POST',
    body: { ...options }
  })
}

export async function replaceDesktopFiles(
  options: FileSearchOptions & { replace: string; files?: string[] }
): Promise<FileReplaceResult> {
  return bridge().api<FileReplaceResult>({
    path: '/api/fs/replace',
    method: 'POST',
    body: { ...options }
  })
}

export interface FileFindResult {
  files: string[]
  truncated: boolean
}

// Fuzzy file-name finder (JetBrains "Go to File"). Empty query returns recent
// files. Routed through the backend (ripgrep --files honours .gitignore).
export async function findDesktopFilesByName(query: string, root?: string): Promise<FileFindResult> {
  return bridge().api<FileFindResult>({
    path: '/api/fs/find-files',
    method: 'POST',
    body: { query, root }
  })
}

export async function desktopGitRoot(path: string): Promise<string | null> {
  const desktop = bridge()

  if (!isDesktopFsRemoteMode()) {
    return desktop.gitRoot ? desktop.gitRoot(path) : null
  }

  const result = await desktop.api<{ root: string | null }>({ path: fsPath('git-root', path) })

  return result.root
}

// Worktree detection runs against the LOCAL filesystem (the electron main
// process). For a remote backend the session cwds live on another machine, so
// we can't resolve them here — callers fall back to the path-name heuristic.
export async function desktopWorktrees(cwds: string[]): Promise<Record<string, HermesWorktreeInfo | null>> {
  if (isDesktopFsRemoteMode()) {
    return {}
  }

  const desktop = bridge()

  return desktop.worktrees ? desktop.worktrees(cwds) : {}
}

export async function desktopDefaultCwd(): Promise<{ branch: string; cwd: string } | null> {
  if (!isDesktopFsRemoteMode()) {
    return null
  }

  return bridge().api<{ branch: string; cwd: string }>({ path: '/api/fs/default-cwd' })
}

export async function selectDesktopPaths(options?: HermesSelectPathsOptions): Promise<string[]> {
  const desktop = bridge()

  if (!isDesktopFsRemoteMode()) {
    return desktop.selectPaths(options)
  }

  if (!options?.directories || options.multiple !== false) {
    return []
  }

  return remotePicker ? remotePicker.selectPaths(options) : []
}
