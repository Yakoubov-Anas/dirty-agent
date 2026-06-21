import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import {
  type DbConnectParams,
  type DbEngine,
  getDbDriverStatus,
  installDbDriver,
  testDbConnection
} from '@/lib/desktop-db'
import { selectDesktopPaths } from '@/lib/desktop-fs'
import { triggerHaptic } from '@/lib/haptics'
import { addDbConnection } from '@/store/database'

type Status =
  | { kind: 'driver-missing'; engine: DbEngine; pkg: string }
  | { kind: 'error'; message: string }
  | { kind: 'idle' }
  | { kind: 'installing' }
  | { kind: 'testing' }
  | { kind: 'tested-ok' }

function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const match = /^\d+:\s*(\{.*\})$/.exec(raw)

  if (match) {
    try {
      const parsed = JSON.parse(match[1]) as { detail?: unknown }

      if (typeof parsed.detail === 'string') {
        return parsed.detail
      }
    } catch {
      // fall through
    }
  }

  return raw
}

export function ConnectionDialog({ onClose, open }: { onClose: () => void; open: boolean }) {
  const { t } = useI18n()
  const d = t.database
  const [engine, setEngine] = useState<DbEngine>('sqlite')
  const [name, setName] = useState('')
  const [file, setFile] = useState('')
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('3306')
  const [database, setDatabase] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const reset = () => {
    setEngine('sqlite')
    setName('')
    setFile('')
    setHost('127.0.0.1')
    setPort('3306')
    setDatabase('')
    setUser('')
    setPassword('')
    setStatus({ kind: 'idle' })
  }

  const close = () => {
    reset()
    onClose()
  }

  const params = (): DbConnectParams =>
    engine === 'sqlite'
      ? { engine: 'sqlite', file, name }
      : {
          database,
          engine: 'mysql',
          host,
          name: name || database,
          password,
          port: Number.parseInt(port, 10) || 3306,
          user
        }

  // Ensure the engine's driver is present; prompt to install if not. Returns
  // true when the driver is ready to use.
  const ensureDriver = async (): Promise<boolean> => {
    const driver = await getDbDriverStatus(engine)

    if (driver.available) {
      return true
    }

    setStatus({ engine, kind: 'driver-missing', pkg: driver.package ?? engine })

    return false
  }

  const install = async () => {
    setStatus({ kind: 'installing' })

    try {
      await installDbDriver(engine)
      setStatus({ kind: 'idle' })
    } catch (error) {
      setStatus({ kind: 'error', message: describeError(error) })
    }
  }

  const test = async () => {
    if (!(await ensureDriver())) {
      return
    }

    setStatus({ kind: 'testing' })

    try {
      await testDbConnection(params())
      setStatus({ kind: 'tested-ok' })
    } catch (error) {
      setStatus({ kind: 'error', message: describeError(error) })
    }
  }

  const save = async () => {
    if (!(await ensureDriver())) {
      return
    }

    triggerHaptic('tap')
    const ok = await addDbConnection(params())

    if (ok) {
      close()
    } else {
      setStatus({ kind: 'error', message: d.connectionFailed })
    }
  }

  const pickFile = async () => {
    const selected = await selectDesktopPaths({
      filters: [{ extensions: ['db', 'sqlite', 'sqlite3', 'db3'], name: 'SQLite databases' }],
      multiple: false,
      title: d.openDatabase
    })

    if (selected?.[0]) {
      setFile(selected[0])

      if (!name) {
        setName(selected[0].split(/[\\/]+/).filter(Boolean).pop() ?? '')
      }
    }
  }

  const canSubmit = engine === 'sqlite' ? Boolean(file) : Boolean(database && host)

  return (
    <Dialog onOpenChange={value => !value && close()} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{d.newConnection}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field label={d.engine}>
            <Select onValueChange={value => setEngine(value as DbEngine)} value={engine}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sqlite">SQLite</SelectItem>
                <SelectItem value="mysql">MySQL / MariaDB</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label={d.connectionName}>
            <Input className="h-8" onChange={e => setName(e.target.value)} placeholder={d.optional} value={name} />
          </Field>

          {engine === 'sqlite' ? (
            <Field label={d.file}>
              <div className="flex gap-1.5">
                <Input className="h-8 flex-1" onChange={e => setFile(e.target.value)} value={file} />
                <Button onClick={() => void pickFile()} size="sm" type="button" variant="secondary">
                  <Codicon name="folder-opened" size="0.875rem" />
                </Button>
              </div>
            </Field>
          ) : (
            <>
              <div className="flex gap-2">
                <Field className="flex-1" label={d.host}>
                  <Input className="h-8" onChange={e => setHost(e.target.value)} value={host} />
                </Field>
                <Field className="w-24" label={d.port}>
                  <Input className="h-8" onChange={e => setPort(e.target.value)} value={port} />
                </Field>
              </div>
              <Field label={d.databaseField}>
                <Input className="h-8" onChange={e => setDatabase(e.target.value)} value={database} />
              </Field>
              <div className="flex gap-2">
                <Field className="flex-1" label={d.user}>
                  <Input className="h-8" onChange={e => setUser(e.target.value)} value={user} />
                </Field>
                <Field className="flex-1" label={d.password}>
                  <Input
                    className="h-8"
                    onChange={e => setPassword(e.target.value)}
                    type="password"
                    value={password}
                  />
                </Field>
              </div>
            </>
          )}

          {/* Status line */}
          {status.kind === 'driver-missing' && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[0.7rem] text-amber-700 dark:text-amber-400">
              <Codicon name="warning" size="0.875rem" />
              <span className="flex-1">{d.driverMissing(status.pkg)}</span>
              <Button onClick={() => void install()} size="xs" type="button" variant="secondary">
                {d.installDriver}
              </Button>
            </div>
          )}
          {status.kind === 'installing' && (
            <div className="flex items-center gap-2 px-2 text-[0.7rem] text-(--ui-text-tertiary)">
              <Loader className="size-3.5" type="spiral-search" />
              {d.installingDriver}
            </div>
          )}
          {status.kind === 'tested-ok' && (
            <div className="flex items-center gap-1.5 px-2 text-[0.7rem] text-emerald-600 dark:text-emerald-400">
              <Codicon name="check" size="0.875rem" />
              {d.testOk}
            </div>
          )}
          {status.kind === 'error' && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 font-mono text-[0.7rem] text-destructive">
              {status.message}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={close} type="button" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button
            disabled={!canSubmit || status.kind === 'testing'}
            onClick={() => void test()}
            type="button"
            variant="secondary"
          >
            {status.kind === 'testing' ? <Loader className="size-3.5" type="spiral-search" /> : null}
            {d.testConnection}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void save()} type="button">
            {d.addConnection}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ children, className, label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <label className={className}>
      <span className="mb-0.5 block text-[0.66rem] font-medium text-(--ui-text-tertiary)">{label}</span>
      {children}
    </label>
  )
}
