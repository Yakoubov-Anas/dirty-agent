import '@xterm/xterm/css/xterm.css'

import { Button } from '@/components/ui/button'
import { KbdCombo } from '@/components/ui/kbd'
import { Loader } from '@/components/ui/loader'
import { useI18n } from '@/i18n'

import { useTerminalSession } from './use-terminal-session'

interface TerminalTabProps {
  active: boolean
  cwd: string
  onAddSelectionToChat: (text: string, label?: string) => void
}

export function TerminalTab({ active, cwd, onAddSelectionToChat }: TerminalTabProps) {
  const { t } = useI18n()

  const { addSelectionToChat, hostRef, selection, selectionStyle, status } = useTerminalSession({
    active,
    cwd,
    onAddSelectionToChat
  })

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 bg-(--ui-editor-surface-background) p-2">
        {status === 'starting' && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
            <Loader
              className="size-8 text-(--ui-text-tertiary)"
              pathSteps={180}
              strokeScale={0.68}
              type="spiral-search"
            />
          </div>
        )}
        {selection.trim() && (
          <div className="absolute z-50 flex items-center gap-1" style={selectionStyle ?? { right: 12, top: 8 }}>
            <Button
              className="h-6 rounded-md px-2 text-[0.68rem] shadow-md backdrop-blur-md"
              onClick={event => event.preventDefault()}
              onMouseDown={event => {
                event.preventDefault()
                event.stopPropagation()
                addSelectionToChat()
              }}
              type="button"
              variant="secondary"
            >
              {t.rightSidebar.addToChat}
              <KbdCombo className="ml-1 opacity-70" combo="mod+l" size="sm" />
            </Button>
          </div>
        )}
        {/* Outer div paints terminal inset; inner div is the xterm host so the
            canvas sizes to the content area and p-2 stays as terminal padding.
            Screen/viewport inherit the live skin surface so the terminal blends
            with the app and follows light/dark; the xterm canvas itself is
            painted the resolved surface color in use-terminal-session. */}
        <div
          className="h-full min-h-0 overflow-hidden text-(--ui-text-secondary) [&_.xterm]:h-full [&_.xterm-screen]:bg-(--ui-editor-surface-background)! [&_.xterm-viewport]:bg-(--ui-editor-surface-background)!"
          ref={hostRef}
        />
      </div>
    </div>
  )
}
