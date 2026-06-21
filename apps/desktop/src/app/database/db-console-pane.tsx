import { type PointerEvent as ReactPointerEvent, useCallback, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { CodeEditor } from '@/components/ui/code-editor'
import { Codicon } from '@/components/ui/codicon'
import { Loader } from '@/components/ui/loader'
import { useI18n } from '@/i18n'
import type { DbQueryResult } from '@/lib/desktop-db'
import { runDbQuery } from '@/lib/desktop-db'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { describeDbError } from '@/store/database'

import { ResultGrid } from './result-grid'

interface ConsoleResult {
  id: string
  title: string
  sql: string
  running: boolean
  result: DbQueryResult | null
  error: null | string
}

let resultSeq = 0

function titleForSql(sql: string): string {
  const compact = sql.replace(/\s+/g, ' ').trim()

  return compact.length > 32 ? `${compact.slice(0, 32)}…` : compact || 'Query'
}

// A self-contained SQL console for one connection, opened as a preview-rail
// tab. Owns its query text + result sub-tabs (each run gets its own).
export function DbConsolePane({ connectionId }: { connectionId: string }) {
  const { t } = useI18n()
  const d = t.database
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ConsoleResult[]>([])
  const [activeResultId, setActiveResultId] = useState<null | string>(null)
  // Resizable editor height (px). Drag the divider below the run bar.
  const [editorHeight, setEditorHeight] = useState(160)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    const startY = event.clientY
    const startHeight = editorHeight
    const containerHeight = containerRef.current?.getBoundingClientRect().height ?? 600
    const restoreCursor = document.body.style.cursor
    const restoreSelect = document.body.style.userSelect

    handle.setPointerCapture?.(event.pointerId)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (e: PointerEvent) => {
      const next = startHeight + (e.clientY - startY)
      // Keep both panes usable: min 80px editor, leave ≥120px for results.
      setEditorHeight(Math.max(80, Math.min(containerHeight - 120, next)))
    }

    const cleanup = () => {
      document.body.style.cursor = restoreCursor
      document.body.style.userSelect = restoreSelect
      handle.releasePointerCapture?.(event.pointerId)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', cleanup, true)
      window.removeEventListener('pointercancel', cleanup, true)
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', cleanup, true)
    window.addEventListener('pointercancel', cleanup, true)
  }, [editorHeight])

  const active = results.find(r => r.id === activeResultId) ?? null

  const run = (sql?: string) => {
    const statement = (sql ?? query).trim()

    if (!statement) {
      return
    }

    const id = `cr-${(resultSeq += 1)}`
    setResults(prev => [
      ...prev,
      { error: null, id, result: null, running: true, sql: statement, title: titleForSql(statement) }
    ])
    setActiveResultId(id)

    runDbQuery(connectionId, statement)
      .then(result => {
        setResults(prev => prev.map(r => (r.id === id ? { ...r, result, running: false } : r)))
      })
      .catch(error => {
        setResults(prev => prev.map(r => (r.id === id ? { ...r, error: describeDbError(error), running: false } : r)))
      })
  }

  const closeResult = (id: string) => {
    setResults(prev => {
      const index = prev.findIndex(r => r.id === id)
      const next = prev.filter(r => r.id !== id)

      if (activeResultId === id) {
        setActiveResultId(next[Math.max(0, index - 1)]?.id ?? null)
      }

      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--ui-sidebar-surface-background)" ref={containerRef}>
      {/* SQL editor (resizable height) */}
      <div className="relative shrink-0 border-b border-(--ui-stroke-tertiary)" style={{ height: editorHeight }}>
        <div className="min-h-0 flex-1 overflow-hidden" style={{ height: 'calc(100% - 2.25rem)' }}>
          <CodeEditor
            className="h-full text-xs"
            language="sql"
            onChange={setQuery}
            onRun={sql => {
              triggerHaptic('tap')
              run(sql || undefined)
            }}
            value={query}
          />
        </div>
        <div className="flex h-9 items-center gap-2 border-t border-(--ui-stroke-tertiary) px-2">
          <Button
            disabled={!query.trim()}
            onClick={() => {
              triggerHaptic('tap')
              run()
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Codicon name="play" size="0.875rem" />
            {d.run}
          </Button>
          <span className="text-[0.64rem] text-(--ui-text-tertiary)/70">{d.runShortcut}</span>
        </div>
        {/* Drag the bottom edge to resize the editor vs results. */}
        <div
          aria-orientation="horizontal"
          className="group absolute inset-x-0 -bottom-1 z-10 h-2 cursor-row-resize"
          onPointerDown={startResize}
          role="separator"
          tabIndex={0}
        >
          <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-(--ui-sash-hover-border) opacity-0 transition-opacity duration-100 group-hover:opacity-100" />
        </div>
      </div>

      {/* Result sub-tabs + active result */}
      {results.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-3 text-center text-xs text-(--ui-text-tertiary)/70">
          {d.runHint}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b border-(--ui-stroke-tertiary) px-1.5 scrollbar-none">
            {results.map(res => (
              <div
                className={cn(
                  'group/res-tab flex h-5 shrink-0 items-center gap-1 rounded pl-2 pr-1 text-[0.68rem] select-none',
                  res.id === activeResultId
                    ? 'bg-(--ui-control-active-background) text-foreground'
                    : 'text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background)'
                )}
                key={res.id}
                onAuxClick={event => {
                  if (event.button === 1) {
                    event.preventDefault()
                    closeResult(res.id)
                  }
                }}
              >
                <button
                  className="max-w-40 truncate"
                  onClick={() => setActiveResultId(res.id)}
                  title={res.sql}
                  type="button"
                >
                  {res.running ? '· ' : ''}
                  {res.title}
                </button>
                <Button
                  aria-label={t.common.close}
                  className="size-3.5 rounded text-(--ui-text-tertiary)! opacity-0 group-hover/res-tab:opacity-100"
                  onClick={() => closeResult(res.id)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Codicon name="close" size="0.7rem" />
                </Button>
              </div>
            ))}
          </div>

          {active && (
            <div className="flex min-h-0 flex-1 flex-col">
              {active.running ? (
                <div className="grid flex-1 place-items-center">
                  <Loader className="size-6 text-(--ui-text-tertiary)" type="spiral-search" />
                </div>
              ) : active.error ? (
                <div className="m-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 font-mono text-[0.7rem] text-destructive">
                  {active.error}
                </div>
              ) : active.result ? (
                <>
                  <div className="flex h-6 shrink-0 items-center gap-2 border-b border-(--ui-stroke-tertiary) px-2 text-[0.66rem] text-(--ui-text-tertiary)">
                    {d.rowsInfo(String(active.result.rowCount), String(active.result.elapsedMs))}
                    {active.result.truncated ? ` · ${d.truncated}` : ''}
                  </div>
                  {active.result.columns.length > 0 ? (
                    <ResultGrid result={active.result} />
                  ) : (
                    <div className="px-3 py-4 text-center text-xs text-(--ui-text-tertiary)">
                      {d.statementOk(String(active.result.rowCount))}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
