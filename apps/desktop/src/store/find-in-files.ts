import { atom } from 'nanostores'

export type FindInFilesMode = 'find' | 'replace'

export interface FindInFilesState {
  open: boolean
  mode: FindInFilesMode
}

export const $findInFiles = atom<FindInFilesState>({ open: false, mode: 'find' })

export function openFindInFiles(mode: FindInFilesMode = 'find') {
  // Always open (never toggle-close): the shortcut should reliably surface the
  // dialog regardless of current state, matching JetBrains. If it's already
  // open we just switch to the requested mode and keep it open.
  $findInFiles.set({ open: true, mode })
}

export function closeFindInFiles() {
  $findInFiles.set({ ...$findInFiles.get(), open: false })
}

export function setFindInFilesMode(mode: FindInFilesMode) {
  $findInFiles.set({ ...$findInFiles.get(), mode })
}
