import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { HermesGitBranch } from '@/global'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import {
  $gitAhead,
  $gitBehind,
  $gitBranch,
  $gitBranchesLoading,
  $gitBusy,
  $gitLocalBranches,
  $gitRemoteBranches,
  $gitRepoRoot,
  checkoutGitBranch,
  createGitBranch,
  deleteGitBranch,
  mergeGitBranch,
  pullGit,
  pushGit,
  rebaseOntoGitBranch,
  refreshGitBranches,
  renameGitBranch,
  showGitCompare,
  showGitDiffWithWorkingTree
} from '@/store/git'
import { GIT_COMMIT_PANE_ID } from '@/store/layout'
import { setPaneOpen } from '@/store/panes'

// JetBrains-style VCS widget for the top header bar: shows the current branch
// with ahead/behind indicators and opens a branches/actions dropdown. Renders
// nothing outside a git repo.
export function BranchWidget() {
  const { t } = useI18n()
  const branch = useStore($gitBranch)
  const repoRoot = useStore($gitRepoRoot)
  const ahead = useStore($gitAhead)
  const behind = useStore($gitBehind)
  const [open, setOpen] = useState(false)

  if (!repoRoot || !branch) {
    return null
  }

  return (
    <Popover
      onOpenChange={next => {
        setOpen(next)

        if (next) {
          void refreshGitBranches()
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <button
          className={cn(
            'pointer-events-auto flex h-(--titlebar-control-height) items-center gap-1.5 rounded-md px-2',
            'text-xs text-(--ui-text-secondary) select-none [-webkit-app-region:no-drag]',
            'hover:bg-(--ui-control-hover-background) hover:text-foreground',
            open && 'bg-(--ui-control-active-background) text-foreground'
          )}
          onPointerDown={event => event.stopPropagation()}
          title={t.git.branchWidgetTitle}
          type="button"
        >
          <Codicon name="git-branch" size="0.875rem" />
          <span className="max-w-48 truncate">{branch}</span>
          {ahead > 0 && (
            <span
              className="flex items-center text-[0.68rem] text-(--ui-text-tertiary)"
              title={t.git.ahead(String(ahead))}
            >
              <Codicon name="arrow-up" size="0.7rem" />
              {ahead}
            </span>
          )}
          {behind > 0 && (
            <span
              className="flex items-center text-[0.68rem] text-(--ui-text-tertiary)"
              title={t.git.behind(String(behind))}
            >
              <Codicon name="arrow-down" size="0.7rem" />
              {behind}
            </span>
          )}
          <Codicon className="ml-0.5 opacity-70" name="chevron-down" size="0.7rem" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <BranchMenu currentBranch={branch} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

function BranchMenu({ currentBranch, onClose }: { currentBranch: string; onClose: () => void }) {
  const { t } = useI18n()
  const g = t.git
  const localBranches = useStore($gitLocalBranches)
  const remoteBranches = useStore($gitRemoteBranches)
  const loading = useStore($gitBranchesLoading)
  const busy = useStore($gitBusy)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  // Branch pending deletion (confirm dialog), null when none.
  const [pendingDelete, setPendingDelete] = useState<null | string>(null)

  const q = query.trim().toLowerCase()

  const filterBranches = (list: HermesGitBranch[]) =>
    q ? list.filter(b => b.name.toLowerCase().includes(q)) : list

  const filteredLocal = filterBranches(localBranches)
  const filteredRemote = filterBranches(remoteBranches)
  // "Recent" = the top few local branches by commit date (store-sorted).
  const recent = filteredLocal.slice(0, 3)

  const submitNewBranch = async () => {
    const name = newName.trim()

    if (!name) {
      return
    }

    triggerHaptic('tap')
    const ok = await createGitBranch(name)

    if (ok) {
      setCreating(false)
      setNewName('')
      onClose()
    }
  }

  return (
    <div className="flex max-h-[28rem] flex-col">
      {/* Search */}
      <div className="flex items-center gap-2 border-b border-(--ui-stroke-tertiary) px-2.5 py-2">
        <Codicon className="text-(--ui-text-tertiary)" name="search" size="0.875rem" />
        <input
          autoFocus
          className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-(--ui-text-tertiary)"
          onChange={event => setQuery(event.target.value)}
          placeholder={g.searchPlaceholder}
          value={query}
        />
        {busy && <Loader className="size-3.5 text-(--ui-text-tertiary)" type="spiral-search" />}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 scrollbar-dt">
        {/* Actions */}
        {!q && (
          <>
            <MenuRow
              icon="arrow-down"
              label={g.updateProject}
              onSelect={async () => {
                triggerHaptic('tap')
                await pullGit()
                onClose()
              }}
            />
            <MenuRow
              icon="git-commit"
              label={g.commit}
              onSelect={() => {
                triggerHaptic('tap')
                setPaneOpen(GIT_COMMIT_PANE_ID, true)
                onClose()
              }}
            />
            <MenuRow
              icon="repo-push"
              label={g.push}
              onSelect={async () => {
                triggerHaptic('tap')
                await pushGit()
                onClose()
              }}
            />

            <div className="my-1 h-px bg-(--ui-stroke-tertiary)" />

            {creating ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                <Codicon className="text-(--ui-text-tertiary)" name="add" size="0.875rem" />
                <Input
                  autoFocus
                  className="h-7 flex-1 text-xs"
                  onChange={event => setNewName(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void submitNewBranch()
                    } else if (event.key === 'Escape') {
                      setCreating(false)
                      setNewName('')
                    }
                  }}
                  placeholder={g.newBranchName}
                  value={newName}
                />
              </div>
            ) : (
              <MenuRow
                icon="add"
                label={g.newBranch}
                onSelect={() => {
                  triggerHaptic('tap')
                  setCreating(true)
                }}
              />
            )}

            <div className="my-1 h-px bg-(--ui-stroke-tertiary)" />
          </>
        )}

        {loading && (
          <div className="grid place-items-center py-4">
            <Loader className="size-5 text-(--ui-text-tertiary)" type="spiral-search" />
          </div>
        )}

        {!loading && !q && recent.length > 0 && (
          <BranchSection
            branches={recent}
            currentBranch={currentBranch}
            isLocal
            label={g.recent}
            onClose={onClose}
            onRequestDelete={setPendingDelete}
          />
        )}

        {!loading && filteredLocal.length > 0 && (
          <BranchSection
            branches={filteredLocal}
            currentBranch={currentBranch}
            isLocal
            label={g.local}
            onClose={onClose}
            onRequestDelete={setPendingDelete}
          />
        )}

        {!loading && filteredRemote.length > 0 && (
          <BranchSection
            branches={filteredRemote}
            currentBranch={currentBranch}
            isLocal={false}
            label={g.remote}
            onClose={onClose}
            onRequestDelete={setPendingDelete}
          />
        )}

        {!loading && filteredLocal.length === 0 && filteredRemote.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-(--ui-text-tertiary)">{g.noBranches}</div>
        )}
      </div>

      <ConfirmDialog
        confirmLabel={g.delete}
        destructive
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) {
            await deleteGitBranch(pendingDelete)
          }
        }}
        open={pendingDelete !== null}
        title={pendingDelete ? g.deleteConfirm(pendingDelete) : ''}
      />
    </div>
  )
}

interface MenuRowProps {
  icon: string
  label: string
  onSelect: () => void
}

function MenuRow({ icon, label, onSelect }: MenuRowProps) {
  return (
    <button
      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
      onClick={onSelect}
      type="button"
    >
      <Codicon className="text-(--ui-text-tertiary)" name={icon} size="0.875rem" />
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}

interface BranchSectionProps {
  branches: HermesGitBranch[]
  currentBranch: string
  isLocal: boolean
  label: string
  onClose: () => void
  onRequestDelete: (branch: string) => void
}

function BranchSection({ branches, currentBranch, isLocal, label, onClose, onRequestDelete }: BranchSectionProps) {
  return (
    <div className="py-0.5">
      <div className="px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-(--ui-text-tertiary)">
        {label}
      </div>
      {branches.map(branch => (
        <BranchRow
          branch={branch}
          currentBranch={currentBranch}
          isLocal={isLocal}
          key={`${label}-${branch.name}`}
          onClose={onClose}
          onRequestDelete={onRequestDelete}
        />
      ))}
    </div>
  )
}

interface BranchRowProps {
  branch: HermesGitBranch
  currentBranch: string
  isLocal: boolean
  onClose: () => void
  onRequestDelete: (branch: string) => void
}

// A branch row that opens its JetBrains-style action submenu (Checkout, New
// Branch from, Merge/Rebase, Rename, Delete) to the side on click.
function BranchRow({ branch, currentBranch, isLocal, onClose, onRequestDelete }: BranchRowProps) {
  const isCurrent = branch.current || branch.name === currentBranch
  const [open, setOpen] = useState(false)

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex w-full items-center gap-2 px-2.5 py-1 text-left text-xs hover:bg-(--ui-control-hover-background)',
            open && 'bg-(--ui-control-active-background)',
            isCurrent ? 'text-foreground' : 'text-(--ui-text-secondary)'
          )}
          type="button"
        >
          <Codicon
            className={isCurrent ? 'text-(--theme-primary)' : 'text-(--ui-text-tertiary)'}
            name={isCurrent ? 'check' : 'git-branch'}
            size="0.8rem"
          />
          <span className="min-w-0 flex-1 truncate">{branch.name}</span>
          {branch.upstream && (
            <span className="truncate text-[0.66rem] text-(--ui-text-tertiary)/70">{branch.upstream}</span>
          )}
          <Codicon className="text-(--ui-text-tertiary)/60" name="chevron-right" size="0.7rem" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1" side="right">
        <BranchActions
          branch={branch}
          currentBranch={currentBranch}
          isCurrent={isCurrent}
          isLocal={isLocal}
          onClose={() => {
            setOpen(false)
            onClose()
          }}
          onRequestDelete={branchName => {
            setOpen(false)
            onRequestDelete(branchName)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

interface BranchActionsProps {
  branch: HermesGitBranch
  currentBranch: string
  isCurrent: boolean
  isLocal: boolean
  onClose: () => void
  onRequestDelete: (branch: string) => void
}

function BranchActions({ branch, currentBranch, isCurrent, isLocal, onClose, onRequestDelete }: BranchActionsProps) {
  const { t } = useI18n()
  const g = t.git
  const name = branch.name
  // Inline editors for "New Branch from" / "Rename"; null = action list.
  const [mode, setMode] = useState<'menu' | 'newFrom' | 'rename'>('menu')
  const [value, setValue] = useState('')

  const run = async (op: () => Promise<boolean>) => {
    triggerHaptic('tap')
    const ok = await op()

    if (ok) {
      onClose()
    }
  }

  if (mode !== 'menu') {
    const submit = async () => {
      const next = value.trim()

      if (!next) {
        return
      }

      triggerHaptic('tap')
      const ok = mode === 'rename' ? await renameGitBranch(name, next) : await createGitBranch(next, name)

      if (ok) {
        onClose()
      }
    }

    return (
      <div className="flex flex-col gap-1.5 p-1.5">
        <span className="px-1 text-[0.7rem] text-(--ui-text-tertiary)">
          {mode === 'rename' ? g.renameTitle(name) : g.newBranchFrom(name)}
        </span>
        <Input
          autoFocus
          className="h-7 text-xs"
          defaultValue={mode === 'rename' ? name : ''}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            } else if (event.key === 'Escape') {
              setMode('menu')
            }
          }}
          placeholder={g.newBranchName}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {!isCurrent && <ActionRow label={g.checkout} onSelect={() => void run(() => checkoutGitBranch(name))} />}
      <ActionRow
        label={g.newBranchFrom(name)}
        onSelect={() => {
          setValue('')
          setMode('newFrom')
        }}
      />

      {!isCurrent && (
        <>
          <div className="my-1 h-px bg-(--ui-stroke-tertiary)" />
          <ActionRow
            label={g.compareWith(name)}
            onSelect={() => {
              void showGitCompare(name, currentBranch, g.compareTitle(name, currentBranch))
              onClose()
            }}
          />
          <ActionRow
            label={g.showDiffWorkingTree}
            onSelect={() => {
              void showGitDiffWithWorkingTree(name, g.diffWorkingTreeTitle(name))
              onClose()
            }}
          />
          <div className="my-1 h-px bg-(--ui-stroke-tertiary)" />
          <ActionRow
            label={g.mergeInto(name, currentBranch)}
            onSelect={() => void run(() => mergeGitBranch(name))}
          />
          <ActionRow
            label={g.rebaseOnto(currentBranch, name)}
            onSelect={() => void run(() => rebaseOntoGitBranch(name))}
          />
        </>
      )}

      {isLocal && (
        <>
          <div className="my-1 h-px bg-(--ui-stroke-tertiary)" />
          <ActionRow label={g.rename} onSelect={() => setMode('rename')} />
          {!isCurrent && <ActionRow destructive label={g.delete} onSelect={() => onRequestDelete(name)} />}
        </>
      )}
    </div>
  )
}

function ActionRow({
  destructive = false,
  label,
  onSelect
}: {
  destructive?: boolean
  label: string
  onSelect: () => void
}) {
  return (
    <button
      className={cn(
        'flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs hover:bg-(--ui-control-hover-background)',
        destructive ? 'text-destructive hover:text-destructive' : 'text-(--ui-text-secondary) hover:text-foreground'
      )}
      onClick={onSelect}
      type="button"
    >
      {label}
    </button>
  )
}
