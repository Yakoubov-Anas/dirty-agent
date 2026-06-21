import { atom } from 'nanostores'

import type { FileSearchResult } from '@/lib/desktop-fs'

export type FindInFilesMode = 'find' | 'replace'

export interface FindInFilesState {
  open: boolean
  mode: FindInFilesMode
}

export const $findInFiles = atom<FindInFilesState>({ open: false, mode: 'find' })

// Persisted form + results so reopening the dialog shows the previous search
// instantly instead of re-fetching from scratch. The dialog seeds its local
// state from here on mount and writes back as the user works.
export interface FindInFilesSession {
  query: string
  replacement: string
  caseSensitive: boolean
  wholeWord: boolean
  regexp: boolean
  result: FileSearchResult | null
}

const EMPTY_SESSION: FindInFilesSession = {
  query: '',
  replacement: '',
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  result: null
}

export const $findInFilesSession = atom<FindInFilesSession>(EMPTY_SESSION)

export function saveFindInFilesSession(patch: Partial<FindInFilesSession>) {
  $findInFilesSession.set({ ...$findInFilesSession.get(), ...patch })
}

export function openFindInFiles(mode: FindInFilesMode = 'find', query?: string) {
  // When opened from a non-empty editor selection, seed it as the query (and
  // drop stale results) so the dialog prefills with the selected text. Empty
  // selection keeps the previous session query.
  if (query) {
    saveFindInFilesSession({ query, result: null })
  }

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
