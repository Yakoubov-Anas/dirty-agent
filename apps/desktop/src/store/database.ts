import { atom } from 'nanostores'

import {
  connectDb,
  type DbConnection,
  type DbConnectParams,
  type DbSchema,
  getDbSchema,
  listDbConnections,
  removeDbConnection
} from '@/lib/desktop-db'

import { $rightRailActiveTabId, type RightRailTabId, selectRightRailTab } from './layout'

// ─── Connections + per-connection schema (the tree) ───────────────────────────

export const $dbConnections = atom<DbConnection[]>([])
export const $dbActiveConnectionId = atom<null | string>(null)
export const $dbError = atom<null | string>(null)

// Schemas are cached per connection; the tree lazy-loads on expand.
export const $dbSchemas = atom<Record<string, DbSchema>>({})
export const $dbSchemaLoading = atom<Record<string, boolean>>({})
export const $dbExpandedConnections = atom<Set<string>>(new Set())

// FastAPI returns errors as `<status>: {"detail": "..."}`; surface just the
// human message when we can.
export function describeDbError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const match = /^\d+:\s*(\{.*\})$/.exec(raw)

  if (match) {
    try {
      const parsed = JSON.parse(match[1]) as { detail?: unknown }

      if (typeof parsed.detail === 'string') {
        return parsed.detail
      }
    } catch {
      // fall through
    }
  }

  return raw
}

export async function refreshDbConnections() {
  try {
    const connections = await listDbConnections()
    $dbConnections.set(connections)

    const active = $dbActiveConnectionId.get()

    if (active && !connections.some(c => c.id === active)) {
      $dbActiveConnectionId.set(connections[0]?.id ?? null)
    } else if (!active && connections.length > 0) {
      $dbActiveConnectionId.set(connections[0].id)
    }
  } catch (error) {
    $dbError.set(describeDbError(error))
  }
}

export async function addDbConnection(params: DbConnectParams): Promise<boolean> {
  $dbError.set(null)

  try {
    const connection = await connectDb(params)
    await refreshDbConnections()
    $dbActiveConnectionId.set(connection.id)
    expandDbConnection(connection.id)

    return true
  } catch (error) {
    $dbError.set(describeDbError(error))

    return false
  }
}

export async function deleteDbConnection(connectionId: string) {
  try {
    await removeDbConnection(connectionId)

    // Close any rail tabs belonging to this connection.
    for (const tab of $dbRailTabs.get()) {
      if (tab.connectionId === connectionId) {
        closeDbRailTab(tab.id)
      }
    }

    await refreshDbConnections()
  } catch (error) {
    $dbError.set(describeDbError(error))
  }
}

export function setDbActiveConnection(connectionId: string) {
  $dbActiveConnectionId.set(connectionId)
}

const schemaTokens = new Map<string, number>()

export async function loadDbSchema(connectionId: string, force = false) {
  if (!force && $dbSchemas.get()[connectionId]) {
    return
  }

  const token = (schemaTokens.get(connectionId) ?? 0) + 1
  schemaTokens.set(connectionId, token)
  $dbSchemaLoading.set({ ...$dbSchemaLoading.get(), [connectionId]: true })

  try {
    const schema = await getDbSchema(connectionId)

    if (schemaTokens.get(connectionId) === token) {
      $dbSchemas.set({ ...$dbSchemas.get(), [connectionId]: schema })
    }
  } catch (error) {
    if (schemaTokens.get(connectionId) === token) {
      $dbError.set(describeDbError(error))
    }
  } finally {
    if (schemaTokens.get(connectionId) === token) {
      $dbSchemaLoading.set({ ...$dbSchemaLoading.get(), [connectionId]: false })
    }
  }
}

export function expandDbConnection(connectionId: string) {
  const next = new Set($dbExpandedConnections.get())
  next.add(connectionId)
  $dbExpandedConnections.set(next)
  void loadDbSchema(connectionId)
}

export function toggleDbConnectionExpanded(connectionId: string) {
  const current = $dbExpandedConnections.get()

  if (current.has(connectionId)) {
    const next = new Set(current)
    next.delete(connectionId)
    $dbExpandedConnections.set(next)
  } else {
    expandDbConnection(connectionId)
  }
}

// ─── Rail tabs (data grids + SQL consoles open in the preview rail) ────────────

export type DbRailKind = 'console' | 'table'

export interface DbRailTab {
  id: RightRailTabId & `db:${string}`
  kind: DbRailKind
  connectionId: string
  // For table tabs: the table name. For console tabs: a display index.
  table?: string
  title: string
}

export const $dbRailTabs = atom<DbRailTab[]>([])

let consoleSeq = 0

function connectionName(connectionId: string): string {
  return $dbConnections.get().find(c => c.id === connectionId)?.name ?? 'db'
}

// Open (or focus) a table's data grid in the rail.
export function openDbTableTab(connectionId: string, table: string) {
  const id = `db:table:${connectionId}:${table}` as DbRailTab['id']
  const existing = $dbRailTabs.get().find(tab => tab.id === id)

  if (!existing) {
    $dbRailTabs.set([...$dbRailTabs.get(), { connectionId, id, kind: 'table', table, title: table }])
  }

  selectRightRailTab(id)
}

// Open a new SQL console for a connection (always a fresh tab).
export function openDbConsoleTab(connectionId: string) {
  consoleSeq += 1
  const id = `db:console:${connectionId}:${consoleSeq}` as DbRailTab['id']
  const title = `${connectionName(connectionId)} · SQL`
  $dbRailTabs.set([...$dbRailTabs.get(), { connectionId, id, kind: 'console', title }])
  selectRightRailTab(id)
}

export function closeDbRailTab(id: string) {
  const tabs = $dbRailTabs.get()
  const index = tabs.findIndex(tab => tab.id === id)

  if (index === -1) {
    return
  }

  const next = tabs.filter(tab => tab.id !== id)
  $dbRailTabs.set(next)

  // If the closed tab was active, fall back to a neighbouring db tab (the rail
  // itself reselects across all tab kinds when this returns null).
  if ($rightRailActiveTabId.get() === id) {
    const fallback = next[Math.max(0, index - 1)]
    selectRightRailTab(fallback ? fallback.id : 'preview')
  }
}

export function getDbRailTab(id: string): DbRailTab | undefined {
  return $dbRailTabs.get().find(tab => tab.id === id)
}
