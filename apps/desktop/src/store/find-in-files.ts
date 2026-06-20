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

// Toggle for the keybind: open in the given mode, or close if already open in
// that same mode. Pressing the shortcut again reliably reopens after any close.
export function toggleFindInFiles(mode: FindInFilesMode = 'find') {
  const current = $findInFiles.get()

  if (current.open && current.mode === mode) {
    $findInFiles.set({ ...current, open: false })

    return
  }

  $findInFiles.set({ open: true, mode })
}

export function closeFindInFiles() {
  $findInFiles.set({ ...$findInFiles.get(), open: false })
}

export function setFindInFilesMode(mode: FindInFilesMode) {
  $findInFiles.set({ ...$findInFiles.get(), mode })
}
