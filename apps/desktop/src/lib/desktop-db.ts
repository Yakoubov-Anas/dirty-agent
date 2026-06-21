// Database manager bridge for the desktop Database panel. Always routes to the
// Python backend (the DB drivers live there) via the hermes:api IPC bridge —
// there's no local-IPC fast path like desktop-fs has, since SQLite access is
// done in Python (stdlib sqlite3).

export type DbEngine = 'mysql' | 'sqlite'

export interface DbConnection {
  id: string
  engine: string
  name: string
  file?: string
  host?: string
  port?: number
  database?: string
  user?: string
}

// Params for creating/testing a connection. SQLite uses `file`; MySQL uses the
// host/port/database/user/password fields. Passwords are sent once and stored
// server-side in .env — never returned in DbConnection.
export interface DbConnectParams {
  engine: DbEngine
  name?: string
  file?: string
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
}

export interface DbDriverStatus {
  engine: string
  available: boolean
  package: null | string
}

export interface DbColumn {
  name: string
  type: string
  notnull: boolean
  pk: boolean
}

export interface DbTable {
  name: string
  type: string // 'table' | 'view'
  columns: DbColumn[]
}

export interface DbSchema {
  tables: DbTable[]
}

export type DbCell = boolean | null | number | string

export interface DbQueryResult {
  columns: string[]
  rows: DbCell[][]
  rowCount: number
  elapsedMs: number
  truncated?: boolean
  // Present on get_table results: PK columns + whether rows can be edited.
  primaryKey?: string[]
  editable?: boolean
}

function bridge() {
  return window.hermesDesktop
}

export function isDatabaseAvailable(): boolean {
  return Boolean(bridge()?.api)
}

export async function listDbConnections(): Promise<DbConnection[]> {
  const result = await bridge().api<{ connections: DbConnection[] }>({ method: 'GET', path: '/api/db/connections' })

  return result.connections
}

export async function connectDb(params: DbConnectParams): Promise<DbConnection> {
  const result = await bridge().api<{ connection: DbConnection }>({
    body: params,
    method: 'POST',
    path: '/api/db/connect'
  })

  return result.connection
}

export async function testDbConnection(params: DbConnectParams): Promise<void> {
  await bridge().api({ body: params, method: 'POST', path: '/api/db/test' })
}

export async function getDbDriverStatus(engine: DbEngine): Promise<DbDriverStatus> {
  return bridge().api<DbDriverStatus>({ method: 'GET', path: `/api/db/driver?engine=${engine}` })
}

export async function installDbDriver(engine: DbEngine): Promise<{ ok: boolean; package: string }> {
  return bridge().api({ method: 'POST', path: `/api/db/driver/install?engine=${engine}` })
}

export async function removeDbConnection(connectionId: string): Promise<void> {
  await bridge().api({ method: 'DELETE', path: `/api/db/connections/${encodeURIComponent(connectionId)}` })
}

export async function getDbSchema(connectionId: string): Promise<DbSchema> {
  return bridge().api<DbSchema>({
    method: 'GET',
    path: `/api/db/schema?connectionId=${encodeURIComponent(connectionId)}`
  })
}

export async function runDbQuery(connectionId: string, sql: string, limit?: number): Promise<DbQueryResult> {
  return bridge().api<DbQueryResult>({
    body: { connectionId, limit, sql },
    method: 'POST',
    path: '/api/db/query'
  })
}

export async function getDbTable(
  connectionId: string,
  table: string,
  limit = 100,
  offset = 0
): Promise<DbQueryResult> {
  const params = new URLSearchParams({
    connectionId,
    limit: String(limit),
    offset: String(offset),
    table
  })

  return bridge().api<DbQueryResult>({ method: 'GET', path: `/api/db/table?${params.toString()}` })
}

export async function updateDbCell(
  connectionId: string,
  table: string,
  column: string,
  value: DbCell,
  pk: Record<string, DbCell>
): Promise<{ ok: boolean; updated: number }> {
  return bridge().api({
    body: { column, connectionId, pk, table, value },
    method: 'POST',
    path: '/api/db/update-cell'
  })
}

export async function deleteDbRow(
  connectionId: string,
  table: string,
  pk: Record<string, DbCell>
): Promise<{ ok: boolean; deleted: number }> {
  return bridge().api({
    body: { connectionId, pk, table },
    method: 'POST',
    path: '/api/db/delete-row'
  })
}
