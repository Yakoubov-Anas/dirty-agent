import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { $paneStates } from '@/store/panes'
import {
  $toolWindowExclusiveOpen,
  $toolWindowPlacements,
  moveToolWindow,
  setToolWindowSegment,
  setToolWindowSide,
  toggleToolWindow,
  toggleToolWindowExclusiveOpen,
  TOOL_WINDOWS,
  type ToolWindowId,
  type ToolWindowMeta,
  type ToolWindowSegment,
  type ToolWindowSide,
  toolWindowsInGroup
} from '@/store/tool-windows'

import { titlebarButtonClass } from './titlebar'

const META_BY_ID = new Map(TOOL_WINDOWS.map(meta => [meta.id, meta]))

// A drop zone id encodes the destination (side, segment) group.
function zoneId(side: ToolWindowSide, segment: ToolWindowSegment): string {
  return `stripe:${side}:${segment}`
}

function parseZoneId(id: string): { segment: ToolWindowSegment; side: ToolWindowSide } | null {
  const match = /^stripe:(left|right):(top|bottom)$/.exec(id)

  return match ? { segment: match[2] as ToolWindowSegment, side: match[1] as ToolWindowSide } : null
}

function labelForToolWindow(id: ToolWindowId, t: ReturnType<typeof useI18n>['t']): string {
  switch (id) {
    case 'chat-sidebar':
      return t.toolWindows.agent

    case 'terminal-sidebar':
      return t.toolWindows.terminal

    case 'git-commit':
      return t.toolWindows.git

    case 'git-log':
      return t.toolWindows.gitLog

    default:
      return t.toolWindows.files
  }
}

// JetBrains-style tool-window stripe: a thin vertical icon rail with a TOP group
// (panels dock on the side) and a BOTTOM group (panels dock in the bottom dock),
// separated by a flexible spacer. Drag buttons to reorder within a group or move
// them between groups/sides; right-click for the same via a menu.
export function ToolStripe({ side }: { side: ToolWindowSide }) {
  // Re-render when placements change (group membership/order).
  useStore($toolWindowPlacements)
  const [activeId, setActiveId] = useState<null | ToolWindowId>(null)

  const sensors = useSensors(
    // A small activation distance so a click still toggles the panel; only a
    // real drag past the threshold starts sorting.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const topIds = toolWindowsInGroup(side, 'top')
  const bottomIds = toolWindowsInGroup(side, 'bottom')

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as ToolWindowId)
  }

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event

    if (!over) {
      return
    }

    const movingId = active.id as ToolWindowId
    const overId = String(over.id)

    // Dropped on a group container directly → append to that group.
    const zone = parseZoneId(overId)

    if (zone) {
      moveToolWindow(movingId, zone.side, zone.segment)
      triggerHaptic('tap')

      return
    }

    // Dropped on another button → take its group + slot before/after it.
    const overPlacement = $toolWindowPlacements.get()[overId as ToolWindowId]

    if (!overPlacement) {
      return
    }

    const groupIds = toolWindowsInGroup(overPlacement.side, overPlacement.segment)
    const targetIndex = groupIds.indexOf(overId as ToolWindowId)
    moveToolWindow(movingId, overPlacement.side, overPlacement.segment, targetIndex)
    triggerHaptic('tap')
  }

  const activeMeta = activeId ? META_BY_ID.get(activeId) : null

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      sensors={sensors}
    >
      <div
        className={cn(
          'z-10 flex h-full w-(--tool-stripe-width) shrink-0 flex-col items-center bg-(--ui-chat-surface-background) py-1.5 [-webkit-app-region:no-drag]',
          side === 'left' ? 'border-r border-(--ui-stroke-tertiary)' : 'border-l border-(--ui-stroke-tertiary)'
        )}
        data-tool-stripe={side}
      >
        <StripeGroup ids={topIds} segment="top" side={side} />
        {/* Spacer pushes the bottom group to the stripe's bottom edge. */}
        <div className="min-h-4 flex-1" />
        <StripeGroup ids={bottomIds} segment="bottom" side={side} />
      </div>

      <DragOverlay dropAnimation={null}>
        {activeMeta ? (
          <div className="flex size-(--titlebar-control-size) items-center justify-center rounded-[4px] bg-(--ui-control-active-background) text-foreground shadow-md">
            <Codicon name={activeMeta.icon} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function StripeGroup({
  ids,
  segment,
  side
}: {
  ids: ToolWindowId[]
  segment: ToolWindowSegment
  side: ToolWindowSide
}) {
  // Droppable so an empty group (or the gap below the last button) accepts a drop.
  const { isOver, setNodeRef } = useDroppable({ id: zoneId(side, segment) })

  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      <div
        className={cn(
          'flex min-h-6 w-full flex-col items-center gap-1 rounded-md',
          isOver && 'bg-(--ui-control-hover-background)/60'
        )}
        ref={setNodeRef}
      >
        {ids.map(id => {
          const meta = META_BY_ID.get(id)

          return meta ? <ToolStripeButton key={id} segment={segment} side={side} window={meta} /> : null
        })}
      </div>
    </SortableContext>
  )
}

function ToolStripeButton({
  segment,
  side,
  window
}: {
  segment: ToolWindowSegment
  side: ToolWindowSide
  window: ToolWindowMeta
}) {
  const { t } = useI18n()
  const paneStates = useStore($paneStates)
  const exclusiveOpen = useStore($toolWindowExclusiveOpen)
  const open = paneStates[window.id]?.open ?? false
  const label = labelForToolWindow(window.id, t)

  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id: window.id })

  const style = {
    opacity: isDragging ? 0.4 : undefined,
    transform: CSS.Transform.toString(transform),
    transition
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Button
          {...attributes}
          {...listeners}
          aria-label={label}
          aria-pressed={open}
          className={cn(
            titlebarButtonClass,
            'bg-transparent select-none',
            open && 'bg-(--ui-control-active-background) text-foreground'
          )}
          onClick={() => {
            // A drag suppresses the click via the activation distance; this only
            // fires on a real tap.
            triggerHaptic('tap')
            toggleToolWindow(window.id)
          }}
          ref={setNodeRef}
          size="icon-titlebar"
          style={style}
          title={label}
          type="button"
          variant="ghost"
        >
          <Codicon name={window.icon} />
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={side === 'left'}
          onSelect={() => {
            triggerHaptic('tap')
            setToolWindowSide(window.id, 'left')
          }}
        >
          <Codicon name="layout-sidebar-left" />
          {t.toolWindows.moveToLeft}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={side === 'right'}
          onSelect={() => {
            triggerHaptic('tap')
            setToolWindowSide(window.id, 'right')
          }}
        >
          <Codicon name="layout-sidebar-right" />
          {t.toolWindows.moveToRight}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={segment === 'top'}
          onSelect={() => {
            triggerHaptic('tap')
            setToolWindowSegment(window.id, 'top')
          }}
        >
          <Codicon className="-scale-y-100" name="layout-panel" />
          {t.toolWindows.moveToTop}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={segment === 'bottom'}
          onSelect={() => {
            triggerHaptic('tap')
            setToolWindowSegment(window.id, 'bottom')
          }}
        >
          <Codicon name="layout-panel" />
          {t.toolWindows.moveToBottom}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            triggerHaptic('tap')
            toggleToolWindowExclusiveOpen()
          }}
        >
          <Codicon name={exclusiveOpen ? 'check' : 'blank'} />
          {t.toolWindows.exclusiveOpen}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
