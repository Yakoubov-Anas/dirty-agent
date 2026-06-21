import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { revealPathInTree } from '@/app/right-sidebar/files/use-project-tree'
import type { SetTitlebarToolGroup } from '@/app/shell/titlebar-controls'
import { Codicon } from '@/components/ui/codicon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { CopyButton } from '@/components/ui/copy-button'
import { Tip } from '@/components/ui/tooltip'
import { translateNow, useI18n } from '@/i18n'
import { isDesktopFsRemoteMode, revealDesktopPathInOS } from '@/lib/desktop-fs'
import { cn } from '@/lib/utils'
import { $dbRailTabs, type DbRailTab } from '@/store/database'
import {
  $rightRailActiveTabId,
  FILE_BROWSER_PANE_ID,
  RIGHT_RAIL_PREVIEW_TAB_ID,
  type RightRailTabId,
  selectRightRailTab
} from '@/store/layout'
import { notifyError } from '@/store/notifications'
import {
  $dirtyPreviewFiles,
  $filePreviewTabs,
  $previewReloadRequest,
  $previewTarget,
  closeOtherRightRailTabs,
  closeRightRail,
  closeRightRailTab,
  type PreviewTarget
} from '@/store/preview'
import { $currentCwd } from '@/store/session'
import { $toolWindowSide } from '@/store/tool-windows'

import { DbConsolePane } from '../../database/db-console-pane'
import { DbTablePane } from '../../database/db-table-pane'

import { filePathForTarget, relativePathFromCwd } from './preview-file'
import { PreviewPane } from './preview-pane'

export const PREVIEW_RAIL_MIN_WIDTH = '18rem'
export const PREVIEW_RAIL_MAX_WIDTH = '38rem'

const INTRINSIC = `clamp(${PREVIEW_RAIL_MIN_WIDTH}, 36vw, 32rem)`

// Track for <Pane id="preview">. Folds the intrinsic clamp with a min-floor
// against --chat-min-width so the chat surface never gets squeezed below it.
// Subtracts the project browser width so preview yields rather than crushing
// the chat when both right-side panes are open.
export const PREVIEW_RAIL_PANE_WIDTH = `min(${INTRINSIC}, max(0rem, calc(100vw - var(--pane-chat-sidebar-width) - var(--pane-file-browser-width, 0rem) - var(--chat-min-width))))`

interface ChatPreviewRailProps {
  onRestartServer?: (url: string, context?: string) => Promise<string>
  setTitlebarToolGroup?: SetTitlebarToolGroup
}

interface RailTab {
  id: RightRailTabId
  label: string
  target?: PreviewTarget
  db?: DbRailTab
}

function tabLabelFor(target: PreviewTarget): string {
  const value = target.label || target.path || target.source || target.url
  const tail = value.split(/[\\/]/).filter(Boolean).at(-1)

  return tail || value || translateNow('preview.tab')
}

/** Path of the file a tab points at, or its url for non-file (live) previews. */
function tabPathFor(target: PreviewTarget): string {
  return target.kind === 'file' ? filePathForTarget(target) : target.url
}

export function ChatPreviewRail({ onRestartServer, setTitlebarToolGroup }: ChatPreviewRailProps) {
  const { t } = useI18n()
  const previewReloadRequest = useStore($previewReloadRequest)
  const activeTabId = useStore($rightRailActiveTabId)
  const filePreviewTabs = useStore($filePreviewTabs)
  const previewTarget = useStore($previewTarget)
  const dirtyFiles = useStore($dirtyPreviewFiles)
  const cwd = useStore($currentCwd).trim()
  const railSide = useStore($toolWindowSide(FILE_BROWSER_PANE_ID))
  const wheelCleanupRef = useRef<(() => void) | null>(null)

  // Vertical mouse-wheel scrolls the tab strip horizontally (the scrollbar is
  // hidden). A callback ref — not a plain ref + mount effect — because the
  // strip is conditionally rendered (the component returns null with no tabs),
  // so a `[]`-dep effect would capture a null ref and never re-attach once tabs
  // appear. Only intercept when there's overflow and the gesture is mostly
  // vertical, so trackpad horizontal swipes still scroll natively.
  const tabStripRef = useCallback((el: HTMLDivElement | null) => {
    wheelCleanupRef.current?.()
    wheelCleanupRef.current = null

    if (!el) {
      return
    }

    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || event.deltaY === 0) {
        return
      }

      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return
      }

      event.preventDefault()
      el.scrollLeft += event.deltaY
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    wheelCleanupRef.current = () => el.removeEventListener('wheel', onWheel)
  }, [])

  const dbRailTabs = useStore($dbRailTabs)

  const tabs = useMemo<readonly RailTab[]>(
    () => [
      ...(previewTarget ? [{ id: RIGHT_RAIL_PREVIEW_TAB_ID, label: t.preview.tab, target: previewTarget } as RailTab] : []),
      ...filePreviewTabs.map(({ id, target }) => ({ id, label: tabLabelFor(target), target }) as RailTab),
      ...dbRailTabs.map(db => ({ db, id: db.id, label: db.title }) as RailTab)
    ],
    [dbRailTabs, filePreviewTabs, previewTarget, t.preview.tab]
  )

  const activeTab = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]

  useEffect(() => {
    if (activeTab && activeTab.id !== activeTabId) {
      selectRightRailTab(activeTab.id)
    }
  }, [activeTab, activeTabId])

  if (!activeTab) {
    return null
  }

  const isPreview = activeTab.id === RIGHT_RAIL_PREVIEW_TAB_ID

  return (
    <aside
      className={cn(
        'relative flex h-full w-full min-w-0 flex-col overflow-hidden border-(--ui-stroke-secondary) bg-(--ui-editor-surface-background) text-(--ui-text-tertiary)',
        railSide === 'left' ? 'border-r' : 'border-l'
      )}
    >
      <div className="group/rail-tabs flex h-(--titlebar-height) shrink-0 border-b border-(--ui-stroke-tertiary) bg-(--ui-sidebar-surface-background)">
        <div
          className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          ref={tabStripRef}
          role="tablist"
        >
          {tabs.map(tab => {
            const active = tab.id === activeTab.id
            const isDirty = tab.target ? dirtyFiles.has(filePathForTarget(tab.target)) : false

            return (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      'group/tab relative flex h-full min-w-0 max-w-48 shrink-0 items-center text-[0.6875rem] font-medium [-webkit-app-region:no-drag] last:border-r last:border-(--ui-stroke-quaternary)',
                      active
                        ? 'bg-(--ui-editor-surface-background) text-foreground [--tab-bg:var(--ui-editor-surface-background)]'
                        : 'border-r border-(--ui-stroke-quaternary) text-(--ui-text-tertiary) [--tab-bg:var(--ui-sidebar-surface-background)] hover:bg-(--chrome-action-hover) hover:text-foreground'
                    )}
                    // Middle-click closes the tab, matching browser/IDE muscle
                    // memory. `onMouseDown` swallows the middle-button press so
                    // Chromium doesn't switch into autoscroll mode.
                    onAuxClick={event => {
                      if (event.button !== 1) {
                        return
                      }

                      event.preventDefault()
                      closeRightRailTab(tab.id)
                    }}
                    onMouseDown={event => {
                      if (event.button === 1) {
                        event.preventDefault()
                      }
                    }}
                  >
                    {active && (
                      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-(--ui-stroke-primary)" />
                    )}
                    <Tip label={tab.label}>
                      <button
                        aria-selected={active}
                        className="flex h-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden pl-3 pr-6 text-left outline-none"
                        onClick={() => selectRightRailTab(tab.id)}
                        role="tab"
                        type="button"
                      >
                        {/* JetBrains-style unsaved indicator: a small dot before the
                            file name, in the tab's own text color. */}
                        {isDirty && (
                          <span
                            aria-label={t.preview.modifiedBadge ?? 'Unsaved changes'}
                            className="size-1.5 shrink-0 rounded-full bg-current"
                            role="img"
                          />
                        )}
                        <span className="block min-w-0 truncate">{tab.label}</span>
                      </button>
                    </Tip>
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 right-0 w-9 bg-[linear-gradient(to_right,transparent,var(--tab-bg)_55%)] opacity-0 transition-opacity group-hover/tab:opacity-100 group-focus-within/tab:opacity-100"
                    />
                    <button
                      aria-label={t.preview.closeTab(tab.label)}
                      className="pointer-events-none absolute right-1.5 top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-(--ui-text-tertiary) opacity-0 transition-[background-color,color,opacity] hover:bg-(--ui-bg-secondary) hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-100"
                      onClick={() => closeRightRailTab(tab.id)}
                      type="button"
                    >
                      <Codicon name="close" size="0.75rem" />
                    </button>
                  </div>
                </ContextMenuTrigger>
                {tab.target ? (
                  <PreviewTabMenu cwd={cwd} onlyTab={tabs.length === 1} tab={{ ...tab, target: tab.target }} />
                ) : (
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => closeRightRailTab(tab.id)}>
                      <Codicon name="close" />
                      {t.preview.closeTab(tab.label)}
                    </ContextMenuItem>
                  </ContextMenuContent>
                )}
              </ContextMenu>
            )
          })}
        </div>
        <button
          aria-label={t.preview.closePane}
          className="mr-1.5 grid size-6 shrink-0 self-center place-items-center rounded-md text-(--ui-text-tertiary) opacity-0 transition-opacity hover:bg-(--ui-control-hover-background) hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-hover/rail-tabs:opacity-100 [-webkit-app-region:no-drag]"
          onClick={closeRightRail}
          type="button"
        >
          <Codicon name="close" size="0.75rem" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab.db ? (
          activeTab.db.kind === 'table' && activeTab.db.table ? (
            <DbTablePane connectionId={activeTab.db.connectionId} table={activeTab.db.table} />
          ) : (
            <DbConsolePane connectionId={activeTab.db.connectionId} />
          )
        ) : activeTab.target ? (
          <PreviewPane
            embedded
            onRestartServer={isPreview ? onRestartServer : undefined}
            reloadRequest={previewReloadRequest}
            setTitlebarToolGroup={setTitlebarToolGroup}
            target={activeTab.target}
          />
        ) : null}
      </div>
    </aside>
  )
}

interface PreviewTabMenuProps {
  cwd: string
  onlyTab: boolean
  tab: RailTab & { target: PreviewTarget }
}

function PreviewTabMenu({ cwd, onlyTab, tab }: PreviewTabMenuProps) {
  const { t } = useI18n()
  const p = t.preview
  const isFile = tab.target.kind === 'file'
  const fullPath = tabPathFor(tab.target)
  const relPath = isFile ? relativePathFromCwd(cwd, fullPath) : null
  const canRevealInOS = isFile && !isDesktopFsRemoteMode() && Boolean(window.hermesDesktop?.revealInOS)

  const revealInOS = async () => {
    const ok = await revealDesktopPathInOS(fullPath)

    if (!ok) {
      notifyError(new Error(fullPath), p.revealInOSFailed ?? p.unavailable)
    }
  }

  return (
    <ContextMenuContent className="w-52">
      <CopyButton appearance="context-menu-item" label={p.copyPath ?? 'Copy path'} text={fullPath} />
      {relPath && (
        <CopyButton
          appearance="context-menu-item"
          label={p.copyRelativePath ?? 'Copy relative path'}
          text={relPath}
        />
      )}
      {isFile && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void revealPathInTree(fullPath)}>
            <Codicon name="target" size="0.875rem" />
            {p.revealInTree ?? 'Reveal in file tree'}
          </ContextMenuItem>
          {canRevealInOS && (
            <ContextMenuItem onSelect={() => void revealInOS()}>
              <Codicon name="folder-opened" size="0.875rem" />
              {p.revealInOS ?? 'Reveal in file explorer'}
            </ContextMenuItem>
          )}
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => closeRightRailTab(tab.id)}>
        <Codicon name="close" size="0.875rem" />
        {p.closeTabLabel ?? 'Close'}
      </ContextMenuItem>
      <ContextMenuItem disabled={onlyTab} onSelect={() => closeOtherRightRailTabs(tab.id)}>
        <Codicon name="close-all" size="0.875rem" />
        {p.closeOthers ?? 'Close others'}
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
