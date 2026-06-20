import { useMemo, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { type DiffFile, type DiffLine, parseUnifiedDiff } from '@/lib/parse-diff'
import { cn } from '@/lib/utils'

// Reusable structured diff viewer. Parses a (possibly multi-file) unified diff
// and renders collapsible per-file sections with old/new line gutters. Shared by
// the Commit pane preview, branch compare, and the future Git/log panel.

interface DiffViewerProps {
  className?: string
  // Raw unified diff (one or many files).
  diff: string
  // Pre-parsed files (skip parsing when the caller already has them).
  files?: DiffFile[]
}

export function DiffViewer({ className, diff, files }: DiffViewerProps) {
  const { t } = useI18n()
  const parsed = useMemo(() => files ?? parseUnifiedDiff(diff), [diff, files])

  if (parsed.length === 0) {
    return <div className="px-3 py-6 text-center text-xs text-(--ui-text-tertiary)">{t.git.noDiff}</div>
  }

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      {parsed.map(file => (
        <DiffFileSection file={file} key={`${file.oldPath ?? ''}→${file.path}`} />
      ))}
    </div>
  )
}

function DiffFileSection({ file }: { file: DiffFile }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(true)
  const renamed = file.oldPath && file.oldPath !== file.path

  return (
    <div className="overflow-hidden rounded-md border border-(--ui-stroke-tertiary)">
      <button
        className="flex w-full items-center gap-2 bg-(--ui-bg-elevated)/40 px-2 py-1.5 text-left text-xs hover:bg-(--ui-control-hover-background)"
        onClick={() => setOpen(value => !value)}
        type="button"
      >
        <Codicon className="text-(--ui-text-tertiary)" name={open ? 'chevron-down' : 'chevron-right'} size="0.7rem" />
        <span className="min-w-0 flex-1 truncate font-mono text-(--ui-text-secondary)">
          {renamed ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        {file.additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>}
        {file.deletions > 0 && <span className="text-rose-600 dark:text-rose-400">−{file.deletions}</span>}
      </button>

      {open && (
        <div className="overflow-x-auto">
          {file.binary ? (
            <div className="px-3 py-3 text-xs text-(--ui-text-tertiary)">{t.git.binaryFile}</div>
          ) : (
            <table className="w-full border-collapse font-mono text-[0.7rem] leading-relaxed">
              <tbody>
                {file.hunks.map((hunk, hunkIndex) => (
                  <HunkRows hunk={hunk} key={`${hunkIndex}-${hunk.header}`} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function HunkRows({ hunk }: { hunk: { header: string; lines: DiffLine[] } }) {
  return (
    <>
      <tr className="bg-sky-500/5">
        <td className="w-10 select-none border-r border-(--ui-stroke-tertiary)" />
        <td className="w-10 select-none border-r border-(--ui-stroke-tertiary)" />
        <td className="px-2 text-sky-700 dark:text-sky-300">{hunk.header}</td>
      </tr>
      {hunk.lines.map((line, index) => (
        <DiffRow key={index} line={line} />
      ))}
    </>
  )
}

const ROW_BG: Record<DiffLine['type'], string> = {
  add: 'bg-emerald-500/10',
  context: '',
  del: 'bg-rose-500/10',
  meta: 'text-(--ui-text-tertiary)/70'
}

const TEXT_COLOR: Record<DiffLine['type'], string> = {
  add: 'text-emerald-800 dark:text-emerald-200',
  context: 'text-(--ui-text-secondary)',
  del: 'text-rose-800 dark:text-rose-200',
  meta: 'text-(--ui-text-tertiary)/70'
}

const MARKER: Record<DiffLine['type'], string> = { add: '+', context: ' ', del: '-', meta: '' }

function DiffRow({ line }: { line: DiffLine }) {
  return (
    <tr className={ROW_BG[line.type]}>
      <td className="w-10 select-none border-r border-(--ui-stroke-tertiary) px-1 text-right text-(--ui-text-tertiary)/60">
        {line.oldLine ?? ''}
      </td>
      <td className="w-10 select-none border-r border-(--ui-stroke-tertiary) px-1 text-right text-(--ui-text-tertiary)/60">
        {line.newLine ?? ''}
      </td>
      <td className={cn('px-2 whitespace-pre', TEXT_COLOR[line.type])}>
        <span className="select-none text-(--ui-text-tertiary)/50">{MARKER[line.type]}</span>
        {line.text || ' '}
      </td>
    </tr>
  )
}
