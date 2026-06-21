import { atom, computed, type ReadableAtom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'

import { $paneStates } from './panes'
import { isAnyToolWindowOpenInGroup } from './tool-windows'

// Persisted bottom-dock height (px). Drag the dock's top edge to resize.
const HEIGHT_KEY = 'hermes.desktop.bottomDockHeight'
const DEFAULT_HEIGHT = 280
const MIN_HEIGHT = 120
const MAX_HEIGHT_VH = 0.8 // cap at 80% of the viewport

function loadHeight(): number {
  const raw = Number.parseInt(storedString(HEIGHT_KEY) ?? String(DEFAULT_HEIGHT), 10)

  return Number.isFinite(raw) && raw >= MIN_HEIGHT ? raw : DEFAULT_HEIGHT
}

export const $bottomDockHeight = atom(loadHeight())

$bottomDockHeight.subscribe(height => persistString(HEIGHT_KEY, String(Math.round(height))))

export function setBottomDockHeight(height: number) {
  const maxHeight = typeof window === 'undefined' ? 2000 : Math.round(window.innerHeight * MAX_HEIGHT_VH)
  const bounded = Math.max(MIN_HEIGHT, Math.min(maxHeight, Math.round(height)))

  if ($bottomDockHeight.get() !== bounded) {
    $bottomDockHeight.set(bounded)
  }
}

// True when either bottom group (left or right) has an open tool window.
export const $bottomDockOpen: ReadableAtom<boolean> = computed($paneStates, () => {
  return isAnyToolWindowOpenInGroup('left', 'bottom') || isAnyToolWindowOpenInGroup('right', 'bottom')
})
