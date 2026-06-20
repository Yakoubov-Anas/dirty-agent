import { atom } from 'nanostores'

import { createDesktopEntry, deleteDesktopEntry, renameDesktopEntry } from '@/lib/desktop-fs'

import { refreshTreeDir, revealPathInTree } from './use-project-tree'

export type FileOpMode = 'delete' | 'new-file' | 'new-folder' | 'rename'

export interface FileOpRequest {
  /** For new-file/new-folder this is the parent directory; for rename/delete it
   *  is the entry being acted on. */
  isFolder: boolean
  mode: FileOpMode
  path: string
}

/** The currently-open file-operation dialog, or null when none is showing. A
 *  single store (rather than per-row state) so the menu can outlive the
 *  virtualized row that opened it. */
export const $fileOp = atom<FileOpRequest | null>(null)

export function openNewFilePrompt(dirPath: string) {
  $fileOp.set({ isFolder: false, mode: 'new-file', path: dirPath })
}

export function openNewFolderPrompt(dirPath: string) {
  $fileOp.set({ isFolder: false, mode: 'new-folder', path: dirPath })
}

export function openRenamePrompt(path: string, isFolder: boolean) {
  $fileOp.set({ isFolder, mode: 'rename', path })
}

export function openDeletePrompt(path: string, isFolder: boolean) {
  $fileOp.set({ isFolder, mode: 'delete', path })
}

export function closeFileOp() {
  $fileOp.set(null)
}

/** Basename of `path`, separator-agnostic. */
export function baseName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? path
  )
}

/** Parent directory of `path`, separator-agnostic (keeps the original style). */
export function parentDir(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))

  return idx <= 0 ? trimmed : trimmed.slice(0, idx)
}

/** Create an entry, refresh its parent in the tree, then reveal + select it. */
export async function createEntryAndReveal(dirPath: string, name: string, kind: 'file' | 'folder') {
  const newPath = await createDesktopEntry(dirPath, name, kind)
  await refreshTreeDir(dirPath)
  await revealPathInTree(newPath)

  return newPath
}

/** Rename an entry, refresh its parent in the tree, then reveal the new path. */
export async function renameEntryAndReveal(path: string, newName: string) {
  const newPath = await renameDesktopEntry(path, newName)
  await refreshTreeDir(parentDir(path))
  await revealPathInTree(newPath)

  return newPath
}

/** Delete an entry (trash, locally) and refresh its parent in the tree. */
export async function deleteEntryAndRefresh(path: string) {
  await deleteDesktopEntry(path)
  await refreshTreeDir(parentDir(path))
}
