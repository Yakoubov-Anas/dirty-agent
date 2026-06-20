import { useStore } from '@nanostores/react'

import { DiffViewer } from '@/components/git/diff-viewer'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Codicon } from '@/components/ui/codicon'
import { Loader } from '@/components/ui/loader'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import type { HermesGitFileEntry } from '@/global'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import {
  $gitAhead,
  $gitBehind,
  $gitBranch,
  $gitCommitMessage,
  $gitCommitting,
  $gitDiffLoading,
  $gitDiffText,
  $gitEntries,
  $gitError,
  $gitLoading,
  $gitNotARepo,
  $gitRepoRoot,
  $gitSelection,
  commitGit,
  refreshGitStatus,
  selectGitFile,
  stageAllGit,
  stageGitPaths,
  unstageAllGit,
  unstageGitPaths
} from '@/store/git'
import { GIT_COMMIT_PANE_ID } from '@/store/layout'
import { $toolWindowSide } from '@/store/tool-windows'

import { SidebarPanelLabel } from '../shell/sidebar-label'

function baseName(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? path
}

function dirName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  parts.pop()

  return parts.join('/')
}

// Single-letter status badge, JetBrains-style: M/A/D/R/U/? colored by kind.
function statusBadge(status: null | string, untracked: boolean): { className: string; letter: string } {
  if (untracked) {
    return { className: 'text-(--ui-text-tertiary)', letter: '?' }
  }

  switch (status) {
    case 'added':
      return { className: 'text-emerald-600 dark:text-emerald-400', letter: 'A' }

    case 'deleted':
      return { className: 'text-rose-600 dark:text-rose-400', letter: 'D' }

    case 'renamed':
      return { className: 'text-sky-600 dark:text-sky-400', letter: 'R' }

    case 'unmerged':
      return { className: 'text-amber-600 dark:text-amber-400', letter: 'U' }

    default:
      return { className: 'text-amber-600 dark:text-amber-400', letter: 'M' }
  }
}

interface GitFileRowProps {
  active: boolean
  checked: boolean
  entry: HermesGitFileEntry
  staged: boolean
  onSelect: () => void
  onToggle: () => void
}

function GitFileRow({ active, checked, entry, staged, onSelect, onToggle }: GitFileRowProps) {
  const status = staged ? entry.stagedStatus : entry.unstagedStatus
  const badge = statusBadge(status, entry.untracked && !staged)
  const dir = dirName(entry.path)

  return (
    <div
      className={cn(
        'group/git-row flex h-6 items-center gap-1.5 rounded-md px-1.5 text-xs select-none',
        active ? 'bg-(--ui-control-active-background) text-foreground' : 'hover:bg-(--ui-control-hover-background)'
      )}
    >
      <Checkbox
        aria-label={entry.path}
        checked={checked}
        className="size-3.5"
        onCheckedChange={() => {
          triggerHaptic('tap')
          onToggle()
        }}
      />
      <button
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={onSelect}
        title={entry.path}
        type="button"
      >
        <span className={cn('w-3 shrink-0 text-center font-mono text-[0.7rem] font-semibold', badge.className)}>
          {badge.letter}
        </span>
        <span className="min-w-0 truncate text-(--ui-text-secondary)">{baseName(entry.path)}</span>
        {dir && <span className="min-w-0 truncate text-[0.68rem] text-(--ui-text-tertiary)/70">{dir}</span>}
      </button>
    </div>
  )
}

export function GitCommitPane() {
  const { t } = useI18n()
  const g = t.git
  const repoRoot = useStore($gitRepoRoot)
  const branch = useStore($gitBranch)
  const ahead = useStore($gitAhead)
  const behind = useStore($gitBehind)
  const entries = useStore($gitEntries)
  const loading = useStore($gitLoading)
  const error = useStore($gitError)
  const notARepo = useStore($gitNotARepo)
  const selection = useStore($gitSelection)
  const diffText = useStore($gitDiffText)
  const diffLoading = useStore($gitDiffLoading)
  const message = useStore($gitCommitMessage)
  const committing = useStore($gitCommitting)
  const side = useStore($toolWindowSide(GIT_COMMIT_PANE_ID))

  const staged = entries.filter(entry => entry.staged)
  const unstaged = entries.filter(entry => entry.unstaged || entry.untracked)
  const canCommit = staged.length > 0 && message.trim().length > 0 && !committing

  return (
    <aside
      aria-label={g.aria}
      className={cn(
        'relative flex h-full w-full min-w-0 flex-col overflow-hidden border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) pt-(--pane-header-reserve) text-(--ui-text-tertiary)',
        side === 'left' ? 'border-r' : 'border-l'
      )}
    >
      {/* Header: branch + ahead/behind + refresh */}
      <div className="flex h-8 shrink-0 items-center gap-2 px-2.5">
        <SidebarPanelLabel>{g.title}</SidebarPanelLabel>
        {branch && (
          <span className="flex min-w-0 items-center gap-1 text-[0.68rem] text-(--ui-text-tertiary)">
            <Codicon name="git-branch" size="0.75rem" />
            <span className="truncate">{branch}</span>
            {ahead > 0 && <span title={g.ahead(String(ahead))}>↑{ahead}</span>}
            {behind > 0 && <span title={g.behind(String(behind))}>↓{behind}</span>}
          </span>
        )}
        <Tip label={g.refresh}>
          <Button
            aria-label={g.refresh}
            className="ml-auto size-6 rounded-md text-(--ui-text-secondary)!"
            disabled={loading || !repoRoot}
            onClick={() => {
              triggerHaptic('tap')
              void refreshGitStatus(repoRoot)
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name="refresh" size="0.875rem" />
          </Button>
        </Tip>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 scrollbar-dt">
        {notARepo && <div className="px-2 py-4 text-center text-xs text-(--ui-text-tertiary)">{g.notARepo}</div>}

        {error && !notARepo && (
          <div className="mx-1 my-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[0.7rem] text-destructive">
            {error}
          </div>
        )}

        {!notARepo && !error && entries.length === 0 && !loading && (
          <div className="px-2 py-4 text-center text-xs text-(--ui-text-tertiary)">{g.clean}</div>
        )}

        {staged.length > 0 && (
          <Section
            actionIcon="remove"
            actionLabel={g.unstageAll}
            count={staged.length}
            onAction={() => void unstageAllGit()}
            title={g.stagedChanges}
          >
            {staged.map(entry => (
              <GitFileRow
                active={selection?.path === entry.path && selection.staged}
                checked
                entry={entry}
                key={`staged-${entry.path}`}
                onSelect={() => void selectGitFile({ path: entry.path, staged: true, untracked: false })}
                onToggle={() => void unstageGitPaths([entry.path])}
                staged
              />
            ))}
          </Section>
        )}

        {unstaged.length > 0 && (
          <Section
            actionIcon="add"
            actionLabel={g.stageAll}
            count={unstaged.length}
            onAction={() => void stageAllGit()}
            title={g.changes}
          >
            {unstaged.map(entry => (
              <GitFileRow
                active={selection?.path === entry.path && !selection.staged}
                checked={false}
                entry={entry}
                key={`unstaged-${entry.path}`}
                onSelect={() =>
                  void selectGitFile({ path: entry.path, staged: false, untracked: entry.untracked })
                }
                onToggle={() => void stageGitPaths([entry.path])}
                staged={false}
              />
            ))}
          </Section>
        )}

        {/* Diff preview for the selected file */}
        {selection && (
          <div className="mt-1 px-1">
            {diffLoading ? (
              <div className="grid place-items-center py-6">
                <Loader className="size-6 text-(--ui-text-tertiary)" type="spiral-search" />
              </div>
            ) : diffText ? (
              <DiffViewer diff={diffText} />
            ) : (
              <div className="py-4 text-center text-[0.7rem] text-(--ui-text-tertiary)">{g.noDiff}</div>
            )}
          </div>
        )}
      </div>

      {/* Commit message + button */}
      {!notARepo && (
        <div className="shrink-0 border-t border-(--ui-stroke-tertiary) p-2">
          <Textarea
            className="min-h-16 resize-none text-xs"
            onChange={event => $gitCommitMessage.set(event.target.value)}
            onKeyDown={event => {
              // ⌘/Ctrl+Enter commits.
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canCommit) {
                event.preventDefault()
                triggerHaptic('tap')
                void commitGit()
              }
            }}
            placeholder={g.messagePlaceholder}
            value={message}
          />
          <Button
            className="mt-2 w-full"
            disabled={!canCommit}
            onClick={() => {
              triggerHaptic('tap')
              void commitGit()
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            {committing ? (
              <Loader className="size-3.5" type="spiral-search" />
            ) : (
              <Codicon name="git-commit" size="0.875rem" />
            )}
            {g.commit}
            {staged.length > 0 && <span className="opacity-70">({staged.length})</span>}
          </Button>
        </div>
      )}
    </aside>
  )
}

interface SectionProps {
  actionIcon: string
  actionLabel: string
  children: React.ReactNode
  count: number
  onAction: () => void
  title: string
}

function Section({ actionIcon, actionLabel, children, count, onAction, title }: SectionProps) {
  return (
    <div className="mt-1.5">
      <div className="flex h-6 items-center gap-1.5 px-1.5">
        <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-(--ui-text-tertiary)">
          {title}
        </span>
        <span className="text-[0.62rem] text-(--ui-text-tertiary)/70">{count}</span>
        <Tip label={actionLabel}>
          <Button
            aria-label={actionLabel}
            className="ml-auto size-5 rounded text-(--ui-text-tertiary)!"
            onClick={() => {
              triggerHaptic('tap')
              onAction()
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name={actionIcon} size="0.8rem" />
          </Button>
        </Tip>
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  )
}
