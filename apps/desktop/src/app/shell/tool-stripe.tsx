import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { $paneStates } from '@/store/panes'
import {
  $toolWindowSides,
  setToolWindowSide,
  toggleToolWindow,
  TOOL_WINDOW_DEFAULT_SIDES,
  TOOL_WINDOWS,
  type ToolWindowId,
  type ToolWindowMeta,
  type ToolWindowSide
} from '@/store/tool-windows'

import { titlebarButtonClass } from './titlebar'

// JetBrains-style tool-window stripe: a thin vertical icon rail pinned to a
// window edge. One button per panel docked on that side; click toggles the
// panel, right-click relocates it to the other edge.
export function ToolStripe({ side }: { side: ToolWindowSide }) {
  const sides = useStore($toolWindowSides)
  const windows = TOOL_WINDOWS.filter(window => (sides[window.id] ?? TOOL_WINDOW_DEFAULT_SIDES[window.id]) === side)

  return (
    <div
      className={cn(
        'z-10 flex h-full w-(--tool-stripe-width) shrink-0 flex-col items-center gap-1 bg-(--ui-chat-surface-background) py-1.5 [-webkit-app-region:no-drag]',
        side === 'left' ? 'border-r border-(--ui-stroke-tertiary)' : 'border-l border-(--ui-stroke-tertiary)'
      )}
      data-tool-stripe={side}
    >
      {windows.map(window => (
        <ToolStripeButton key={window.id} side={side} window={window} />
      ))}
    </div>
  )
}

function labelForToolWindow(id: ToolWindowId, t: ReturnType<typeof useI18n>['t']): string {
  if (id === 'chat-sidebar') {
    return t.toolWindows.agent
  }

  if (id === 'terminal-sidebar') {
    return t.toolWindows.terminal
  }

  if (id === 'git-commit') {
    return t.toolWindows.git
  }

  if (id === 'git-log') {
    return t.toolWindows.gitLog
  }

  return t.toolWindows.files
}

function ToolStripeButton({ side, window }: { side: ToolWindowSide; window: ToolWindowMeta }) {
  const { t } = useI18n()
  const paneStates = useStore($paneStates)
  const open = paneStates[window.id]?.open ?? false
  const label = labelForToolWindow(window.id, t)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Button
          aria-label={label}
          aria-pressed={open}
          className={cn(
            titlebarButtonClass,
            'bg-transparent select-none',
            open && 'bg-(--ui-control-active-background) text-foreground'
          )}
          onClick={() => {
            triggerHaptic('tap')
            toggleToolWindow(window.id)
          }}
          onPointerDown={event => event.stopPropagation()}
          size="icon-titlebar"
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
      </ContextMenuContent>
    </ContextMenu>
  )
}
