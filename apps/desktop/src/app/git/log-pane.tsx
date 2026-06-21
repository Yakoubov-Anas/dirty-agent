import { useStore } from '@nanostores/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useMemo, useRef } from 'react'

import { DiffViewer } from '@/components/git/diff-viewer'
import { GraphCell } from '@/components/git/graph-cell'
import { GRAPH_ROW_HEIGHT } from '@/components/git/graph-cell'
import { RefChips } from '@/components/git/ref-chip'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { CopyButton } from '@/components/ui/copy-button'
import { Loader } from '@/components/ui/loader'
import type { HermesGitCommitFile, HermesGitLogCommit } from '@/global'
import { useI18n } from '@/i18n'
import { computeGraph, type GraphRow } from '@/lib/git-graph'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { $gitBranch, $gitNotARepo, $gitRepoRoot } from '@/store/git'
import {
  $gitLogCommits,
  $gitLogDetail,
  $gitLogDetailLoading,
  $gitLogDiff,
  $gitLogError,
  $gitLogHasMore,
  $gitLogLoading,
  $gitLogLoadingMore,
  $gitLogSelectedHash,
  clearGitLogSelection,
  loadMoreGitLog,
  refreshGitLog,
  selectGitLogCommit
} from '@/store/git-log'
import { GIT_LOG_PANE_ID } from '@/store/layout'
import { $toolWindowSide } from '@/store/tool-windows'

import { SidebarPanelLabel } from '../shell/sidebar-label'

import { LogBranchTree } from './log-branch-tree'

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })

// Compact relative date for a commit (ISO string → "3d", "2mo", …).
function relativeDate(iso: string): string {
  const then = Date.parse(iso)

  if (Number.isNaN(then)) {
    return ''
  }

  const seconds = Math.round((then - Date.now()) / 1000)
  const abs = Math.abs(seconds)

  if (abs < 60) {
    return RELATIVE.format(Math.round(seconds), 'second')
  }

  if (abs < 3600) {
    return RELATIVE.format(Math.round(seconds / 60), 'minute')
  }

  if (abs < 86400) {
    return RELATIVE.format(Math.round(seconds / 3600), 'hour')
  }

  if (abs < 2592000) {
    return RELATIVE.format(Math.round(seconds / 86400), 'day')
  }

  if (abs < 31536000) {
    return RELATIVE.format(Math.round(seconds / 2592000), 'month')
  }

  return RELATIVE.format(Math.round(seconds / 31536000), 'year')
}

function fileStatusBadge(status: string): { className: string; letter: string } {
  switch (status) {
    case 'A':
      return { className: 'text-emerald-600 dark:text-emerald-400', letter: 'A' }

    case 'D':
      return { className: 'text-rose-600 dark:text-rose-400', letter: 'D' }

    case 'R':
      return { className: 'text-sky-600 dark:text-sky-400', letter: 'R' }

    case 'C':
      return { className: 'text-sky-600 dark:text-sky-400', letter: 'C' }

    default:
      return { className: 'text-amber-600 dark:text-amber-400', letter: 'M' }
  }
}

export function GitLogPane() {
  const { t } = useI18n()
  const g = t.git
  const repoRoot = useStore($gitRepoRoot)
  const notARepo = useStore($gitNotARepo)
  const branch = useStore($gitBranch)
  const commits = useStore($gitLogCommits)
  const loading = useStore($gitLogLoading)
  const loadingMore = useStore($gitLogLoadingMore)
  const error = useStore($gitLogError)
  const hasMore = useStore($gitLogHasMore)
  const selectedHash = useStore($gitLogSelectedHash)
  const side = useStore($toolWindowSide(GIT_LOG_PANE_ID))

  // Compute lane geometry once per commit-list change.
  const graphRows = useMemo(
    () => computeGraph(commits.map(commit => ({ hash: commit.hash, parents: commit.parents }))),
    [commits]
  )

  // Reserve a stable graph column width = the widest lane count on the page.
  const maxGraphWidth = useMemo(() => graphRows.reduce((max, row) => Math.max(max, row.width), 1), [graphRows])

  return (
    <aside
      aria-label={g.logAria}
      className={cn(
        '@container relative flex h-full w-full min-w-0 flex-col overflow-hidden border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) pt-(--pane-header-reserve) text-(--ui-text-tertiary)',
        side === 'left' ? 'border-r' : 'border-l'
      )}
    >
      {/* Header */}
      <div className="flex h-8 shrink-0 items-center gap-2 px-2.5">
        <SidebarPanelLabel>{g.logTitle}</SidebarPanelLabel>
        {branch && (
          <span className="flex min-w-0 items-center gap-1 text-[0.68rem] text-(--ui-text-tertiary)">
            <Codicon name="git-branch" size="0.75rem" />
            <span className="truncate">{branch}</span>
          </span>
        )}
        <Button
          aria-label={g.refresh}
          className="ml-auto size-6 rounded-md text-(--ui-text-secondary)!"
          disabled={loading || !repoRoot}
          onClick={() => {
            triggerHaptic('tap')
            void refreshGitLog()
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Codicon name="refresh" size="0.875rem" />
        </Button>
      </div>

      {notARepo && <div className="px-2 py-4 text-center text-xs text-(--ui-text-tertiary)">{g.notARepo}</div>}

      {error && !notARepo && (
        <div className="mx-1 my-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[0.7rem] text-destructive">
          {error}
        </div>
      )}

      {!notARepo && (
        <div className="flex min-h-0 flex-1">
          {/* Branch tree — only when the pane is wide enough (JetBrains shows it
              in the bottom dock / dragged-wide layout, hides it in a narrow rail). */}
          <div className="hidden @2xl:flex">
            <LogBranchTree />
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {/* Commit list (virtualized) */}
            <div className="flex min-h-0 flex-[2] flex-col">
              {loading && commits.length === 0 ? (
                <div className="grid place-items-center py-8">
                  <Loader className="size-6 text-(--ui-text-tertiary)" type="spiral-search" />
                </div>
              ) : commits.length === 0 ? (
                <div className="px-2 py-4 text-center text-xs text-(--ui-text-tertiary)">{g.noCommits}</div>
              ) : (
                <CommitList
                  commits={commits}
                  graphRows={graphRows}
                  hasMore={hasMore}
                  loadingMore={loadingMore}
                  maxGraphWidth={maxGraphWidth}
                  selectedHash={selectedHash}
                />
              )}
            </div>

            {/* Detail of the selected commit */}
            {selectedHash && (
              <div className="flex min-h-0 flex-[3] flex-col border-t border-(--ui-stroke-tertiary)">
                <CommitDetail />
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}

interface CommitListProps {
  commits: HermesGitLogCommit[]
  graphRows: GraphRow[]
  hasMore: boolean
  loadingMore: boolean
  maxGraphWidth: number
  selectedHash: null | string
}

const OVERSCAN_ROWS = 16

// Virtualized commit list: only rows in (and near) the viewport are mounted, so
// the DOM stays small regardless of history length. Auto-loads the next page
// when scrolling near the bottom.
function CommitList({ commits, graphRows, hasMore, loadingMore, maxGraphWidth, selectedHash }: CommitListProps) {
  const { t } = useI18n()
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const virtualizer = useVirtualizer({
    count: commits.length,
    estimateSize: () => GRAPH_ROW_HEIGHT,
    getItemKey: index => commits[index]?.hash ?? index,
    getScrollElement: () => scrollerRef.current,
    initialRect: { height: 600, width: 320 },
    overscan: OVERSCAN_ROWS
  })

  // Auto-load more when the scroll position nears the bottom.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current

    if (!el || !hasMore || loadingMore) {
      return
    }

    if (el.scrollHeight - el.scrollTop - el.clientHeight < GRAPH_ROW_HEIGHT * OVERSCAN_ROWS) {
      void loadMoreGitLog()
    }
  }, [hasMore, loadingMore])

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div
      className="relative min-h-0 flex-1 overflow-y-auto scrollbar-dt"
      onScroll={onScroll}
      ref={scrollerRef}
    >
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualItems.map(item => {
          const commit = commits[item.index]

          if (!commit) {
            return null
          }

          return (
            <div
              className="absolute top-0 left-0 w-full"
              key={item.key}
              style={{ height: `${item.size}px`, transform: `translateY(${item.start}px)` }}
            >
              <CommitRow
                commit={commit}
                graphRow={graphRows[item.index]}
                maxGraphWidth={maxGraphWidth}
                onSelect={() => void selectGitLogCommit(commit.hash)}
                selected={commit.hash === selectedHash}
              />
            </div>
          )
        })}
      </div>
      {loadingMore && (
        <div className="flex items-center justify-center gap-1.5 py-1.5 text-[0.7rem] text-(--ui-text-tertiary)">
          <Loader className="size-3.5" type="spiral-search" />
          {t.git.loadMore}
        </div>
      )}
    </div>
  )
}

interface CommitRowProps {
  commit: HermesGitLogCommit
  graphRow?: GraphRow
  maxGraphWidth: number
  onSelect: () => void
  selected: boolean
}

function CommitRow({ commit, graphRow, maxGraphWidth, onSelect, selected }: CommitRowProps) {
  return (
    <button
      className={cn(
        'flex h-6 w-full items-center gap-2 pr-2.5 text-left text-xs select-none',
        selected ? 'bg-(--ui-control-active-background) text-foreground' : 'hover:bg-(--ui-control-hover-background)'
      )}
      onClick={onSelect}
      type="button"
    >
      {/* Multi-lane commit graph rail. */}
      {graphRow ? (
        <GraphCell maxWidth={maxGraphWidth} row={graphRow} />
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <RefChips refs={commit.refs} />
      <span className="min-w-0 flex-1 truncate text-(--ui-text-secondary)">{commit.subject}</span>
      <span className="hidden shrink-0 text-[0.66rem] text-(--ui-text-tertiary)/70 @[16rem]:inline">
        {commit.author}
      </span>
      <span className="shrink-0 text-[0.66rem] text-(--ui-text-tertiary)/70">{relativeDate(commit.date)}</span>
      <span className="shrink-0 font-mono text-[0.62rem] text-(--ui-text-tertiary)/60">{commit.hash.slice(0, 7)}</span>
    </button>
  )
}

function CommitDetail() {
  const { t } = useI18n()
  const g = t.git
  const detail = useStore($gitLogDetail)
  const loading = useStore($gitLogDetailLoading)
  const diff = useStore($gitLogDiff)

  if (loading) {
    return (
      <div className="grid flex-1 place-items-center">
        <Loader className="size-6 text-(--ui-text-tertiary)" type="spiral-search" />
      </div>
    )
  }

  if (!detail) {
    return null
  }

  const fullDate = (() => {
    const parsed = Date.parse(detail.authorDate)

    return Number.isNaN(parsed) ? detail.authorDate : new Date(parsed).toLocaleString()
  })()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-dt">
      {/* Metadata */}
      <div className="shrink-0 border-b border-(--ui-stroke-tertiary) px-3 py-2">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-xs font-medium text-foreground">{detail.subject}</p>
          <CopyButton appearance="icon" className="size-5 shrink-0" text={detail.hash} />
          <Button
            aria-label={t.common.close}
            className="size-5 shrink-0 rounded text-(--ui-text-tertiary)!"
            onClick={() => clearGitLogSelection()}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name="close" size="0.8rem" />
          </Button>
        </div>
        {detail.body && (
          <pre className="mt-1.5 font-sans text-[0.7rem] whitespace-pre-wrap text-(--ui-text-secondary)">
            {detail.body}
          </pre>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.66rem] text-(--ui-text-tertiary)">
          <span>{detail.author}</span>
          <span className="truncate">{detail.email}</span>
          <span>{fullDate}</span>
          <span className="font-mono">{detail.hash.slice(0, 10)}</span>
        </div>
      </div>

      {/* Changed files */}
      {detail.files.length > 0 && (
        <div className="shrink-0 border-b border-(--ui-stroke-tertiary) py-1">
          <div className="px-3 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-(--ui-text-tertiary)">
            {g.changedFiles(String(detail.files.length))}
          </div>
          {detail.files.map(file => (
            <CommitFileRow file={file} key={file.path} />
          ))}
        </div>
      )}

      {/* Full diff */}
      <div className="min-h-0 flex-1 p-2">
        <DiffViewer defaultCollapsed diff={diff} />
      </div>
    </div>
  )
}

function CommitFileRow({ file }: { file: HermesGitCommitFile }) {
  const badge = fileStatusBadge(file.status)
  const name = file.path.split(/[\\/]+/).filter(Boolean).pop() ?? file.path

  return (
    <div className="flex items-center gap-1.5 px-3 py-0.5 text-xs">
      <span className={cn('w-3 shrink-0 text-center font-mono text-[0.7rem] font-semibold', badge.className)}>
        {badge.letter}
      </span>
      <span className="min-w-0 truncate text-(--ui-text-secondary)" title={file.path}>
        {name}
      </span>
    </div>
  )
}
