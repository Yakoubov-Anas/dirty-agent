import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Loader } from '@/components/ui/loader'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { DbConnection, DbTable } from '@/lib/desktop-db'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import {
  $dbActiveConnectionId,
  $dbConnections,
  $dbError,
  $dbExpandedConnections,
  $dbSchemaLoading,
  $dbSchemas,
  deleteDbConnection,
  loadDbSchema,
  openDbConsoleTab,
  openDbTableTab,
  refreshDbConnections,
  setDbActiveConnection,
  toggleDbConnectionExpanded
} from '@/store/database'
import { DATABASE_PANE_ID } from '@/store/layout'
import { $toolWindowSide } from '@/store/tool-windows'

import { SidebarPanelLabel } from '../shell/sidebar-label'

import { ConnectionDialog } from './connection-dialog'

export function DatabasePane() {
  const { t } = useI18n()
  const d = t.database
  const connections = useStore($dbConnections)
  const activeId = useStore($dbActiveConnectionId)
  const error = useStore($dbError)
  const side = useStore($toolWindowSide(DATABASE_PANE_ID))
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    void refreshDbConnections()
  }, [])

  const addConnection = () => setDialogOpen(true)

  return (
    <>
    <aside
      aria-label={d.aria}
      className={cn(
        'relative flex h-full w-full min-w-0 flex-col overflow-hidden border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) pt-(--pane-header-reserve) text-(--ui-text-tertiary)',
        side === 'left' ? 'border-r' : 'border-l'
      )}
    >
      {/* Header toolbar */}
      <div className="flex h-8 shrink-0 items-center gap-1 px-2.5">
        <SidebarPanelLabel>{d.title}</SidebarPanelLabel>
        <div className="ml-auto flex items-center gap-0.5">
          <Tip label={d.newConsole}>
            <Button
              aria-label={d.newConsole}
              className="size-6 rounded-md text-(--ui-text-secondary)!"
              disabled={!activeId}
              onClick={() => {
                triggerHaptic('tap')

                if (activeId) {
                  openDbConsoleTab(activeId)
                }
              }}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Codicon name="terminal" size="0.875rem" />
            </Button>
          </Tip>
          <Tip label={d.addConnection}>
            <Button
              aria-label={d.addConnection}
              className="size-6 rounded-md text-(--ui-text-secondary)!"
              onClick={() => {
                triggerHaptic('tap')
                addConnection()
              }}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Codicon name="add" size="0.875rem" />
            </Button>
          </Tip>
          <Tip label={d.refreshSchema}>
            <Button
              aria-label={d.refreshSchema}
              className="size-6 rounded-md text-(--ui-text-secondary)!"
              onClick={() => {
                triggerHaptic('tap')
                void refreshDbConnections()

                if (activeId) {
                  void loadDbSchema(activeId, true)
                }
              }}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Codicon name="refresh" size="0.875rem" />
            </Button>
          </Tip>
        </div>
      </div>

      {error && (
        <div className="mx-1 my-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[0.7rem] text-destructive">
          {error}
        </div>
      )}

      {/* Connection tree */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-dt">
        {connections.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <Codicon className="text-(--ui-text-tertiary)/60" name="database" size="1.5rem" />
            <p className="text-xs text-(--ui-text-tertiary)">{d.empty}</p>
            <Button onClick={() => addConnection()} size="sm" type="button" variant="secondary">
              <Codicon name="add" size="0.875rem" />
              {d.addConnection}
            </Button>
          </div>
        ) : (
          connections.map(conn => (
            <ConnectionNode active={conn.id === activeId} connection={conn} key={conn.id} />
          ))
        )}
      </div>
    </aside>
    <ConnectionDialog onClose={() => setDialogOpen(false)} open={dialogOpen} />
    </>
  )
}

function ConnectionNode({ active, connection }: { active: boolean; connection: DbConnection }) {
  const { t } = useI18n()
  const expanded = useStore($dbExpandedConnections)
  const schemas = useStore($dbSchemas)
  const loadingMap = useStore($dbSchemaLoading)
  const isOpen = expanded.has(connection.id)
  const schema = schemas[connection.id]
  const loading = loadingMap[connection.id]

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            className={cn(
              'flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-(--ui-control-hover-background)',
              active && 'text-foreground'
            )}
            onClick={() => {
              triggerHaptic('tap')
              setDbActiveConnection(connection.id)
              toggleDbConnectionExpanded(connection.id)
            }}
            title={connection.file ?? connection.name}
            type="button"
          >
            <Codicon
              className="text-(--ui-text-tertiary)"
              name={isOpen ? 'chevron-down' : 'chevron-right'}
              size="0.7rem"
            />
            <Codicon className="text-(--theme-primary)" name="database" size="0.8rem" />
            <span className="min-w-0 flex-1 truncate text-(--ui-text-secondary)">{connection.name}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => openDbConsoleTab(connection.id)}>
            <Codicon name="terminal" />
            {t.database.newConsole}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void loadDbSchema(connection.id, true)}>
            <Codicon name="refresh" />
            {t.database.refreshSchema}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void deleteDbConnection(connection.id)} variant="destructive">
            <Codicon name="trash" />
            {t.database.removeConnection}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isOpen && (
        <div className="pl-3">
          {loading && !schema ? (
            <div className="px-3 py-2">
              <Loader className="size-4 text-(--ui-text-tertiary)" type="spiral-search" />
            </div>
          ) : schema && schema.tables.length > 0 ? (
            schema.tables.map(table => (
              <TableNode connectionId={connection.id} key={table.name} table={table} />
            ))
          ) : (
            <div className="px-3 py-1 text-[0.7rem] text-(--ui-text-tertiary)/70">{t.database.noTables}</div>
          )}
        </div>
      )}
    </div>
  )
}

function TableNode({ connectionId, table }: { connectionId: string; table: DbTable }) {
  const { t } = useI18n()

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          className="flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-xs hover:bg-(--ui-control-hover-background)"
          onDoubleClick={() => {
            triggerHaptic('tap')
            openDbTableTab(connectionId, table.name)
          }}
          title={t.database.openTable(table.name)}
          type="button"
        >
          <Codicon
            className="text-(--ui-text-tertiary)"
            name={table.type === 'view' ? 'eye' : 'table'}
            size="0.8rem"
          />
          <span className="min-w-0 flex-1 truncate text-(--ui-text-secondary)">{table.name}</span>
          <span className="shrink-0 text-[0.6rem] text-(--ui-text-tertiary)/60">{table.columns.length}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => openDbTableTab(connectionId, table.name)}>
          <Codicon name="table" />
          {t.database.openData}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
