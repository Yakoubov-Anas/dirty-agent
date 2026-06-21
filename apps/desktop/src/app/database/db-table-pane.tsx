import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Loader } from '@/components/ui/loader'
import { useI18n } from '@/i18n'
import type { DbCell, DbQueryResult } from '@/lib/desktop-db'
import { getDbTable, updateDbCell } from '@/lib/desktop-db'
import { triggerHaptic } from '@/lib/haptics'
import { describeDbError } from '@/store/database'
import { notifyError } from '@/store/notifications'

import { ResultGrid } from './result-grid'

const PAGE_SIZE = 100

// A single table's data, opened as a preview-rail tab. Browse with pagination;
// (inline editing comes in a later pass).
export function DbTablePane({ connectionId, table }: { connectionId: string; table: string }) {
  const { t } = useI18n()
  const d = t.database
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState<DbQueryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<null | string>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    getDbTable(connectionId, table, PAGE_SIZE, offset)
      .then(res => {
        if (!cancelled) {
          setResult(res)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(describeDbError(err))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [connectionId, table, offset])

  const rowCount = result?.rowCount ?? 0
  const hasNext = rowCount === PAGE_SIZE
  const hasPrev = offset > 0
  const rangeStart = rowCount === 0 ? 0 : offset + 1
  const rangeEnd = offset + rowCount

  // Edit a cell: build the row's primary-key map, send the update, then patch
  // the local result optimistically (re-fetch on error to resync).
  const editCell = async (row: DbCell[], colIndex: number, value: DbCell) => {
    if (!result?.editable || !result.primaryKey?.length) {
      return
    }

    const pk: Record<string, DbCell> = {}

    for (const keyCol of result.primaryKey) {
      const idx = result.columns.indexOf(keyCol)

      if (idx === -1) {
        return
      }

      pk[keyCol] = row[idx]
    }

    const column = result.columns[colIndex]

    try {
      await updateDbCell(connectionId, table, column, value, pk)
      // Patch the matching row in place.
      setResult(prev =>
        prev
          ? {
              ...prev,
              rows: prev.rows.map(r => (r === row ? r.map((c, i) => (i === colIndex ? value : c)) : r))
            }
          : prev
      )
    } catch (err) {
      notifyError(err, describeDbError(err))
    }
  }

  const canEdit = Boolean(result?.editable)

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--ui-sidebar-surface-background)">
      {/* Toolbar */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-(--ui-stroke-tertiary) px-2 text-[0.7rem] text-(--ui-text-tertiary)">
        <Codicon name="table" size="0.8rem" />
        <span className="min-w-0 truncate font-medium text-(--ui-text-secondary)">{table}</span>
        <div className="ml-auto flex items-center gap-1">
          <span className="tabular-nums">{d.rowRange(String(rangeStart), String(rangeEnd))}</span>
          <Button
            aria-label={d.prevPage}
            className="size-5 rounded text-(--ui-text-tertiary)!"
            disabled={!hasPrev || loading}
            onClick={() => {
              triggerHaptic('tap')
              setOffset(Math.max(0, offset - PAGE_SIZE))
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name="chevron-left" size="0.8rem" />
          </Button>
          <Button
            aria-label={d.nextPage}
            className="size-5 rounded text-(--ui-text-tertiary)!"
            disabled={!hasNext || loading}
            onClick={() => {
              triggerHaptic('tap')
              setOffset(offset + PAGE_SIZE)
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name="chevron-right" size="0.8rem" />
          </Button>
          <Button
            aria-label={d.refreshSchema}
            className="size-5 rounded text-(--ui-text-tertiary)!"
            disabled={loading}
            onClick={() => {
              triggerHaptic('tap')
              // Re-fetch the current page.
              setOffset(o => o)
              setLoading(true)
              getDbTable(connectionId, table, PAGE_SIZE, offset)
                .then(setResult)
                .catch(err => setError(describeDbError(err)))
                .finally(() => setLoading(false))
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name="refresh" size="0.8rem" />
          </Button>
        </div>
      </div>

      {loading && !result ? (
        <div className="grid flex-1 place-items-center">
          <Loader className="size-6 text-(--ui-text-tertiary)" type="spiral-search" />
        </div>
      ) : error ? (
        <div className="m-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 font-mono text-[0.7rem] text-destructive">
          {error}
        </div>
      ) : result ? (
        <ResultGrid onCellEdit={canEdit ? editCell : undefined} result={result} />
      ) : null}
    </div>
  )
}
