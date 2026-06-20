import { atom } from 'nanostores'

export type FindInFilesMode = 'find' | 'replace'

export interface FindInFilesState {
  open: boolean
  mode: FindInFilesMode
}

export const $findInFiles = atom<FindInFilesState>({ open: false, mode: 'find' })

export function openFindInFiles(mode: FindInFilesMode = 'find') {
  $findInFiles.set({ open: true, mode })
}

export function closeFindInFiles() {
  $findInFiles.set({ ...$findInFiles.get(), open: false })
}

export function setFindInFilesMode(mode: FindInFilesMode) {
  $findInFiles.set({ ...$findInFiles.get(), mode })
}
