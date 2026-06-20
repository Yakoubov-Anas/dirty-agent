import { useStore } from '@nanostores/react'

import { DiffViewer } from '@/components/git/diff-viewer'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader } from '@/components/ui/loader'
import { $gitDiffDialog, $gitDiffDialogLoading, closeGitDiffDialog } from '@/store/git'

// Global diff dialog: hosts the reusable DiffViewer for branch compare /
// working-tree diff. Mounted once at the shell root.
export function GitDiffDialog() {
  const dialog = useStore($gitDiffDialog)
  const loading = useStore($gitDiffDialogLoading)

  return (
    <Dialog onOpenChange={open => !open && closeGitDiffDialog()} open={dialog !== null}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-(--ui-stroke-tertiary) px-4 py-3">
          <DialogTitle className="truncate font-mono text-sm">{dialog?.title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-dt">
          {loading ? (
            <div className="grid place-items-center py-12">
              <Loader className="size-8 text-(--ui-text-tertiary)" type="spiral-search" />
            </div>
          ) : (
            <DiffViewer diff={dialog?.diff ?? ''} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
