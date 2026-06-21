import { atom, computed, type ReadableAtom } from 'nanostores'

import { persistBoolean, storedBoolean } from '@/lib/storage'

import {
  CHAT_SIDEBAR_PANE_ID,
  FILE_BROWSER_PANE_ID,
  GIT_COMMIT_PANE_ID,
  GIT_LOG_PANE_ID,
  TERMINAL_PANE_ID
} from './layout'
import { $paneStates, setPaneOpen, togglePane } from './panes'

export type ToolWindowSide = 'left' | 'right'
// A stripe has two groups: the top group docks panels on the side; the bottom
// group docks them in the bottom dock (full width, or split when both sides
// have a bottom panel) — JetBrains-style.
export type ToolWindowSegment = 'bottom' | 'top'

export type ToolWindowId =
  | typeof CHAT_SIDEBAR_PANE_ID
  | typeof FILE_BROWSER_PANE_ID
  | typeof TERMINAL_PANE_ID
  | typeof GIT_COMMIT_PANE_ID
  | typeof GIT_LOG_PANE_ID

export interface ToolWindowPlacement {
  side: ToolWindowSide
  segment: ToolWindowSegment
  // Order within the (side, segment) group, top-to-bottom on the stripe.
  order: number
}

// Bumped to v2: placement now carries segment + order, not just a side.
const STORAGE_KEY = 'hermes.desktop.toolWindowPlacements.v2'
const LEGACY_SIDES_KEY = 'hermes.desktop.toolWindowSides.v1'

export interface ToolWindowMeta {
  icon: string
  id: ToolWindowId
}

// Registry of every tool window (icon + id). The default placement below seeds
// the initial layout; persisted state overrides it per-user.
export const TOOL_WINDOWS: readonly ToolWindowMeta[] = [
  { icon: 'comment-discussion', id: CHAT_SIDEBAR_PANE_ID },
  { icon: 'git-commit', id: GIT_COMMIT_PANE_ID },
  { icon: 'git-branch', id: GIT_LOG_PANE_ID },
  { icon: 'files', id: FILE_BROWSER_PANE_ID },
  { icon: 'terminal', id: TERMINAL_PANE_ID }
]

const TOOL_WINDOW_IDS = TOOL_WINDOWS.map(w => w.id)

// Default layout: sessions/commit/log on the left side; files on the right
// side; console in the bottom dock (JetBrains-like).
export const TOOL_WINDOW_DEFAULT_PLACEMENTS: Record<ToolWindowId, ToolWindowPlacement> = {
  [CHAT_SIDEBAR_PANE_ID]: { order: 0, segment: 'top', side: 'left' },
  [GIT_COMMIT_PANE_ID]: { order: 1, segment: 'top', side: 'left' },
  [GIT_LOG_PANE_ID]: { order: 2, segment: 'top', side: 'left' },
  [FILE_BROWSER_PANE_ID]: { order: 0, segment: 'top', side: 'right' },
  [TERMINAL_PANE_ID]: { order: 0, segment: 'bottom', side: 'left' }
}

function defaultPlacement(id: ToolWindowId): ToolWindowPlacement {
  return { ...TOOL_WINDOW_DEFAULT_PLACEMENTS[id] }
}

function isPlacement(value: unknown): value is ToolWindowPlacement {
  if (!value || typeof value !== 'object') {
    return false
  }

  const r = value as Record<string, unknown>

  return (
    (r.side === 'left' || r.side === 'right') &&
    (r.segment === 'top' || r.segment === 'bottom') &&
    typeof r.order === 'number' &&
    Number.isFinite(r.order)
  )
}

function load(): Record<ToolWindowId, ToolWindowPlacement> {
  const out = {} as Record<ToolWindowId, ToolWindowPlacement>

  for (const id of TOOL_WINDOW_IDS) {
    out[id] = defaultPlacement(id)
  }

  if (typeof window === 'undefined') {
    return out
  }

  // v2 placements take precedence.
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (raw) {
      const parsed = JSON.parse(raw) as unknown

      if (parsed && typeof parsed === 'object') {
        for (const id of TOOL_WINDOW_IDS) {
          const value = (parsed as Record<string, unknown>)[id]

          if (isPlacement(value)) {
            out[id] = { order: value.order, segment: value.segment, side: value.side }
          }
        }
      }

      return out
    }
  } catch {
    // fall through to legacy / defaults
  }

  // One-time migration from the v1 side-only storage: keep the user's chosen
  // sides, default everything to the top segment, preserve registry order.
  try {
    const legacy = window.localStorage.getItem(LEGACY_SIDES_KEY)

    if (legacy) {
      const parsed = JSON.parse(legacy) as unknown

      if (parsed && typeof parsed === 'object') {
        const perSideCount: Record<ToolWindowSide, number> = { left: 0, right: 0 }

        for (const id of TOOL_WINDOW_IDS) {
          const side = (parsed as Record<string, unknown>)[id]

          if (side === 'left' || side === 'right') {
            out[id] = { order: perSideCount[side]++, segment: 'top', side }
          }
        }
      }
    }
  } catch {
    // Treat unparseable legacy state as defaults.
  }

  return out
}

export const $toolWindowPlacements = atom<Record<ToolWindowId, ToolWindowPlacement>>(load())

$toolWindowPlacements.subscribe(placements => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(placements))
  } catch {
    // Storage failures are nonfatal.
  }
})

// When true, opening a panel hides the others in its (side, segment) group, so
// each group shows one panel at a time (JetBrains-style). Off = stack them
// side-by-side (the original behavior). Persisted.
const EXCLUSIVE_KEY = 'hermes.desktop.toolWindowExclusiveOpen'
export const $toolWindowExclusiveOpen = atom(storedBoolean(EXCLUSIVE_KEY, false))

$toolWindowExclusiveOpen.subscribe(value => persistBoolean(EXCLUSIVE_KEY, value))

// ─── Per-window derived atoms ─────────────────────────────────────────────

const placementCache = new Map<ToolWindowId, ReadableAtom<ToolWindowPlacement>>()
const sideCache = new Map<ToolWindowId, ReadableAtom<ToolWindowSide>>()
const segmentCache = new Map<ToolWindowId, ReadableAtom<ToolWindowSegment>>()

export function $toolWindowPlacement(id: ToolWindowId): ReadableAtom<ToolWindowPlacement> {
  let cached = placementCache.get(id)

  if (!cached) {
    cached = computed($toolWindowPlacements, placements => placements[id] ?? defaultPlacement(id))
    placementCache.set(id, cached)
  }

  return cached
}

// Backwards-compatible: many panes derive their inner-edge border from the side.
export function $toolWindowSide(id: ToolWindowId): ReadableAtom<ToolWindowSide> {
  let cached = sideCache.get(id)

  if (!cached) {
    cached = computed($toolWindowPlacements, placements => (placements[id] ?? defaultPlacement(id)).side)
    sideCache.set(id, cached)
  }

  return cached
}

export function $toolWindowSegment(id: ToolWindowId): ReadableAtom<ToolWindowSegment> {
  let cached = segmentCache.get(id)

  if (!cached) {
    cached = computed($toolWindowPlacements, placements => (placements[id] ?? defaultPlacement(id)).segment)
    segmentCache.set(id, cached)
  }

  return cached
}

// ─── Reads ────────────────────────────────────────────────────────────────

export function getPlacement(id: ToolWindowId): ToolWindowPlacement {
  return $toolWindowPlacements.get()[id] ?? defaultPlacement(id)
}

export function getToolWindowSide(id: ToolWindowId): ToolWindowSide {
  return getPlacement(id).side
}

// Tool ids in a (side, segment) group, sorted by order. `segment` defaults to
// 'top' so existing side-only callers keep their meaning.
export function toolWindowsInGroup(side: ToolWindowSide, segment: ToolWindowSegment): ToolWindowId[] {
  const placements = $toolWindowPlacements.get()

  return TOOL_WINDOW_IDS.filter(id => {
    const p = placements[id] ?? defaultPlacement(id)

    return p.side === side && p.segment === segment
  }).sort((a, b) => (placements[a]?.order ?? 0) - (placements[b]?.order ?? 0))
}

export function toolWindowsOnSide(side: ToolWindowSide): ToolWindowId[] {
  const placements = $toolWindowPlacements.get()

  return TOOL_WINDOW_IDS.filter(id => (placements[id] ?? defaultPlacement(id)).side === side).sort(
    (a, b) => (placements[a]?.order ?? 0) - (placements[b]?.order ?? 0)
  )
}

export function isAnyToolWindowOpenOnSide(side: ToolWindowSide): boolean {
  const states = $paneStates.get()

  return toolWindowsOnSide(side).some(id => states[id]?.open)
}

export function isAnyToolWindowOpenInGroup(side: ToolWindowSide, segment: ToolWindowSegment): boolean {
  const states = $paneStates.get()

  return toolWindowsInGroup(side, segment).some(id => states[id]?.open)
}

// ─── Mutations ──────────────────────────────────────────────────────────────

// Reassign order indices 0..n-1 within every (side, segment) group so they stay
// dense and gap-free after a move/reorder.
function normalize(placements: Record<ToolWindowId, ToolWindowPlacement>): Record<ToolWindowId, ToolWindowPlacement> {
  const groups = new Map<string, ToolWindowId[]>()

  for (const id of TOOL_WINDOW_IDS) {
    const p = placements[id]
    const key = `${p.side}:${p.segment}`
    const list = groups.get(key) ?? []
    list.push(id)
    groups.set(key, list)
  }

  const next = { ...placements }

  for (const list of groups.values()) {
    list.sort((a, b) => placements[a].order - placements[b].order)
    list.forEach((id, index) => {
      next[id] = { ...next[id], order: index }
    })
  }

  return next
}

// Place `id` into a target group at `targetOrder` (insertion index). Other
// members shift to make room; all groups re-normalize afterwards.
export function moveToolWindow(
  id: ToolWindowId,
  side: ToolWindowSide,
  segment: ToolWindowSegment,
  targetOrder?: number
) {
  const current = $toolWindowPlacements.get()

  // Members of the destination group (excluding the moving window), in order.
  const destMembers = TOOL_WINDOW_IDS.filter(
    other => other !== id && current[other].side === side && current[other].segment === segment
  ).sort((a, b) => current[a].order - current[b].order)

  const insertAt = targetOrder === undefined ? destMembers.length : Math.max(0, Math.min(targetOrder, destMembers.length))

  const next = { ...current }
  // Temporarily fractional order to slot between neighbors, then normalize.
  const before = destMembers[insertAt - 1]
  const after = destMembers[insertAt]
  const beforeOrder = before === undefined ? -1 : current[before].order
  const afterOrder = after === undefined ? beforeOrder + 2 : current[after].order
  next[id] = { order: (beforeOrder + afterOrder) / 2, segment, side }

  $toolWindowPlacements.set(normalize(next))
}

// Convenience: relocate to a side, keeping the current segment, appended last.
export function setToolWindowSide(id: ToolWindowId, side: ToolWindowSide) {
  const p = getPlacement(id)

  if (p.side === side) {
    return
  }

  moveToolWindow(id, side, p.segment)
}

// Convenience: relocate to a segment, keeping the current side, appended last.
export function setToolWindowSegment(id: ToolWindowId, segment: ToolWindowSegment) {
  const p = getPlacement(id)

  if (p.segment === segment) {
    return
  }

  moveToolWindow(id, p.side, segment)
}

export function toggleToolWindow(id: ToolWindowId) {
  const states = $paneStates.get()
  const willOpen = !(states[id]?.open ?? false)

  // Exclusive mode (JetBrains-like): opening a panel hides the others already
  // open in the same (side, segment) group, so each group shows one at a time.
  if (willOpen && $toolWindowExclusiveOpen.get()) {
    const p = getPlacement(id)

    for (const other of toolWindowsInGroup(p.side, p.segment)) {
      if (other !== id && states[other]?.open) {
        setPaneOpen(other, false)
      }
    }
  }

  togglePane(id)
}

export function toggleToolWindowExclusiveOpen() {
  const next = !$toolWindowExclusiveOpen.get()
  $toolWindowExclusiveOpen.set(next)

  // Enabling exclusivity immediately collapses each (side, segment) group to a
  // single open panel — keep the first open one, hide the rest — instead of
  // only applying on the next open.
  if (next) {
    const states = $paneStates.get()
    const seen = new Set<string>()

    for (const id of TOOL_WINDOW_IDS) {
      if (!states[id]?.open) {
        continue
      }

      const p = getPlacement(id)
      const key = `${p.side}:${p.segment}`

      if (seen.has(key)) {
        setPaneOpen(id, false)
      } else {
        seen.add(key)
      }
    }
  }
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
