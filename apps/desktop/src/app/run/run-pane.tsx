import { useStore } from '@nanostores/react'
import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { RUN_PANE_ID } from '@/store/layout'
import { $runState, $selectedRunConfig, clearRunOutput, startRun, stopRun } from '@/store/run-configs'
import { $currentCwd } from '@/store/session'
import { $toolWindowSide } from '@/store/tool-windows'

import { SidebarPanelLabel } from '../shell/sidebar-label'

function statusLabel(status: string, r: { running: string; exited: string; stopped: string; failed: string; idle: string }): string {
  switch (status) {
    case 'running':
      return r.running

    case 'exited':
      return r.exited

    case 'stopped':
      return r.stopped

    case 'failed':
      return r.failed

    default:
      return r.idle
  }
}

export function RunPane() {
  const { t } = useI18n()
  const r = t.run
  const side = useStore($toolWindowSide(RUN_PANE_ID))
  const runState = useStore($runState)
  const selected = useStore($selectedRunConfig)
  const cwd = useStore($currentCwd)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)

  const running = runState.status === 'running'

  // Auto-scroll to bottom on new output unless the user scrolled up.
  useEffect(() => {
    const body = bodyRef.current

    if (!body || !stickRef.current) {
      return
    }

    body.scrollTop = body.scrollHeight
  }, [runState.lines])

  const onScroll = () => {
    const body = bodyRef.current

    if (!body) {
      return
    }

    stickRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 24
  }

  const rerun = () => {
    if (!selected) {
      return
    }

    triggerHaptic('tap')
    void startRun(selected, cwd)
  }

  return (
    <aside
      aria-label={r.title}
      className={cn(
        'relative flex h-full w-full min-w-0 flex-col overflow-hidden border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) pt-(--pane-header-reserve) text-(--ui-text-tertiary)',
        side === 'left' ? 'border-r' : 'border-l'
      )}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 px-2.5">
        <SidebarPanelLabel>{r.title}</SidebarPanelLabel>
        {runState.configName && (
          <span className="ml-1.5 min-w-0 truncate text-[0.7rem] text-(--ui-text-secondary)">
            {runState.configName}
          </span>
        )}
        <span
          className={cn(
            'ml-1 rounded px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide',
            running && 'bg-(--theme-primary)/15 text-(--theme-primary)',
            runState.status === 'exited' && 'bg-emerald-500/15 text-emerald-500',
            (runState.status === 'failed' || runState.status === 'stopped') && 'bg-(--ui-danger,#e5484d)/15 text-(--ui-danger,#e5484d)'
          )}
        >
          {statusLabel(runState.status, r)}
          {runState.exitCode !== null && runState.status !== 'running' ? ` (${runState.exitCode})` : ''}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {running ? (
            <Tip label={r.stop}>
              <Button
                aria-label={r.stop}
                className="size-6 rounded-md text-(--ui-danger,#e5484d)!"
                onClick={() => void stopRun()}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Codicon name="debug-stop" size="0.875rem" />
              </Button>
            </Tip>
          ) : (
            <Tip label={r.rerun}>
              <Button
                aria-label={r.rerun}
                className="size-6 rounded-md text-(--theme-primary)!"
                disabled={!selected}
                onClick={rerun}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Codicon name="debug-start" size="0.875rem" />
              </Button>
            </Tip>
          )}
          <Tip label={r.clear}>
            <Button
              aria-label={r.clear}
              className="size-6 rounded-md text-(--ui-text-secondary)!"
              disabled={runState.lines.length === 0}
              onClick={() => clearRunOutput()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Codicon name="clear-all" size="0.875rem" />
            </Button>
          </Tip>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto scrollbar-dt px-2.5 pb-2 font-mono text-[0.72rem] leading-relaxed"
        onScroll={onScroll}
        ref={bodyRef}
      >
        {runState.lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Codicon className="text-(--ui-text-tertiary)/60" name="play" size="1.5rem" />
            <p className="text-xs text-(--ui-text-tertiary)">{r.noOutput}</p>
          </div>
        ) : (
          runState.lines.map(line => (
            <div
              className={cn(
                'whitespace-pre-wrap break-words',
                line.stream === 'stderr' && 'text-(--ui-danger,#e5484d)',
                line.stream === 'system' && 'text-(--ui-text-tertiary) italic'
              )}
              key={line.id}
            >
              {line.text || '\u00a0'}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
