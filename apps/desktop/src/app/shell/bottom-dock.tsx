import { useStore } from '@nanostores/react'
import { type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent, useCallback } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'
import { $bottomDockHeight, setBottomDockHeight } from '@/store/bottom-dock'
import { $paneOpenSeq, $paneStates, setPaneOpen } from '@/store/panes'
import type { ToolWindowId, ToolWindowSide } from '@/store/tool-windows'

export interface BottomPanel {
  content: ReactNode
  id: ToolWindowId
  label: string
  side: ToolWindowSide
}

// JetBrains-style bottom dock: a resizable horizontal region below the panes.
// Bottom-segment tool windows render here. When both the left and right bottom
// groups have an open panel they split the dock 50/50; otherwise the open side
// spans the full width.
export function BottomDock({ panels }: { panels: BottomPanel[] }) {
  const paneStates = useStore($paneStates)
  const height = useStore($bottomDockHeight)

  const openSeq = useStore($paneOpenSeq)
  // Within a dock region, order by open sequence (most-recently-opened last).
  const bySeq = (a: BottomPanel, b: BottomPanel) => (openSeq[a.id] ?? 0) - (openSeq[b.id] ?? 0)
  const openLeft = panels.filter(panel => panel.side === 'left' && paneStates[panel.id]?.open).sort(bySeq)
  const openRight = panels.filter(panel => panel.side === 'right' && paneStates[panel.id]?.open).sort(bySeq)
  const hasLeft = openLeft.length > 0
  const hasRight = openRight.length > 0

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    const startY = event.clientY
    const startHeight = $bottomDockHeight.get()
    const restoreCursor = document.body.style.cursor
    const restoreSelect = document.body.style.userSelect

    handle.setPointerCapture?.(event.pointerId)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (e: PointerEvent) => {
      // Dragging up (smaller clientY) grows the dock.
      setBottomDockHeight(startHeight + (startY - e.clientY))
    }

    const cleanup = () => {
      document.body.style.cursor = restoreCursor
      document.body.style.userSelect = restoreSelect
      handle.releasePointerCapture?.(event.pointerId)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', cleanup, true)
      window.removeEventListener('pointercancel', cleanup, true)
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', cleanup, true)
    window.addEventListener('pointercancel', cleanup, true)
  }, [])

  if (!hasLeft && !hasRight) {
    return null
  }

  return (
    <div
      className="relative flex w-full shrink-0 flex-col border-t border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background)"
      style={{ height: `${height}px` } as CSSProperties}
    >
      {/* Top-edge resize handle. */}
      <div
        aria-label="Resize bottom dock"
        aria-orientation="horizontal"
        className="group absolute inset-x-0 top-0 z-20 h-1 -translate-y-1/2 cursor-row-resize [-webkit-app-region:no-drag]"
        onPointerDown={startResize}
        role="separator"
        tabIndex={0}
      >
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-(--ui-sash-hover-border) opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100" />
      </div>

      <div className="flex min-h-0 flex-1">
        {hasLeft && (
          <DockRegion className={hasRight ? 'flex-1 border-r border-(--ui-stroke-tertiary)' : 'flex-1'} panels={openLeft} />
        )}
        {hasRight && <DockRegion className="flex-1" panels={openRight} />}
      </div>
    </div>
  )
}

function DockRegion({ className, panels }: { className?: string; panels: BottomPanel[] }) {
  return (
    <div className={cn('flex min-w-0 min-h-0', className)}>
      {panels.map(panel => (
        <DockPanel key={panel.id} panel={panel} />
      ))}
    </div>
  )
}

function DockPanel({ panel }: { panel: BottomPanel }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-(--ui-stroke-tertiary) last:border-r-0">
      <header className="flex h-7 shrink-0 items-center gap-2 border-b border-(--ui-stroke-tertiary) px-2.5">
        <span className="min-w-0 flex-1 truncate text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-(--theme-primary)">
          {panel.label}
        </span>
        <Button
          aria-label={`Close ${panel.label}`}
          className="size-5 rounded text-(--ui-text-tertiary)!"
          onClick={() => setPaneOpen(panel.id, false)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Codicon name="close" size="0.8rem" />
        </Button>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">{panel.content}</div>
    </section>
  )
}
