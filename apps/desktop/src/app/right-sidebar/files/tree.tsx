import { useCallback, useEffect, useRef, useState } from 'react'
import { type NodeApi, type NodeRendererProps, Tree, type TreeApi } from 'react-arborist'

import { PageLoader } from '@/components/page-loader'
import { Codicon } from '@/components/ui/codicon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { CopyButton } from '@/components/ui/copy-button'
import { useResizeObserver } from '@/hooks/use-resize-observer'
import { useI18n } from '@/i18n'
import { isDesktopFsRemoteMode, revealDesktopPathInOS } from '@/lib/desktop-fs'
import { cn } from '@/lib/utils'
import { relativePathFromCwd } from '@/lib/workspace-path'

import { getFileTreeDndManager } from './dnd-manager'
import { openDeletePrompt, openNewFilePrompt, openNewFolderPrompt, openRenamePrompt, parentDir } from './file-ops'
import type { TreeNode } from './use-project-tree'

const ROW_HEIGHT = 22
const INDENT = 10
/** Base inset for every row; react-arborist owns paddingLeft for depth indent. */
const TREE_ROW_INSET = 12

interface ProjectTreeProps {
  collapseNonce: number
  cwd: string
  data: TreeNode[]
  onActivateFile: (path: string) => void
  onActivateFolder: (path: string) => void
  onLoadChildren: (id: string) => void | Promise<void>
  onNodeOpenChange: (id: string, open: boolean) => void
  onPreviewFile?: (path: string) => void
  openState: Record<string, boolean>
  revealNonce: number
  revealSelection: string | null
}

export function ProjectTree({
  collapseNonce,
  cwd,
  data,
  onActivateFile,
  onActivateFolder,
  onLoadChildren,
  onNodeOpenChange,
  onPreviewFile,
  openState,
  revealNonce,
  revealSelection
}: ProjectTreeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const treeRef = useRef<TreeApi<TreeNode> | null>(null)
  const [size, setSize] = useState({ height: 0, width: 0 })

  const syncTreeSize = useCallback(() => {
    const el = containerRef.current

    if (!el) {
      return
    }

    const { height, width } = el.getBoundingClientRect()

    setSize(prev => {
      if (prev.height === height && prev.width === width) {
        return prev
      }

      return { height, width }
    })
  }, [])

  useResizeObserver(syncTreeSize, containerRef)

  // After a reveal request the tree has been remounted (revealNonce is part of
  // its key) with every ancestor of the target expanded. Wait a frame for the
  // virtualized list to mount, then select + scroll the revealed node into view.
  useEffect(() => {
    if (!revealSelection) {
      return
    }

    const id = revealSelection

    const raf = requestAnimationFrame(() => {
      if (treeRef.current?.get(id)) {
        treeRef.current.select(id, { align: 'center' })
      }
    })

    return () => cancelAnimationFrame(raf)
  }, [revealNonce, revealSelection])

  const handleToggle = useCallback(
    (id: string) => {
      const node = treeRef.current?.get(id)

      if (!node) {
        return
      }

      onNodeOpenChange(id, node.isOpen)

      if (node.isOpen && node.data?.isDirectory && node.data.children === undefined) {
        void onLoadChildren(id)
      }
    },
    [onLoadChildren, onNodeOpenChange]
  )

  const handleActivate = useCallback(
    (node: NodeApi<TreeNode>) => {
      if (node.data && !node.data.isDirectory) {
        onPreviewFile?.(node.data.id)
      }
    },
    [onPreviewFile]
  )

  return (
    <div className="min-h-0 flex-1 overflow-hidden" ref={containerRef}>
      {size.height > 0 && size.width > 0 ? (
        <Tree<TreeNode>
          childrenAccessor={node => (node?.isDirectory ? (node.children ?? []) : null)}
          data={data}
          disableDrag
          disableDrop
          disableEdit
          dndManager={getFileTreeDndManager()}
          height={size.height}
          indent={INDENT}
          initialOpenState={openState}
          key={`${cwd}:${collapseNonce}:${revealNonce}`}
          onActivate={handleActivate}
          onToggle={handleToggle}
          openByDefault={false}
          padding={0}
          ref={treeRef}
          rowHeight={ROW_HEIGHT}
          width={size.width}
        >
          {props => (
            <ProjectTreeRow
              {...props}
              cwd={cwd}
              onAttachFile={onActivateFile}
              onAttachFolder={onActivateFolder}
              onPreviewFile={onPreviewFile}
            />
          )}
        </Tree>
      ) : (
        <TreeSizingState />
      )}
    </div>
  )
}

function TreeSizingState() {
  const { t } = useI18n()

  return <PageLoader aria-label={t.rightSidebar.loadingFiles} className="min-h-24 px-3" />
}

function ProjectTreeRow({
  cwd,
  dragHandle,
  node,
  onAttachFile,
  onAttachFolder,
  onPreviewFile,
  style
}: NodeRendererProps<TreeNode> & {
  cwd: string
  onAttachFile: (path: string) => void
  onAttachFolder: (path: string) => void
  onPreviewFile?: (path: string) => void
}) {
  if (!node.data) {
    return <div style={style} />
  }

  const isFolder = node.data.isDirectory
  const isPlaceholder = Boolean(node.data.placeholder)
  const isErrorPlaceholder = node.data.placeholder === 'error'

  const row = (
    <div
      aria-expanded={isFolder ? node.isOpen : undefined}
      aria-selected={node.isSelected}
      className={cn(
        'group/row flex h-full cursor-pointer select-none items-center gap-1 border border-transparent px-3 text-xs font-normal leading-(--file-tree-row-height) text-(--ui-text-secondary) transition-colors hover:bg-(--ui-row-hover-background) hover:text-foreground',
        node.isSelected && 'bg-(--ui-row-active-background) text-foreground',
        isPlaceholder && 'pointer-events-none italic text-muted-foreground/70'
      )}
      draggable={!isPlaceholder}
      onClick={event => {
        event.stopPropagation()

        if (isPlaceholder) {
          return
        }

        if (event.shiftKey) {
          ;(isFolder ? onAttachFolder : onAttachFile)(node.data.id)

          return
        }

        if (isFolder) {
          node.toggle()
        } else {
          node.select()
        }
      }}
      onDoubleClick={event => {
        event.stopPropagation()

        if (!isFolder && !isPlaceholder) {
          onPreviewFile?.(node.data.id)
        }
      }}
      onDragStart={event => {
        if (isPlaceholder) {
          event.preventDefault()

          return
        }

        const payload = JSON.stringify([{ isDirectory: isFolder, path: node.data.id }])

        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData('application/x-hermes-paths', payload)
        event.dataTransfer.setData('text/plain', node.data.id)
      }}
      ref={dragHandle}
      style={{
        ...style,
        paddingLeft:
          (typeof style.paddingLeft === 'number'
            ? style.paddingLeft
            : Number.parseFloat(String(style.paddingLeft ?? 0)) || 0) + TREE_ROW_INSET
      }}
    >
      {/* No chevron column — the folder icon (open/closed) already carries the
          expand state, so the extra glyph was pure noise. */}
      <span aria-hidden className="flex w-3.5 items-center justify-center text-(--ui-text-tertiary)">
        {isPlaceholder && !isErrorPlaceholder ? (
          <Codicon name="loading" size="0.75rem" spinning />
        ) : isErrorPlaceholder ? (
          <Codicon name="warning" size="0.75rem" />
        ) : isFolder ? (
          <Codicon name={node.isOpen ? 'folder-opened' : 'folder'} size="0.875rem" />
        ) : (
          <Codicon name="file" size="0.875rem" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{node.data.name}</span>
    </div>
  )

  // Synthetic loading/error rows aren't real entries — no actions to offer.
  if (isPlaceholder) {
    return row
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ProjectTreeRowMenu cwd={cwd} isFolder={isFolder} path={node.data.id} />
    </ContextMenu>
  )
}

interface ProjectTreeRowMenuProps {
  cwd: string
  isFolder: boolean
  path: string
}

function ProjectTreeRowMenu({ cwd, isFolder, path }: ProjectTreeRowMenuProps) {
  const { t } = useI18n()
  const r = t.rightSidebar
  const relPath = relativePathFromCwd(cwd, path)
  const canRevealInOS = !isDesktopFsRemoteMode() && Boolean(window.hermesDesktop?.revealInOS)
  // New entries land inside a folder, or alongside a file (its parent dir).
  const newEntryDir = isFolder ? path : parentDir(path)

  return (
    <ContextMenuContent className="w-52">
      <ContextMenuItem onSelect={() => openNewFilePrompt(newEntryDir)}>
        <Codicon name="new-file" size="0.875rem" />
        {r.newFile ?? 'New file'}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => openNewFolderPrompt(newEntryDir)}>
        <Codicon name="new-folder" size="0.875rem" />
        {r.newFolder ?? 'New folder'}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => openRenamePrompt(path, isFolder)}>
        <Codicon name="edit" size="0.875rem" />
        {r.renameAction ?? 'Rename'}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => openDeletePrompt(path, isFolder)} variant="destructive">
        <Codicon name="trash" size="0.875rem" />
        {r.deleteAction ?? 'Delete'}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <CopyButton appearance="context-menu-item" label={r.copyPath ?? 'Copy path'} text={path} />
      {relPath && (
        <CopyButton
          appearance="context-menu-item"
          label={r.copyRelativePath ?? 'Copy relative path'}
          text={relPath}
        />
      )}
      {canRevealInOS && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void revealDesktopPathInOS(path)}>
            <Codicon name={isFolder ? 'folder-opened' : 'go-to-file'} size="0.875rem" />
            {r.revealInOS ?? 'Reveal in file explorer'}
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  )
}
