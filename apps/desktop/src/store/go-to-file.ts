import { atom } from 'nanostores'

export const $goToFileOpen = atom(false)

export function openGoToFile() {
  $goToFileOpen.set(true)
}

export function closeGoToFile() {
  $goToFileOpen.set(false)
}
