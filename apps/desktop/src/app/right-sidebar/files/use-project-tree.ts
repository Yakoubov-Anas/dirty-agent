import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useCallback, useEffect, useMemo } from 'react'

import { $connection } from '@/store/session'

import { clearProjectDirCache, readProjectDir } from './ipc'

export interface TreeNode {
  /** Absolute filesystem path. Doubles as react-arborist node id. */
  id: string
  name: string
  /** Drives arborist's leaf-vs-expandable decision via childrenAccessor. */
  isDirectory: boolean
  /** `undefined` = directory, children not yet loaded. `[]` = loaded empty. */
  children?: TreeNode[]
  /** True while a readDir for this folder is in flight. */
  loading?: boolean
  /** Synthetic loading/error rows are not real filesystem entries. */
  placeholder?: 'error' | 'loading'
  /** Last error code from readDir (e.g. EACCES). Cleared on next successful load. */
  error?: string
}

const PLACEHOLDER_ID = '__loading__'
const ERROR_PLACEHOLDER_ID = '__error__'

function makeNode(path: string, name: string, isDirectory: boolean): TreeNode {
  return { id: path, isDirectory, name }
}

function patchNode(nodes: TreeNode[] | undefined | null, id: string, patch: (n: TreeNode) => TreeNode): TreeNode[] {
  if (!nodes) {
    return []
  }

  return nodes.map(n => {
    if (n.id === id) {
      return patch(n)
    }

    if (n.children && n.children.length > 0) {
      return { ...n, children: patchNode(n.children, id, patch) }
    }

    return n
  })
}

function findNode(nodes: TreeNode[] | undefined, id: string): TreeNode | null {
  if (!nodes) {
    return null
  }

  for (const n of nodes) {
    if (n.id === id) {
      return n
    }

    const found = findNode(n.children, id)

    if (found) {
      return found
    }
  }

  return null
}

/** Lowercase + forward-slash + no trailing slash, so a `file:` URL path and a
 *  backslash filesystem id compare equal (and Windows case-insensitivity holds). */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** Path segments of `path` relative to `root`, or null when `path` is not
 *  inside `root`. Comparison is separator- and case-insensitive. */
function relativeSegments(root: string, path: string): string[] | null {
  const nr = normalizePath(root)
  const np = normalizePath(path)

  if (np === nr) {
    return []
  }

  const prefix = `${nr}/`

  if (!np.startsWith(prefix)) {
    return null
  }

  return np.slice(prefix.length).split('/').filter(Boolean)
}

function placeholderChild(parentId: string): TreeNode {
  return { id: `${parentId}::${PLACEHOLDER_ID}`, isDirectory: false, name: 'Loading…', placeholder: 'loading' }
}

function errorChild(parentId: string, error: string | undefined): TreeNode {
  return {
    id: `${parentId}::${ERROR_PLACEHOLDER_ID}`,
    isDirectory: false,
    name: `Unable to read (${error || 'read-error'})`,
    placeholder: 'error'
  }
}

export interface UseProjectTreeResult {
  /** Bumped by collapseAll so callers can remount the tree fully collapsed. */
  collapseNonce: number
  data: TreeNode[]
  /** Directory actually displayed — differs from the requested cwd when the
   *  session's recorded cwd no longer exists and we fell back to the default
   *  workspace dir. */
  effectiveCwd: string
  openState: Record<string, boolean>
  /** Bumped each time a reveal is requested so the tree remounts with the
   *  revealed path expanded, then selects + scrolls to it. */
  revealNonce: number
  /** Absolute path of the node to select/scroll after a reveal, or null. */
  revealSelection: string | null
  rootError: string | null
  rootLoading: boolean
  collapseAll: () => void
  loadChildren: (id: string) => Promise<void>
  refreshRoot: () => Promise<void>
  /** Expand every ancestor folder of `path` and select/scroll to it. */
  revealPath: (path: string) => Promise<void>
  setNodeOpen: (id: string, open: boolean) => void
}

interface ProjectTreeState {
  collapseNonce: number
  cwd: string
  data: TreeNode[]
  loaded: boolean
  openState: Record<string, boolean>
  requestId: number
  /** Directory the displayed entries were read from ('' until first load). */
  resolvedCwd: string
  revealNonce: number
  revealSelection: string | null
  rootError: string | null
  rootLoading: boolean
}

const initialState: ProjectTreeState = {
  collapseNonce: 0,
  cwd: '',
  data: [],
  loaded: false,
  openState: {},
  requestId: 0,
  resolvedCwd: '',
  revealNonce: 0,
  revealSelection: null,
  rootError: null,
  rootLoading: false
}

const inflight = new Set<string>()
const $projectTree = atom<ProjectTreeState>(initialState)
let nextRootRequestId = 0
let lastConnectionKey = ''

// While the root is errored (ENOENT during a session's cwd race, a folder that
// reappears after a checkout, a remote that wasn't ready), keep retrying on a
// slow cadence so the tree self-heals instead of staying "UNREADABLE" forever.
const ROOT_ERROR_RETRY_MS = 3_000

function setProjectTree(updater: (current: ProjectTreeState) => ProjectTreeState) {
  $projectTree.set(updater($projectTree.get()))
}

function clearProjectTree() {
  nextRootRequestId += 1
  inflight.clear()
  $projectTree.set({ ...initialState, requestId: nextRootRequestId })
}

/** Sessions record their launch cwd; deleted worktrees and remote-backend
 *  paths arrive here as directories that don't exist on this machine. Rather
 *  than bricking the tree, display the sanitized workspace fallback (main
 *  prefers the configured default project dir). Local connections only —
 *  remote trees are read through the remote bridge. */
async function fallbackRootFor(cwd: string): Promise<string | null> {
  if ($connection.get()?.mode === 'remote') {
    return null
  }

  const sanitize = window.hermesDesktop?.sanitizeWorkspaceCwd

  if (!sanitize) {
    return null
  }

  try {
    const { cwd: fallback, sanitized } = await sanitize(cwd)

    return sanitized && fallback && fallback !== cwd ? fallback : null
  } catch {
    return null
  }
}

async function loadRoot(cwd: string, { force = false }: { force?: boolean } = {}) {
  if (!cwd) {
    clearProjectTree()

    return
  }

  const current = $projectTree.get()

  if (!force && current.cwd === cwd && (current.loaded || current.rootLoading)) {
    return
  }

  const requestId = nextRootRequestId + 1
  nextRootRequestId = requestId
  inflight.clear()

  if (force || current.cwd !== cwd) {
    clearProjectDirCache(cwd)
  }

  $projectTree.set({
    collapseNonce: current.collapseNonce,
    cwd,
    data: [],
    loaded: false,
    openState: current.cwd === cwd ? current.openState : {},
    requestId,
    resolvedCwd: '',
    revealNonce: current.cwd === cwd ? current.revealNonce : 0,
    revealSelection: null,
    rootError: null,
    rootLoading: true
  })

  let resolvedCwd = cwd
  let { entries, error } = await readProjectDir(cwd, cwd)

  if (error) {
    const fallback = await fallbackRootFor(cwd)

    if (fallback) {
      const retry = await readProjectDir(fallback, fallback)

      if (!retry.error) {
        resolvedCwd = fallback
        entries = retry.entries
        error = undefined
      }
    }
  }

  setProjectTree(latest => {
    if (latest.cwd !== cwd || latest.requestId !== requestId) {
      return latest
    }

    return {
      ...latest,
      data: error ? [] : entries.map(e => makeNode(e.path, e.name, e.isDirectory)),
      loaded: true,
      resolvedCwd,
      rootError: error || null,
      rootLoading: false
    }
  })
}

export function resetProjectTreeState() {
  lastConnectionKey = ''
  clearProjectTree()
  clearProjectDirCache()
}

/** Module-level lazy child load, keyed off the atom's current cwd so it can be
 *  driven from outside the hook (e.g. revealing a tab's file in the tree). */
async function loadChildrenById(id: string) {
  const cwd = $projectTree.get().cwd

  if (!cwd || inflight.has(id)) {
    return
  }

  inflight.add(id)

  setProjectTree(current => {
    if (current.cwd !== cwd) {
      return current
    }

    return {
      ...current,
      data: patchNode(current.data, id, n => ({ ...n, loading: true, children: [placeholderChild(n.id)] }))
    }
  })

  const rootPath = $projectTree.get().resolvedCwd || cwd
  const { entries, error } = await readProjectDir(id, rootPath)

  inflight.delete(id)

  setProjectTree(current => {
    if (current.cwd !== cwd) {
      return current
    }

    return {
      ...current,
      data: patchNode(current.data, id, n => ({
        ...n,
        loading: false,
        error: error || undefined,
        children: error ? [errorChild(n.id, error)] : entries.map(e => makeNode(e.path, e.name, e.isDirectory))
      }))
    }
  })
}

/** Expand every ancestor folder of `path` and mark it for selection/scroll.
 *  Module-level so the editor tab strip and other surfaces can reveal a file
 *  in the tree, not just the sidebar header button. Resolves against the atom's
 *  current cwd; a no-op when `path` is outside the displayed root. */
export async function revealPathInTree(path: string) {
  const cwd = $projectTree.get().cwd

  if (!cwd || !path) {
    return
  }

  const root = $projectTree.get().resolvedCwd || cwd
  const segments = relativeSegments(root, path)

  if (!segments || segments.length === 0) {
    return
  }

  // Walk the segment chain from the root, loading each directory's children
  // before descending so the lazy tree contains every ancestor by the time we
  // remount. `id`s are matched by name (case-insensitive) to survive the
  // backslash-vs-slash difference between filesystem ids and `file:` URLs.
  let level: TreeNode[] = $projectTree.get().data
  const ancestorIds: string[] = []
  let selectionId: string | null = null

  for (let i = 0; i < segments.length; i += 1) {
    const isLast = i === segments.length - 1
    const seg = segments[i].toLowerCase()
    const node = level.find(n => !n.placeholder && n.name.toLowerCase() === seg)

    if (!node) {
      return
    }

    if (isLast) {
      selectionId = node.id

      break
    }

    ancestorIds.push(node.id)

    if (node.children === undefined && !node.loading) {
      await loadChildrenById(node.id)
    }

    if ($projectTree.get().cwd !== cwd) {
      return
    }

    level = findNode($projectTree.get().data, node.id)?.children ?? []
  }

  if (!selectionId) {
    return
  }

  const id = selectionId

  setProjectTree(current => {
    if (current.cwd !== cwd) {
      return current
    }

    const openState = { ...current.openState }

    for (const ancestorId of ancestorIds) {
      openState[ancestorId] = true
    }

    return {
      ...current,
      openState,
      revealNonce: current.revealNonce + 1,
      revealSelection: id
    }
  })
}

/**
 * Lazy-loads a directory tree rooted at `cwd`. Children are fetched on first
 * expand and cached in this feature-owned atom so unrelated chat rerenders or
 * remounts cannot reset the browser. A placeholder leaf renders so the
 * disclosure caret shows for unloaded folders. `refreshRoot` invalidates the
 * whole tree (used after cwd change or manual refresh).
 */
export function useProjectTree(cwd: string): UseProjectTreeResult {
  const state = useStore($projectTree)
  const connection = useStore($connection)
  const connectionKey = `${connection?.mode || 'local'}:${connection?.profile || ''}:${connection?.baseUrl || ''}`

  const refreshRoot = useCallback(() => loadRoot(cwd, { force: true }), [cwd])

  const setNodeOpen = useCallback(
    (id: string, open: boolean) => {
      setProjectTree(current => {
        if (current.cwd !== cwd || current.openState[id] === open) {
          return current
        }

        return {
          ...current,
          openState: {
            ...current.openState,
            [id]: open
          }
        }
      })
    },
    [cwd]
  )

  // Clears the recorded open state and bumps the nonce; the tree is keyed on
  // the nonce so it remounts with everything collapsed (loaded children stay
  // cached in `data`, just hidden).
  const collapseAll = useCallback(() => {
    setProjectTree(current => {
      if (current.cwd !== cwd) {
        return current
      }

      return { ...current, collapseNonce: current.collapseNonce + 1, openState: {} }
    })
  }, [cwd])

  const loadChildren = useCallback((id: string) => loadChildrenById(id), [])

  const revealPath = useCallback((path: string) => revealPathInTree(path), [])

  useEffect(() => {
    const connectionChanged = lastConnectionKey !== '' && lastConnectionKey !== connectionKey
    lastConnectionKey = connectionKey

    if (connectionChanged) {
      clearProjectDirCache()
      void loadRoot(cwd, { force: true })

      return
    }

    void loadRoot(cwd)
  }, [connectionKey, cwd])

  // Self-heal: an errored root re-probes every few seconds while the tree is
  // mounted. Each attempt bumps requestId, so a persistent error re-arms the
  // timer; a success clears rootError and stops it.
  useEffect(() => {
    if (!cwd || state.cwd !== cwd || !state.rootError) {
      return
    }

    const timer = window.setTimeout(() => void loadRoot(cwd, { force: true }), ROOT_ERROR_RETRY_MS)

    return () => window.clearTimeout(timer)
  }, [cwd, state.cwd, state.requestId, state.rootError])

  // While showing the fallback root, quietly re-probe the session's real cwd
  // (a worktree re-created, a checkout restored) and switch back when it
  // reappears. The probe never touches state, so there's no flicker.
  const usingFallback = state.cwd === cwd && Boolean(state.resolvedCwd) && state.resolvedCwd !== cwd

  useEffect(() => {
    if (!cwd || !usingFallback) {
      return
    }

    let cancelled = false

    const timer = window.setInterval(() => {
      void readProjectDir(cwd, cwd).then(({ error }) => {
        if (!cancelled && !error) {
          void loadRoot(cwd, { force: true })
        }
      })
    }, ROOT_ERROR_RETRY_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [cwd, usingFallback])

  return useMemo(
    () => ({
      collapseAll,
      collapseNonce: state.cwd === cwd ? state.collapseNonce : 0,
      data: state.cwd === cwd ? state.data : [],
      effectiveCwd: state.cwd === cwd && state.resolvedCwd ? state.resolvedCwd : cwd,
      loadChildren,
      openState: state.cwd === cwd ? state.openState : {},
      refreshRoot,
      revealNonce: state.cwd === cwd ? state.revealNonce : 0,
      revealPath,
      revealSelection: state.cwd === cwd ? state.revealSelection : null,
      rootError: state.cwd === cwd ? state.rootError : null,
      rootLoading: state.cwd === cwd ? state.rootLoading : Boolean(cwd),
      setNodeOpen
    }),
    [
      collapseAll,
      cwd,
      loadChildren,
      refreshRoot,
      revealPath,
      setNodeOpen,
      state.collapseNonce,
      state.cwd,
      state.data,
      state.openState,
      state.resolvedCwd,
      state.revealNonce,
      state.revealSelection,
      state.rootError,
      state.rootLoading
    ]
  )
}
