import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { Play } from '@/lib/icons'
import {
  createRunConfig,
  formatEnvText,
  parseEnvText,
  type RunConfig,
  saveRunConfig
} from '@/store/run-configs'

interface RunConfigDialogProps {
  // The config being edited, or null to create a new one.
  config: RunConfig | null
  open: boolean
  onOpenChange: (open: boolean) => void
  projectCwd: string
}

export function RunConfigDialog({ config, open, onOpenChange, projectCwd }: RunConfigDialogProps) {
  const { t } = useI18n()
  const r = t.run
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [cwd, setCwd] = useState('')
  const [envText, setEnvText] = useState('')

  // Re-seed the form whenever the dialog opens or the target config changes.
  useEffect(() => {
    if (!open) {
      return
    }

    setName(config?.name ?? '')
    setCommand(config?.command ?? '')
    setCwd(config?.cwd ?? '')
    setEnvText(formatEnvText(config?.env))
  }, [open, config])

  const canSave = name.trim().length > 0 && command.trim().length > 0

  const submit = () => {
    if (!canSave) {
      return
    }

    const env = parseEnvText(envText)

    saveRunConfig(
      createRunConfig({
        id: config?.id,
        name,
        command,
        cwd,
        env
      })
    )
    onOpenChange(false)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-lg gap-5">
        <DialogHeader>
          <DialogTitle icon={Play}>{config ? r.editConfig : r.addConfig}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={e => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-(--ui-text-secondary)" htmlFor="run-cfg-name">
              {r.fieldName}
            </label>
            <Input
              autoFocus
              id="run-cfg-name"
              onChange={e => setName(e.target.value)}
              placeholder={r.fieldNamePlaceholder}
              value={name}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-(--ui-text-secondary)" htmlFor="run-cfg-command">
              {r.fieldCommand}
            </label>
            <Input
              autoComplete="off"
              autoCorrect="off"
              className="font-mono"
              id="run-cfg-command"
              onChange={e => setCommand(e.target.value)}
              placeholder={r.fieldCommandPlaceholder}
              spellCheck={false}
              value={command}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-(--ui-text-secondary)" htmlFor="run-cfg-cwd">
              {r.fieldCwd}
            </label>
            <Input
              autoComplete="off"
              autoCorrect="off"
              className="font-mono"
              id="run-cfg-cwd"
              onChange={e => setCwd(e.target.value)}
              placeholder={projectCwd || r.fieldCwdPlaceholder}
              spellCheck={false}
              value={cwd}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-(--ui-text-secondary)" htmlFor="run-cfg-env">
              {r.fieldEnv}
            </label>
            <textarea
              className="min-h-20 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-control-background) px-2.5 py-1.5 font-mono text-xs text-foreground outline-none placeholder:text-(--ui-text-tertiary)/70 focus:border-(--theme-primary)"
              id="run-cfg-env"
              onChange={e => setEnvText(e.target.value)}
              placeholder={r.fieldEnvPlaceholder}
              spellCheck={false}
              value={envText}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button disabled={!canSave} type="submit">
              {r.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
