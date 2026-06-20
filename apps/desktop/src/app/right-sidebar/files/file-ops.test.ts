import { afterEach, describe, expect, it, vi } from 'vitest'

const createDesktopEntry = vi.fn()
const renameDesktopEntry = vi.fn()
const deleteDesktopEntry = vi.fn()
const refreshTreeDir = vi.fn()
const revealPathInTree = vi.fn()

vi.mock('@/lib/desktop-fs', () => ({
  createDesktopEntry: (...args: unknown[]) => createDesktopEntry(...args),
  renameDesktopEntry: (...args: unknown[]) => renameDesktopEntry(...args),
  deleteDesktopEntry: (...args: unknown[]) => deleteDesktopEntry(...args)
}))

vi.mock('./use-project-tree', () => ({
  refreshTreeDir: (...args: unknown[]) => refreshTreeDir(...args),
  revealPathInTree: (...args: unknown[]) => revealPathInTree(...args)
}))

import {
  $fileOp,
  baseName,
  closeFileOp,
  createEntryAndReveal,
  deleteEntryAndRefresh,
  openDeletePrompt,
  openNewFilePrompt,
  openRenamePrompt,
  parentDir,
  renameEntryAndReveal
} from './file-ops'

afterEach(() => {
  createDesktopEntry.mockReset()
  renameDesktopEntry.mockReset()
  deleteDesktopEntry.mockReset()
  refreshTreeDir.mockReset()
  revealPathInTree.mockReset()
  closeFileOp()
})

describe('path helpers', () => {
  it('baseName is separator-agnostic', () => {
    expect(baseName('/a/b/c.ts')).toBe('c.ts')
    expect(baseName('C:\\a\\b\\c.ts')).toBe('c.ts')
    expect(baseName('/a/b/')).toBe('b')
  })

  it('parentDir is separator-agnostic', () => {
    expect(parentDir('/a/b/c.ts')).toBe('/a/b')
    expect(parentDir('C:\\a\\b\\c.ts')).toBe('C:\\a\\b')
    expect(parentDir('/a/b/')).toBe('/a')
  })
})

describe('$fileOp store', () => {
  it('open* actions set the request and closeFileOp clears it', () => {
    openNewFilePrompt('/work')
    expect($fileOp.get()).toEqual({ isFolder: false, mode: 'new-file', path: '/work' })

    openRenamePrompt('/work/a.ts', false)
    expect($fileOp.get()).toEqual({ isFolder: false, mode: 'rename', path: '/work/a.ts' })

    openDeletePrompt('/work/dir', true)
    expect($fileOp.get()).toEqual({ isFolder: true, mode: 'delete', path: '/work/dir' })

    closeFileOp()
    expect($fileOp.get()).toBeNull()
  })
})

describe('file operations', () => {
  it('createEntryAndReveal creates, refreshes the dir, then reveals the new path', async () => {
    createDesktopEntry.mockResolvedValue('/work/new.ts')

    const result = await createEntryAndReveal('/work', 'new.ts', 'file')

    expect(result).toBe('/work/new.ts')
    expect(createDesktopEntry).toHaveBeenCalledWith('/work', 'new.ts', 'file')
    expect(refreshTreeDir).toHaveBeenCalledWith('/work')
    expect(revealPathInTree).toHaveBeenCalledWith('/work/new.ts')
  })

  it('renameEntryAndReveal renames, refreshes the parent, then reveals', async () => {
    renameDesktopEntry.mockResolvedValue('/work/src/renamed.ts')

    const result = await renameEntryAndReveal('/work/src/old.ts', 'renamed.ts')

    expect(result).toBe('/work/src/renamed.ts')
    expect(renameDesktopEntry).toHaveBeenCalledWith('/work/src/old.ts', 'renamed.ts')
    expect(refreshTreeDir).toHaveBeenCalledWith('/work/src')
    expect(revealPathInTree).toHaveBeenCalledWith('/work/src/renamed.ts')
  })

  it('deleteEntryAndRefresh deletes then refreshes the parent', async () => {
    deleteDesktopEntry.mockResolvedValue(undefined)

    await deleteEntryAndRefresh('/work/src/gone.ts')

    expect(deleteDesktopEntry).toHaveBeenCalledWith('/work/src/gone.ts')
    expect(refreshTreeDir).toHaveBeenCalledWith('/work/src')
    expect(revealPathInTree).not.toHaveBeenCalled()
  })
})
