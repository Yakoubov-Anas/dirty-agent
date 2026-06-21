import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { writeClipboardText } from '@/components/ui/copy-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import type { DbCell, DbQueryResult } from '@/lib/desktop-db'
import { cn } from '@/lib/utils'

// Virtualized, sortable, filterable result grid for query/table output. Only
// visible rows mount, so a large result set stays responsive. Reusable for any
// tabular data.

const ROW_HEIGHT = 26
const COL_MIN_WIDTH = 120
const CELL_PREVIEW_MAX = 80

function formatCell(value: DbCell): string {
  if (value === null) {
    return ''
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  return String(value)
}

type SortDir = 'asc' | 'desc'

function compareCells(a: DbCell, b: DbCell, dir: SortDir): number {
  // NULLs sort last regardless of direction.
  if (a === null && b === null) {return 0}

  if (a === null) {return 1}

  if (b === null) {return -1}

  let result: number

  if (typeof a === 'number' && typeof b === 'number') {
    result = a - b
  } else {
    result = String(a).localeCompare(String(b), undefined, { numeric: true })
  }

  return dir === 'asc' ? result : -result
}

function toCsv(columns: string[], rows: DbCell[][]): string {
  const escape = (value: DbCell) => {
    const text = value === null ? '' : formatCell(value)

    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  const header = columns.map(escape).join(',')
  const body = rows.map(row => row.map(escape).join(',')).join('\n')

  return `${header}\n${body}`
}

function toJson(columns: string[], rows: DbCell[][]): string {
  const objects = rows.map(row => {
    const obj: Record<string, DbCell> = {}
    columns.forEach((col, i) => {
      obj[col] = row[i] ?? null
    })

    return obj
  })

  return JSON.stringify(objects, null, 2)
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface ResultGridProps {
  result: DbQueryResult
  // When provided, cells become editable: double-click a cell to edit, Enter to
  // commit. The callback receives the full source row + the edited column index.
  onCellEdit?: (row: DbCell[], colIndex: number, value: DbCell) => Promise<void> | void
}

export function ResultGrid({ onCellEdit, result }: ResultGridProps) {
  const { t } = useI18n()
  const d = t.database
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ col: number; dir: SortDir } | null>(null)

  // Filter (substring match across all cells) then sort. Both derived, original
  // result untouched.
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    let out = result.rows

    if (q) {
      out = out.filter(row => row.some(cell => formatCell(cell).toLowerCase().includes(q)))
    }

    if (sort) {
      out = [...out].sort((a, b) => compareCells(a[sort.col], b[sort.col], sort.dir))
    }

    return out
  }, [result.rows, filter, sort])

  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => scrollerRef.current,
    initialRect: { height: 400, width: 800 },
    overscan: 12
  })

  const items = virtualizer.getVirtualItems()
  const gridTemplate = `48px repeat(${result.columns.length}, minmax(${COL_MIN_WIDTH}px, 1fr))`

  const toggleSort = (col: number) => {
    setSort(prev => {
      if (!prev || prev.col !== col) {
        return { col, dir: 'asc' }
      }

      return prev.dir === 'asc' ? { col, dir: 'desc' } : null
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Toolbar: filter + export */}
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-(--ui-stroke-tertiary) px-1.5">
        <Codicon className="text-(--ui-text-tertiary)" name="filter" size="0.75rem" />
        <Input
          className="h-5 flex-1 border-0 bg-transparent px-1 text-[0.7rem] shadow-none focus-visible:ring-0"
          onChange={event => setFilter(event.target.value)}
          placeholder={d.filterResults}
          value={filter}
        />
        <span className="shrink-0 px-1 text-[0.66rem] text-(--ui-text-tertiary)">
          {filter ? d.filteredCount(String(rows.length), String(result.rows.length)) : String(result.rows.length)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={d.export}
              className="size-5 rounded text-(--ui-text-tertiary)!"
              size="icon"
              title={d.export}
              type="button"
              variant="ghost"
            >
              <Codicon name="export" size="0.75rem" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => download('result.csv', toCsv(result.columns, rows), 'text/csv')}>
              <Codicon name="export" />
              {d.exportCsv}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => download('result.json', toJson(result.columns, rows), 'application/json')}
            >
              <Codicon name="json" />
              {d.exportJson}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-dt font-mono text-[0.7rem]">
        {/* Header */}
        <div
          className="sticky top-0 z-10 grid border-b border-(--ui-stroke-secondary) bg-(--ui-bg-elevated)/95 text-(--ui-text-tertiary) backdrop-blur"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <div className="border-r border-(--ui-stroke-tertiary) px-2 py-1 text-right">#</div>
          {result.columns.map((column, col) => (
            <button
              className="flex items-center gap-1 truncate border-r border-(--ui-stroke-tertiary) px-2 py-1 text-left font-semibold hover:text-foreground"
              key={column}
              onClick={() => toggleSort(col)}
              title={column}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">{column}</span>
              {sort?.col === col && (
                <Codicon name={sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size="0.7rem" />
              )}
            </button>
          ))}
        </div>

        {/* Rows */}
        <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {items.map(item => {
            const row = rows[item.index]

            return (
              <div
                className={cn(
                  'absolute top-0 left-0 grid w-full',
                  item.index % 2 === 1 && 'bg-(--ui-control-hover-background)/30'
                )}
                key={item.key}
                style={{
                  gridTemplateColumns: gridTemplate,
                  height: `${item.size}px`,
                  transform: `translateY(${item.start}px)`
                }}
              >
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div className="border-r border-(--ui-stroke-tertiary) px-2 py-1 text-right text-(--ui-text-tertiary)/60">
                      {item.index + 1}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => void writeClipboardText(toCsv(result.columns, [row]))}>
                      <Codicon name="copy" />
                      {d.copyRow}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                {row.map((cell, col) => (
                  <GridCell
                    cell={cell}
                    key={col}
                    onEdit={onCellEdit ? value => onCellEdit(row, col, value) : undefined}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function GridCell({ cell, onEdit }: { cell: DbCell; onEdit?: (value: DbCell) => Promise<void> | void }) {
  const { t } = useI18n()
  const text = cell === null ? 'NULL' : formatCell(cell)
  const isLong = text.length > CELL_PREVIEW_MAX
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const startEdit = () => {
    if (!onEdit) {
      return
    }

    setDraft(cell === null ? '' : formatCell(cell))
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)

    // Coerce the input back to a cell value: numeric strings → number, the
    // literal NULL stays a string unless the original was null & left blank.
    const trimmed = draft
    let next: DbCell = trimmed

    if (typeof cell === 'number' && trimmed.trim() !== '' && !Number.isNaN(Number(trimmed))) {
      next = Number(trimmed)
    } else if (cell === null && trimmed === '') {
      next = null
    }

    if (next !== cell) {
      void onEdit?.(next)
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        className="min-w-0 border-r border-(--ui-stroke-tertiary) bg-(--ui-control-active-background) px-2 py-1 text-(--ui-text-primary) outline-none ring-1 ring-(--theme-primary)"
        onBlur={commit}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setEditing(false)
          }
        }}
        value={draft}
      />
    )
  }

  const body = (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          className={cn(
            'truncate border-r border-(--ui-stroke-tertiary) px-2 py-1 text-left',
            cell === null ? 'text-(--ui-text-tertiary)/50 italic' : 'text-(--ui-text-secondary)'
          )}
          onClick={isLong && !onEdit ? () => setOpen(true) : undefined}
          onDoubleClick={onEdit ? startEdit : undefined}
          title={isLong ? undefined : text}
          type="button"
        >
          {text}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void writeClipboardText(cell === null ? '' : formatCell(cell))}>
          <Codicon name="copy" />
          {t.database.copyCell}
        </ContextMenuItem>
        {onEdit && (
          <ContextMenuItem onSelect={startEdit}>
            <Codicon name="edit" />
            {t.database.editCell}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )

  if (!isLong || onEdit) {
    return body
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>{body}</PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-96 overflow-auto p-2">
        <pre className="font-mono text-[0.7rem] whitespace-pre-wrap break-all text-(--ui-text-secondary)">{text}</pre>
        <Button
          className="mt-2"
          onClick={() => void writeClipboardText(cell === null ? '' : formatCell(cell))}
          size="xs"
          type="button"
          variant="secondary"
        >
          <Codicon name="copy" size="0.75rem" />
          {t.database.copyCell}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
