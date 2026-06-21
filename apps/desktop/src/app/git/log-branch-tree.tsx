import { useStore } from '@nanostores/react'

import { Codicon } from '@/components/ui/codicon'
import type { HermesGitBranch } from '@/global'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { $gitBranch, $gitLocalBranches, $gitRemoteBranches } from '@/store/git'
import { $gitLogBranch, setGitLogBranch } from '@/store/git-log'

// JetBrains-style branch tree for the wide Log layout: HEAD (current), Local,
// and Remote sections. Clicking a branch filters the log to that ref; the HEAD
// row clears the filter back to the current branch.
export function LogBranchTree() {
  const { t } = useI18n()
  const g = t.git
  const current = useStore($gitBranch)
  const local = useStore($gitLocalBranches)
  const remote = useStore($gitRemoteBranches)
  const activeFilter = useStore($gitLogBranch)

  return (
    <div className="flex min-h-0 w-48 shrink-0 flex-col overflow-y-auto border-r border-(--ui-stroke-tertiary) py-1 scrollbar-dt">
      {/* HEAD / current branch */}
      <BranchTreeRow
        active={activeFilter === null}
        icon="git-commit"
        label={current ? g.headCurrent(current) : g.head}
        onSelect={() => void setGitLogBranch(null)}
      />

      {local.length > 0 && (
        <BranchSection label={g.local}>
          {local.map(branch => (
            <BranchEntry activeFilter={activeFilter} branch={branch} key={`local-${branch.name}`} />
          ))}
        </BranchSection>
      )}

      {remote.length > 0 && (
        <BranchSection label={g.remote}>
          {remote.map(branch => (
            <BranchEntry activeFilter={activeFilter} branch={branch} key={`remote-${branch.name}`} />
          ))}
        </BranchSection>
      )}
    </div>
  )
}

function BranchSection({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="mt-1">
      <div className="px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-(--ui-text-tertiary)">
        {label}
      </div>
      {children}
    </div>
  )
}

function BranchEntry({ activeFilter, branch }: { activeFilter: null | string; branch: HermesGitBranch }) {
  return (
    <BranchTreeRow
      active={activeFilter === branch.name}
      current={branch.current}
      icon={branch.current ? 'check' : 'git-branch'}
      label={branch.name}
      onSelect={() => void setGitLogBranch(branch.name)}
    />
  )
}

interface BranchTreeRowProps {
  active: boolean
  current?: boolean
  icon: string
  label: string
  onSelect: () => void
}

function BranchTreeRow({ active, current, icon, label, onSelect }: BranchTreeRowProps) {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-xs',
        active ? 'bg-(--ui-control-active-background) text-foreground' : 'hover:bg-(--ui-control-hover-background)'
      )}
      onClick={() => {
        triggerHaptic('tap')
        onSelect()
      }}
      title={label}
      type="button"
    >
      <Codicon
        className={current ? 'text-(--theme-primary)' : 'text-(--ui-text-tertiary)'}
        name={icon}
        size="0.8rem"
      />
      <span className="min-w-0 flex-1 truncate text-(--ui-text-secondary)">{label}</span>
    </button>
  )
}
