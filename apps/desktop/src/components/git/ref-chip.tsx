import { Codicon } from '@/components/ui/codicon'
import type { HermesGitRef } from '@/global'
import { cn } from '@/lib/utils'

// Small JetBrains-style ref labels shown beside a commit subject (current
// branch, local/remote branches, tags).

const REF_STYLES: Record<HermesGitRef['kind'], { className: string; icon: string }> = {
  current: { className: 'bg-(--theme-primary)/15 text-(--theme-primary)', icon: 'git-branch' },
  head: { className: 'bg-(--ui-control-active-background) text-(--ui-text-secondary)', icon: 'git-commit' },
  local: { className: 'bg-(--ui-control-hover-background) text-(--ui-text-secondary)', icon: 'git-branch' },
  remote: { className: 'bg-(--ui-control-hover-background) text-(--ui-text-tertiary)', icon: 'cloud' },
  tag: { className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', icon: 'tag' }
}

export function RefChip({ gitRef }: { gitRef: HermesGitRef }) {
  const style = REF_STYLES[gitRef.kind]

  return (
    <span
      className={cn(
        'inline-flex max-w-32 shrink-0 items-center gap-0.5 rounded-sm px-1 py-px text-[0.6rem] font-medium',
        style.className
      )}
      title={gitRef.name}
    >
      <Codicon name={style.icon} size="0.6rem" />
      <span className="truncate">{gitRef.name}</span>
    </span>
  )
}

export function RefChips({ refs }: { refs: HermesGitRef[] }) {
  if (refs.length === 0) {
    return null
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      {refs.map(gitRef => (
        <RefChip gitRef={gitRef} key={`${gitRef.kind}:${gitRef.name}`} />
      ))}
    </span>
  )
}
