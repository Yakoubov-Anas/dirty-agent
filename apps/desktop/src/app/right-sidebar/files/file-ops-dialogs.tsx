import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { ActionStatus } from '@/components/ui/action-status'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { AlertTriangle } from '@/lib/icons'

import {
  $fileOp,
  baseName,
  closeFileOp,
  createEntryAndReveal,
  deleteEntryAndRefresh,
  type FileOpRequest,
  renameEntryAndReveal
} from './file-ops'

/** Single mount point (in ProjectTree) for every file-operation dialog. Reads
 *  the shared `$fileOp` store so a right-click menu item can open a dialog that
 *  outlives the virtualized row it came from. */
export function FileOpDialogs() {
  const { t } = useI18n()
  const r = t.rightSidebar
  const op = useStore($fileOp)
  const isDelete = op?.mode === 'delete'

  return (
    <>
      {op && op.mode !== 'delete' && <FileNamePrompt key={`${op.mode}:${op.path}`} op={op} />}
      <ConfirmDialog
        confirmLabel={r.deleteAction ?? 'Delete'}
        description={op ? (r.deleteConfirm?.(baseName(op.path)) ?? `Delete ${baseName(op.path)}?`) : ''}
        destructive
        onClose={closeFileOp}
        onConfirm={async () => {
          if (op) {
            await deleteEntryAndRefresh(op.path)
          }
        }}
        open={Boolean(isDelete)}
        title={op?.isFolder ? (r.deleteFolderTitle ?? 'Delete folder') : (r.deleteFileTitle ?? 'Delete file')}
      />
    </>
  )
}

function FileNamePrompt({ op }: { op: FileOpRequest }) {
  const { t } = useI18n()
  const r = t.rightSidebar
  const isRename = op.mode === 'rename'
  const [name, setName] = useState(isRename ? baseName(op.path) : '')
  const [status, setStatus] = useState<'done' | 'idle' | 'saving'>('idle')
  const [error, setError] = useState<null | string>(null)
  const busy = status === 'saving' || status === 'done'
  const trimmed = name.trim()

  const title =
    op.mode === 'rename'
      ? (r.renameTitle ?? 'Rename')
      : op.mode === 'new-folder'
        ? (r.newFolderTitle ?? 'New folder')
        : (r.newFileTitle ?? 'New file')

  const confirmIdle =
    op.mode === 'rename' ? (r.renameAction ?? 'Rename') : (r.createAction ?? 'Create')

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    if (!trimmed) {
      setError(r.nameRequired ?? 'Name is required')

      return
    }

    if (isRename && trimmed === baseName(op.path)) {
      closeFileOp()

      return
    }

    setStatus('saving')
    setError(null)

    try {
      if (op.mode === 'rename') {
        await renameEntryAndReveal(op.path, trimmed)
      } else {
        await createEntryAndReveal(op.path, trimmed, op.mode === 'new-folder' ? 'folder' : 'file')
      }

      setStatus('done')
      window.setTimeout(closeFileOp, 400)
    } catch (err) {
      setStatus('idle')
      setError(err instanceof Error ? err.message : (r.fileOpFailed ?? 'Operation failed'))
    }
  }

  return (
    <Dialog onOpenChange={value => !value && !busy && closeFileOp()} open>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <form className="grid gap-3" onSubmit={handleSubmit}>
          <Input
            aria-invalid={Boolean(error)}
            aria-label={title}
            autoFocus
            onChange={event => setName(event.target.value)}
            onFocus={event => event.target.select()}
            placeholder={r.namePlaceholder ?? 'Name'}
            value={name}
          />

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button disabled={busy} onClick={closeFileOp} type="button" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button disabled={busy || !trimmed} type="submit">
              <ActionStatus busy={t.common.loading} done={t.common.done} idle={confirmIdle} state={status} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
