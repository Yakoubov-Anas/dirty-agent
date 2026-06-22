import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import {
  $runConfigs,
  $runState,
  $selectedRunConfig,
  deleteRunConfig,
  type RunConfig,
  selectRunConfig,
  startRun,
  stopRun
} from '@/store/run-configs'
import { $currentCwd } from '@/store/session'

import { RunConfigDialog } from './run-config-dialog'
import { openRunPane } from './run-pane-actions'

// JetBrains-style run-configuration widget for the header center: a dropdown to
// pick a config, plus a Run/Stop button. Add/edit go through a dialog.
export function RunConfigWidget() {
  const { t } = useI18n()
  const r = t.run
  const configs = useStore($runConfigs)
  const selected = useStore($selectedRunConfig)
  const runState = useStore($runState)
  const cwd = useStore($currentCwd)
  const [open, setOpen] = useState(false)
  const [dialogConfig, setDialogConfig] = useState<RunConfig | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const running = runState.status === 'running'

  const openAdd = () => {
    setDialogConfig(null)
    setDialogOpen(true)
    setOpen(false)
  }

  const openEdit = (config: RunConfig) => {
    setDialogConfig(config)
    setDialogOpen(true)
    setOpen(false)
  }

  const run = () => {
    if (!selected) {
      openAdd()

      return
    }

    triggerHaptic('tap')
    openRunPane()
    void startRun(selected, cwd)
  }

  return (
    <div className="flex items-center gap-0.5">
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'pointer-events-auto flex h-(--titlebar-control-height) items-center gap-1.5 rounded-md px-2',
              'text-xs text-(--ui-text-secondary) select-none [-webkit-app-region:no-drag]',
              'hover:bg-(--ui-control-hover-background) hover:text-foreground',
              open && 'bg-(--ui-control-active-background) text-foreground'
            )}
            onPointerDown={event => event.stopPropagation()}
            title={r.widgetTitle}
            type="button"
          >
            <Codicon name="play" size="0.8125rem" />
            <span className="max-w-48 truncate">{selected ? selected.name : r.noConfig}</span>
            <Codicon className="ml-0.5 opacity-70" name="chevron-down" size="0.7rem" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-72 p-1">
          <div className="flex flex-col">
            {configs.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-(--ui-text-tertiary)">{r.empty}</p>
            ) : (
              configs.map(config => (
                <ContextMenu key={config.id}>
                  <ContextMenuTrigger asChild>
                    <button
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                        'hover:bg-(--ui-control-hover-background)',
                        selected?.id === config.id ? 'text-foreground' : 'text-(--ui-text-secondary)'
                      )}
                      onClick={() => {
                        selectRunConfig(config.id)
                        setOpen(false)
                      }}
                      type="button"
                    >
                      <Codicon
                        className={selected?.id === config.id ? 'text-(--theme-primary)' : 'opacity-0'}
                        name="check"
                        size="0.8125rem"
                      />
                      <span className="min-w-0 flex-1 truncate">{config.name}</span>
                      <span
                        className="cursor-pointer rounded p-0.5 text-(--ui-text-tertiary) hover:text-foreground"
                        onClick={event => {
                          event.stopPropagation()
                          openEdit(config)
                        }}
                        role="button"
                        tabIndex={-1}
                        title={r.editConfig}
                      >
                        <Codicon name="edit" size="0.8125rem" />
                      </span>
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => openEdit(config)}>{r.editConfig}</ContextMenuItem>
                    <ContextMenuItem onSelect={() => deleteRunConfig(config.id)} variant="destructive">
                      {r.deleteConfig}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))
            )}
            <div className="my-1 h-px bg-(--ui-stroke-secondary)" />
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
              onClick={openAdd}
              type="button"
            >
              <Codicon name="add" size="0.8125rem" />
              {r.addConfig}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <button
        className={cn(
          'pointer-events-auto flex size-6 items-center justify-center rounded-md [-webkit-app-region:no-drag]',
          running
            ? 'text-(--ui-danger,#e5484d) hover:bg-(--ui-control-hover-background)'
            : 'text-(--theme-primary) hover:bg-(--ui-control-hover-background) disabled:opacity-40'
        )}
        disabled={!running && !selected}
        onClick={() => {
          if (running) {
            triggerHaptic('tap')
            void stopRun()
          } else {
            run()
          }
        }}
        onPointerDown={event => event.stopPropagation()}
        title={running ? r.stop : r.run}
        type="button"
      >
        <Codicon name={running ? 'debug-stop' : 'debug-start'} size="0.9375rem" />
      </button>

      <RunConfigDialog config={dialogConfig} onOpenChange={setDialogOpen} open={dialogOpen} projectCwd={cwd} />
    </div>
  )
}
