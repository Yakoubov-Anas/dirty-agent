import { atom, computed, type ReadableAtom } from 'nanostores'

import {
  CHAT_SIDEBAR_PANE_ID,
  FILE_BROWSER_PANE_ID,
  GIT_COMMIT_PANE_ID,
  GIT_LOG_PANE_ID,
  TERMINAL_PANE_ID
} from './layout'
import { $paneStates, setPaneOpen, togglePane } from './panes'

export type ToolWindowSide = 'left' | 'right'
export type ToolWindowId =
  | typeof CHAT_SIDEBAR_PANE_ID
  | typeof FILE_BROWSER_PANE_ID
  | typeof TERMINAL_PANE_ID
  | typeof GIT_COMMIT_PANE_ID
  | typeof GIT_LOG_PANE_ID

const STORAGE_KEY = 'hermes.desktop.toolWindowSides.v1'

// JetBrains-style tool windows: each panel docks on a side, toggled from the
// edge stripe, relocated via the stripe's right-click menu. Defaults mirror the
// classic layout — sessions/agent + commit + log on the left, file browser +
// console on the right.
export const TOOL_WINDOW_DEFAULT_SIDES: Record<ToolWindowId, ToolWindowSide> = {
  [CHAT_SIDEBAR_PANE_ID]: 'left',
  [FILE_BROWSER_PANE_ID]: 'right',
  [TERMINAL_PANE_ID]: 'right',
  [GIT_COMMIT_PANE_ID]: 'left',
  [GIT_LOG_PANE_ID]: 'left'
}

export interface ToolWindowMeta {
  icon: string
  id: ToolWindowId
}

// Order here is the top-to-bottom order on a stripe.
export const TOOL_WINDOWS: readonly ToolWindowMeta[] = [
  { icon: 'comment-discussion', id: CHAT_SIDEBAR_PANE_ID },
  { icon: 'git-commit', id: GIT_COMMIT_PANE_ID },
  { icon: 'git-branch', id: GIT_LOG_PANE_ID },
  { icon: 'files', id: FILE_BROWSER_PANE_ID },
  { icon: 'terminal', id: TERMINAL_PANE_ID }
]

const TOOL_WINDOW_IDS = TOOL_WINDOWS.map(w => w.id)

function load(): Record<ToolWindowId, ToolWindowSide> {
  const out = { ...TOOL_WINDOW_DEFAULT_SIDES }

  if (typeof window === 'undefined') {
    return out
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (raw) {
      const parsed = JSON.parse(raw) as unknown

      if (parsed && typeof parsed === 'object') {
        for (const id of TOOL_WINDOW_IDS) {
          const value = (parsed as Record<string, unknown>)[id]

          if (value === 'left' || value === 'right') {
            out[id] = value
          }
        }
      }
    }
  } catch {
    // Treat unparseable persisted state as defaults.
  }

  return out
}

export const $toolWindowSides = atom<Record<ToolWindowId, ToolWindowSide>>(load())

$toolWindowSides.subscribe(sides => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sides))
  } catch {
    // Storage failures are nonfatal.
  }
})

const sideCache = new Map<ToolWindowId, ReadableAtom<ToolWindowSide>>()

export function $toolWindowSide(id: ToolWindowId): ReadableAtom<ToolWindowSide> {
  let cached = sideCache.get(id)

  if (!cached) {
    cached = computed($toolWindowSides, sides => sides[id] ?? TOOL_WINDOW_DEFAULT_SIDES[id])
    sideCache.set(id, cached)
  }

  return cached
}

export function getToolWindowSide(id: ToolWindowId): ToolWindowSide {
  return $toolWindowSides.get()[id] ?? TOOL_WINDOW_DEFAULT_SIDES[id]
}

export function setToolWindowSide(id: ToolWindowId, side: ToolWindowSide) {
  if (getToolWindowSide(id) === side) {
    return
  }

  $toolWindowSides.set({ ...$toolWindowSides.get(), [id]: side })
}

export function toolWindowsOnSide(side: ToolWindowSide): ToolWindowId[] {
  const sides = $toolWindowSides.get()

  return TOOL_WINDOW_IDS.filter(id => (sides[id] ?? TOOL_WINDOW_DEFAULT_SIDES[id]) === side)
}

export function toggleToolWindow(id: ToolWindowId) {
  togglePane(id)
}

// Header "hide panels" buttons collapse/restore a whole edge: if anything on the
// side is open, hide it all; otherwise reopen every panel docked on that side.
export function toggleToolWindowSide(side: ToolWindowSide) {
  const ids = toolWindowsOnSide(side)

  if (ids.length === 0) {
    return
  }

  const states = $paneStates.get()
  const anyOpen = ids.some(id => states[id]?.open)

  for (const id of ids) {
    setPaneOpen(id, !anyOpen)
  }
}

export function isAnyToolWindowOpenOnSide(side: ToolWindowSide): boolean {
  const states = $paneStates.get()

  return toolWindowsOnSide(side).some(id => states[id]?.open)
}
