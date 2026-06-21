import { useStore } from '@nanostores/react'
import type { CSSProperties, ReactNode } from 'react'
import { useSyncExternalStore } from 'react'

import { NotificationStack } from '@/components/notifications'
import { PaneShell } from '@/components/pane-shell'
import { SidebarProvider } from '@/components/ui/sidebar'
import { useMediaQuery } from '@/hooks/use-media-query'
import {
  $fileBrowserOpen,
  $sidebarOpen,
  CHAT_SIDEBAR_PANE_ID,
  FILE_BROWSER_DEFAULT_WIDTH,
  FILE_BROWSER_PANE_ID,
  setSidebarOpen,
  TERMINAL_PANE_ID
} from '@/store/layout'
import { $paneWidthOverride } from '@/store/panes'
import { $connection } from '@/store/session'
import { $toolWindowSide } from '@/store/tool-windows'
import { isSecondaryWindow } from '@/store/windows'

import { BranchWidget } from '../git/branch-widget'
import { GitDiffDialog } from '../git/diff-dialog'
import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '../layout-constants'

import { KeybindPanel } from './keybind-panel'
import { StatusbarControls, type StatusbarItem } from './statusbar-controls'
import { TITLEBAR_HEIGHT, titlebarControlsPosition } from './titlebar'
import { TitlebarControls, type TitlebarTool } from './titlebar-controls'
import { ToolStripe, ToolStripeDndProvider } from './tool-stripe'

interface AppShellProps {
  // JetBrains-style bottom dock: bottom-segment tool windows render here, below
  // the panes and between the stripes. Built by the controller and placed here.
  bottomDock?: ReactNode
  children: ReactNode
  leftStatusbarItems?: readonly StatusbarItem[]
  leftTitlebarTools?: readonly TitlebarTool[]
  // Fixed-position overlays that must share <main>'s stacking context so pane
  // resize handles (z-20) paint above them. The persistent terminal lives here:
  // hoisting it to the root `overlays` layer (sibling of <main>, z above z-3)
  // would cover every pane's drag handle.
  mainOverlays?: ReactNode
  onOpenSettings: () => void
  overlays?: ReactNode
  // Rails that sit at the window's left edge in the flipped layout but never
  // force-collapse to hover-reveal overlays — so they cover the top-left traffic
  // lights (and zero the titlebar inset) even below the collapse breakpoint.
  previewPaneOpen?: boolean
  statusbarItems?: readonly StatusbarItem[]
  terminalPaneOpen?: boolean
  titlebarTools?: readonly TitlebarTool[]
}

// Renderer-side fallback so layout snaps even when the main-process fullscreen event
// hasn't landed yet (e.g. dev reloads, before the IPC bridge is wired).
function subscribeWindowSize(cb: () => void) {
  window.addEventListener('resize', cb)
  window.addEventListener('fullscreenchange', cb)

  return () => {
    window.removeEventListener('resize', cb)
    window.removeEventListener('fullscreenchange', cb)
  }
}

const viewportIsFullscreen = () =>
  window.innerWidth >= window.screen.width && window.innerHeight >= window.screen.height

export function AppShell({
  children,
  bottomDock,
  leftStatusbarItems,
  leftTitlebarTools,
  mainOverlays,
  onOpenSettings,
  overlays,
  previewPaneOpen = false,
  statusbarItems,
  terminalPaneOpen = false,
  titlebarTools
}: AppShellProps) {
  const sidebarOpen = useStore($sidebarOpen)
  const fileBrowserOpen = useStore($fileBrowserOpen)
  const sidebarSide = useStore($toolWindowSide(CHAT_SIDEBAR_PANE_ID))
  const railSide = useStore($toolWindowSide(FILE_BROWSER_PANE_ID))
  const terminalSide = useStore($toolWindowSide(TERMINAL_PANE_ID))
  const narrowViewport = useMediaQuery(SIDEBAR_COLLAPSE_MEDIA_QUERY)
  const fileBrowserWidthOverride = useStore($paneWidthOverride(FILE_BROWSER_PANE_ID))
  const connection = useStore($connection)
  const viewportFullscreen = useSyncExternalStore(subscribeWindowSize, viewportIsFullscreen, () => false)
  const isFullscreen = Boolean(connection?.isFullscreen) || viewportFullscreen
  // Every secondary window (new-session scratch, subagent watch, cmd-click
  // pop-out) is a compact side panel — none of them carry the full titlebar
  // tool cluster. Gate on isSecondaryWindow, never the narrower new-session flag.
  const hideTitlebarControls = isSecondaryWindow()
  const titlebarControls = titlebarControlsPosition(connection?.windowButtonPosition, isFullscreen)
  // Width Windows/Linux reserve for the OS-painted min/max/close overlay (zero
  // on macOS, where window controls sit on the left and are reported via
  // windowButtonPosition instead). The right tool cluster has to clear them.
  const nativeOverlayWidth = connection?.nativeOverlayWidth ?? 0
  const titlebarToolsRight = nativeOverlayWidth > 0 ? `${nativeOverlayWidth}px` : '0.75rem'

  // The inset clears the top-left titlebar buttons when nothing covers the
  // window's left edge. Default layout: the sessions sidebar sits there.
  // Flipped layout: the file browser does instead. Both force-collapse to a
  // hover-reveal overlay (0px track) below the collapse breakpoint, so the edge
  // is uncovered there regardless of their stored open state. A standalone
  // session window renders no sidebar at all, so its edge is always uncovered.
  const collapsibleLeftPaneOpen =
    (sidebarSide === 'left' && sidebarOpen) || (railSide === 'left' && fileBrowserOpen)

  // The terminal + preview rails never force-collapse, so when they're the
  // leftmost open pane they cover the edge even when narrow.
  const persistentLeftPaneOpen =
    (terminalSide === 'left' && terminalPaneOpen) || (railSide === 'left' && previewPaneOpen)

  const leftEdgePaneOpen =
    !isSecondaryWindow() && ((!narrowViewport && collapsibleLeftPaneOpen) || persistentLeftPaneOpen)

  // The dedicated header bar (a full-width block above the panes) always covers
  // the window's top edge, so pane headers below it never sit under the macOS
  // traffic lights — no content inset needed. Secondary windows have no bar, so
  // they keep the original edge-dodging behavior.
  const titlebarContentInset = !hideTitlebarControls
    ? 0
    : leftEdgePaneOpen
      ? 0
      : titlebarControls.left + TITLEBAR_HEIGHT + Math.round(TITLEBAR_HEIGHT / 2)

  // The static system cluster (haptics, profiles, settings, right-sidebar) is
  // hardcoded in TitlebarControls. Pane-supplied tools (preview's group) render
  // in a separate cluster anchored further left.
  //
  // Width math has to include the `gap-x-1` (0.25rem) between buttons:
  // N buttons + (N - 1) inner gaps, plus one extra 0.25rem of breathing room
  // between the pane-tool cluster and the system cluster so they don't sit
  // flush against each other. Modeled as N gaps (N - 1 inner + 1 trailing)
  // to keep the formula generic for any pane-tool count.
  const SYSTEM_TOOL_COUNT = 4
  const paneToolCount = titlebarTools?.filter(tool => !tool.hidden).length ?? 0
  const systemToolsWidth = `calc(${SYSTEM_TOOL_COUNT} * (var(--titlebar-control-size) + 0.25rem))`

  // Where the fixed left control cluster ends, so the header's left section
  // (branch widget) can start past it. Left cluster = sidebar toggle (1) plus
  // any caller-supplied left titlebar tools, anchored at --titlebar-controls-left.
  const leftToolCount = 1 + (leftTitlebarTools?.filter(tool => !tool.hidden).length ?? 0)
  const leftToolsEnd = `calc(var(--titlebar-controls-left) + ${leftToolCount} * (var(--titlebar-control-size) + 0.25rem) + 0.5rem)`

  const fileBrowserWidth =
    fileBrowserWidthOverride !== undefined ? `${fileBrowserWidthOverride}px` : FILE_BROWSER_DEFAULT_WIDTH

  // Where the pane-tool cluster's right edge sits, measured from the inner
  // titlebar padding (--titlebar-tools-right). Two anchors:
  //   - file-browser closed → flush against static cluster's left edge
  //   - file-browser open   → flush against the file-browser pane's left edge
  //                           (= preview pane's right edge)
  const previewToolbarGap = fileBrowserOpen ? fileBrowserWidth : systemToolsWidth

  // Used by the drag region to know where the rightmost interactive element
  // ends. When pane tools are present, that's `gap + paneCount * controlSize
  // + paneCount * 0.25rem` (the leftmost button is at `tools-right + gap +
  // paneCount * (size + gap-x-1)`). Otherwise the static cluster's footprint
  // is enough.
  const titlebarToolsWidth =
    paneToolCount > 0
      ? `calc(${previewToolbarGap} + ${paneToolCount} * (var(--titlebar-control-size) + 0.25rem))`
      : systemToolsWidth

  return (
    <SidebarProvider
      className="h-screen min-h-0 flex-col bg-background"
      onOpenChange={setSidebarOpen}
      open={sidebarOpen}
      style={
        {
          // Alias for shadcn <Sidebar> descendants. Resolves to the chat-sidebar
          // pane track via PaneShell's emitted --pane-chat-sidebar-width.
          '--sidebar-width': 'var(--pane-chat-sidebar-width)',
          '--titlebar-height': `${TITLEBAR_HEIGHT}px`,
          // Width of the JetBrains-style edge stripes flanking the panes.
          '--tool-stripe-width': '2.25rem',
          // Hover-reveal panels must slide past the edge stripe to hide fully,
          // so the off-screen gap = stripe width + the usual 1rem margin.
          '--pane-reveal-offscreen-gap': hideTitlebarControls ? '1rem' : 'calc(2.25rem + 1rem)',
          // Panes reserve the titlebar zone only when there's no dedicated header
          // bar (secondary windows). With the bar present, the bar owns that
          // height and panes start flush below it — reserve 0 to avoid a gap.
          '--pane-header-reserve': hideTitlebarControls ? `${TITLEBAR_HEIGHT}px` : '0px',
          '--titlebar-content-inset': `${titlebarContentInset}px`,
          '--titlebar-controls-left': `${titlebarControls.left}px`,
          '--titlebar-controls-top': `${titlebarControls.top}px`,
          '--titlebar-tools-right': titlebarToolsRight,
          '--titlebar-tools-width': titlebarToolsWidth,
          '--titlebar-left-tools-end': leftToolsEnd,
          // Anchor for the pane-tool cluster's right edge in TitlebarControls.
          // Sourced from the layout store rather than the PaneShell-emitted
          // --pane-*-width vars because the titlebar is a sibling of PaneShell
          // and CSS variables resolve at the consumer's scope.
          '--shell-preview-toolbar-gap': previewToolbarGap
        } as CSSProperties
      }
    >
      {!hideTitlebarControls && (
        <>
          {/* Dedicated full-width header block. Sits above every pane as its own
              row (its height pushes <main> down), giving the window/system
              controls their own band separated from the panels below. The
              window/system control clusters stay `fixed` and land on this bar;
              the bar supplies the background, divider, and drag region, plus
              three flex sections (left / center / right). The branch widget sits
              in the left section, past the fixed left control cluster. */}
          <div className="relative z-10 flex h-(--titlebar-height) w-full shrink-0 items-center border-b border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background) [-webkit-app-region:drag]">
            <div
              className="flex min-w-0 items-center gap-1"
              style={{ paddingLeft: 'var(--titlebar-left-tools-end)' }}
            >
              <BranchWidget />
            </div>
            <div className="flex flex-1 items-center justify-center" />
            <div
              className="flex min-w-0 items-center justify-end gap-1"
              style={{ paddingRight: 'calc(var(--titlebar-tools-right) + var(--titlebar-tools-width) + 0.5rem)' }}
            />
          </div>
          <TitlebarControls leftTools={leftTitlebarTools} onOpenSettings={onOpenSettings} tools={titlebarTools} />
        </>
      )}

      <main className="relative z-3 flex min-h-0 w-full flex-1 flex-col overflow-hidden transition-none">
        <ToolStripeDndProvider>
          <div className="flex min-h-0 w-full flex-1">
            {/* Left tool-window stripe — permanent icon rail at the window edge.
                Secondary windows are compact and carry no stripes. */}
            {!hideTitlebarControls && <ToolStripe side="left" />}

            {/* Center column: panes on top, bottom dock below (between stripes). */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <PaneShell className="min-h-0 flex-1">
                {/* Secondary windows have no header bar, so the titlebar zone lives at
                    the top of the panes — keep it draggable there. Normal windows drag
                    from the dedicated header bar instead. */}
                {hideTitlebarControls && (
                  <>
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute left-0 top-0 z-1 h-(--titlebar-height) w-(--titlebar-controls-left) [-webkit-app-region:drag]"
                    />
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute top-0 z-1 h-(--titlebar-height) left-[calc(var(--titlebar-controls-left)+(var(--titlebar-control-size)*2)+0.75rem)] right-[calc(var(--titlebar-tools-right)+var(--titlebar-tools-width)+0.75rem)] [-webkit-app-region:drag]"
                    />
                  </>
                )}

                {children}
              </PaneShell>

              {/* Bottom dock (resizable). Renders null when no bottom panel open. */}
              {bottomDock}
            </div>

            {/* Right tool-window stripe. */}
            {!hideTitlebarControls && <ToolStripe side="right" />}
          </div>
        </ToolStripeDndProvider>

        {/* Fixed overlays scoped to main's stacking context (terminal). Rendered
            after PaneShell so it paints over pane content, but its z stays under
            the panes' z-20 resize handles, keeping every pane resizable. */}
        {mainOverlays}

        {/* The compact pop-out drops the statusbar — it's a scratch window, not
            the full shell. */}
        {!isSecondaryWindow() && <StatusbarControls items={statusbarItems} leftItems={leftStatusbarItems} />}
      </main>

      {overlays}

      {/* Keybind map dialog (titlebar ⌨ button / ⌘/). */}
      <KeybindPanel />

      {/* Git compare / working-tree diff dialog. */}
      <GitDiffDialog />

      {/* Mounted at the shell root (after overlays) so success/error toasts
          surface above every route and overlay — not just the chat view. */}
      <NotificationStack />
    </SidebarProvider>
  )
}
