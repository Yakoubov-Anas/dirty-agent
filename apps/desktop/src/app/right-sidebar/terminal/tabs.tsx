import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'

import { setTerminalTakeover } from '../store'

import { $activeTerminalTabId, $terminalTabs, addTerminalTab, closeTerminalTab, selectTerminalTab } from './tabs-store'

// JetBrains-style console tab strip: one chip per live console, a "+" to spawn
// another, and a close affordance per tab. Closing the last tab hides the
// console pane instead of leaving it empty.
export function TerminalTabsBar() {
  const { t } = useI18n()
  const tabs = useStore($terminalTabs)
  const activeTabId = useStore($activeTerminalTabId)

  const closeTab = (id: string) => {
    triggerHaptic('tap')

    if (!closeTerminalTab(id)) {
      setTerminalTakeover(false)
    }
  }

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto px-1.5 scrollbar-none">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId

        return (
          <div
            className={cn(
              'group/term-tab flex h-6 shrink-0 items-center gap-1 rounded-md pl-2 pr-1 text-xs select-none',
              isActive
                ? 'bg-(--ui-control-active-background) text-foreground'
                : 'text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground'
            )}
            key={tab.id}
            onAuxClick={event => {
              // Middle-click closes the tab, like a browser tab.
              if (event.button === 1) {
                event.preventDefault()
                event.stopPropagation()
                closeTab(tab.id)
              }
            }}
          >
            <button
              className="max-w-40 truncate [-webkit-app-region:no-drag]"
              onClick={() => {
                triggerHaptic('tap')
                selectTerminalTab(tab.id)
              }}
              onPointerDown={event => event.stopPropagation()}
              title={tab.title}
              type="button"
            >
              {tab.title}
            </button>
            <Button
              aria-label={t.toolWindows.closeConsole}
              className="size-4 rounded text-(--ui-text-tertiary)! opacity-0 group-hover/term-tab:opacity-100 data-[active=true]:opacity-100"
              data-active={isActive}
              onClick={event => {
                event.stopPropagation()
                closeTab(tab.id)
              }}
              onPointerDown={event => event.stopPropagation()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Codicon name="close" size="0.75rem" />
            </Button>
          </div>
        )
      })}
      <Button
        aria-label={t.toolWindows.newConsole}
        className="ml-1 size-6 shrink-0 rounded-md text-(--ui-text-tertiary)! [-webkit-app-region:no-drag]"
        onClick={() => {
          triggerHaptic('tap')
          addTerminalTab()
        }}
        onPointerDown={event => event.stopPropagation()}
        size="icon"
        title={t.toolWindows.newConsole}
        type="button"
        variant="ghost"
      >
        <Codicon name="add" size="0.875rem" />
      </Button>
    </div>
  )
}
