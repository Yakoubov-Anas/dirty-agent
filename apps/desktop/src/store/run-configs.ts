import { atom, computed } from 'nanostores'

import { $currentCwd } from '@/store/session'

const RUN_CONFIGS_STORAGE_KEY = 'hermes.desktop.runConfigs.v1'
const MAX_OUTPUT_LINES = 5000

// A JetBrains-style run configuration: a named shell command, optionally with a
// working-directory override and extra environment. `command` is run through the
// platform shell, so `npm test`, `pytest -q`, etc. work verbatim.
export interface RunConfig {
  id: string
  name: string
  command: string
  cwd?: string
  env?: Record<string, string>
}

export type RunStatus = 'idle' | 'running' | 'exited' | 'stopped' | 'failed'
export type RunStream = 'stdout' | 'stderr' | 'system'

export interface RunLine {
  id: number
  stream: RunStream
  text: string
}

export interface RunState {
  configId: string | null
  configName: string
  status: RunStatus
  exitCode: number | null
  lines: RunLine[]
  runId: string | null
  startedAt: number | null
  endedAt: number | null
}

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────

// Configs are stored per workspace directory (JetBrains-like: each project has
// its own set). Empty cwd falls back to a shared bucket.
export function cwdKey(cwd: string): string {
  return cwd.trim() || '__global__'
}

export function createRunConfig(partial: Partial<RunConfig> = {}): RunConfig {
  return {
    id: partial.id || `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: partial.name?.trim() || 'New configuration',
    command: partial.command ?? '',
    ...(partial.cwd?.trim() ? { cwd: partial.cwd.trim() } : {}),
    ...(partial.env && Object.keys(partial.env).length ? { env: partial.env } : {})
  }
}

export function upsertRunConfig(list: RunConfig[], config: RunConfig): RunConfig[] {
  const index = list.findIndex(c => c.id === config.id)

  if (index < 0) {
    return [...list, config]
  }

  const next = [...list]
  next[index] = config

  return next
}

export function removeRunConfigFrom(list: RunConfig[], id: string): RunConfig[] {
  return list.filter(c => c.id !== id)
}

// "KEY=value" lines ⇄ a record. Blank lines and lines without '=' are ignored;
// the first '=' splits key from value so values may contain '='.
export function parseEnvText(text: string): Record<string, string> {
  const env: Record<string, string> = {}

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) {
      continue
    }

    const eq = line.indexOf('=')

    if (eq <= 0) {
      continue
    }

    const key = line.slice(0, eq).trim()

    if (key) {
      env[key] = line.slice(eq + 1).trim()
    }
  }

  return env
}

export function formatEnvText(env: Record<string, string> | undefined): string {
  if (!env) {
    return ''
  }

  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

export function appendRunLines(lines: RunLine[], stream: RunStream, chunk: string, nextId: number): RunLine[] {
  const parts = chunk.split('\n')
  const added: RunLine[] = []

  for (let i = 0; i < parts.length; i++) {
    // A trailing '' from a chunk ending in '\n' shouldn't create a blank line.
    if (i === parts.length - 1 && parts[i] === '') {
      break
    }

    added.push({ id: nextId + i, stream, text: parts[i] })
  }

  const combined = [...lines, ...added]

  return combined.length > MAX_OUTPUT_LINES ? combined.slice(combined.length - MAX_OUTPUT_LINES) : combined
}

// ─── Persistence ────────────────────────────────────────────────────────────

function isRunConfig(value: unknown): value is RunConfig {
  if (!value || typeof value !== 'object') {
    return false
  }

  const r = value as Record<string, unknown>

  return typeof r.id === 'string' && typeof r.name === 'string' && typeof r.command === 'string'
}

function loadAll(): Record<string, RunConfig[]> {
  try {
    const raw = window.localStorage.getItem(RUN_CONFIGS_STORAGE_KEY)

    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as unknown

    if (!parsed || typeof parsed !== 'object') {
      return {}
    }

    const out: Record<string, RunConfig[]> = {}

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        out[key] = value.filter(isRunConfig)
      }
    }

    return out
  } catch {
    return {}
  }
}

// Record of cwdKey → configs. The widget/pane read the slice for the active cwd.
export const $runConfigStore = atom<Record<string, RunConfig[]>>(typeof window === 'undefined' ? {} : loadAll())

$runConfigStore.subscribe(store => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(RUN_CONFIGS_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Best-effort.
  }
})

// Configs for the active workspace.
export const $runConfigs = computed([$runConfigStore, $currentCwd], (store, cwd) => store[cwdKey(cwd)] ?? [])

const SELECTED_STORAGE_KEY = 'hermes.desktop.runConfigs.selected'

export const $selectedRunConfigId = atom<string>(
  typeof window === 'undefined' ? '' : window.localStorage.getItem(SELECTED_STORAGE_KEY) || ''
)

$selectedRunConfigId.subscribe(id => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (id) {
      window.localStorage.setItem(SELECTED_STORAGE_KEY, id)
    } else {
      window.localStorage.removeItem(SELECTED_STORAGE_KEY)
    }
  } catch {
    // Best-effort.
  }
})

// The selected config, falling back to the first available so the widget always
// has something to run once configs exist.
export const $selectedRunConfig = computed(
  [$runConfigs, $selectedRunConfigId],
  (configs, selectedId) => configs.find(c => c.id === selectedId) ?? configs[0] ?? null
)

// ─── Mutations ──────────────────────────────────────────────────────────────

function setConfigsForCwd(cwd: string, next: RunConfig[]) {
  const key = cwdKey(cwd)
  const store = $runConfigStore.get()

  if (next.length === 0) {
    if (!(key in store)) {
      return
    }

    const { [key]: _dropped, ...rest } = store
    $runConfigStore.set(rest)

    return
  }

  $runConfigStore.set({ ...store, [key]: next })
}

export function saveRunConfig(config: RunConfig) {
  const cwd = $currentCwd.get()
  setConfigsForCwd(cwd, upsertRunConfig($runConfigs.get(), config))
  $selectedRunConfigId.set(config.id)
}

export function deleteRunConfig(id: string) {
  const cwd = $currentCwd.get()
  setConfigsForCwd(cwd, removeRunConfigFrom($runConfigs.get(), id))

  if ($selectedRunConfigId.get() === id) {
    $selectedRunConfigId.set('')
  }
}

export function selectRunConfig(id: string) {
  $selectedRunConfigId.set(id)
}

// ─── Run state + orchestration ──────────────────────────────────────────────

const IDLE_RUN_STATE: RunState = {
  configId: null,
  configName: '',
  status: 'idle',
  exitCode: null,
  lines: [],
  runId: null,
  startedAt: null,
  endedAt: null
}

export const $runState = atom<RunState>({ ...IDLE_RUN_STATE })

let lineCounter = 0
let activeUnsubscribers: Array<() => void> = []

function teardownRunListeners() {
  for (const off of activeUnsubscribers) {
    try {
      off()
    } catch {
      // ignore
    }
  }

  activeUnsubscribers = []
}

function appendLine(stream: RunStream, chunk: string) {
  const state = $runState.get()
  const lines = appendRunLines(state.lines, stream, chunk, lineCounter)
  lineCounter += lines.length - state.lines.length + 1
  $runState.set({ ...state, lines })
}

export function clearRunOutput() {
  $runState.set({ ...$runState.get(), lines: [] })
}

// Start a run config. The actual process spawns in the Electron main process;
// we stream its output into $runState. Returns the run id (or null if the
// bridge is unavailable). The caller opens the Run results panel.
export async function startRun(config: RunConfig, projectCwd: string): Promise<string | null> {
  const runApi = window.hermesDesktop?.run

  if (!runApi) {
    $runState.set({
      ...IDLE_RUN_STATE,
      configId: config.id,
      configName: config.name,
      status: 'failed',
      lines: [{ id: 0, stream: 'system', text: 'Run is only available in the desktop app.' }],
      endedAt: Date.now()
    })

    return null
  }

  // Stop any in-flight run before starting a new one.
  await stopRun()
  teardownRunListeners()
  lineCounter = 1

  const cwd = config.cwd?.trim() || projectCwd.trim() || undefined

  $runState.set({
    configId: config.id,
    configName: config.name,
    status: 'running',
    exitCode: null,
    lines: [{ id: 0, stream: 'system', text: `$ ${config.command}` }],
    runId: null,
    startedAt: Date.now(),
    endedAt: null
  })

  try {
    const { id } = await runApi.start({ command: config.command, cwd, env: config.env })

    $runState.set({ ...$runState.get(), runId: id })

    activeUnsubscribers.push(
      runApi.onData(id, payload => appendLine(payload.stream === 'stderr' ? 'stderr' : 'stdout', payload.chunk)),
      runApi.onExit(id, payload => {
        const state = $runState.get()
        const status: RunStatus = state.status === 'stopped' ? 'stopped' : payload.code === 0 ? 'exited' : 'failed'

        $runState.set({
          ...state,
          status,
          exitCode: payload.code,
          endedAt: Date.now()
        })
        teardownRunListeners()
      })
    )

    return id
  } catch (error) {
    $runState.set({
      ...$runState.get(),
      status: 'failed',
      lines: appendRunLines(
        $runState.get().lines,
        'system',
        error instanceof Error ? error.message : String(error),
        lineCounter
      ),
      endedAt: Date.now()
    })

    return null
  }
}

export async function stopRun() {
  const state = $runState.get()

  if (state.status !== 'running' || !state.runId) {
    return
  }

  // Mark stopped first so onExit classifies it as a user stop, not a failure.
  $runState.set({ ...state, status: 'stopped' })

  try {
    await window.hermesDesktop?.run?.stop(state.runId)
  } catch {
    // The process may already be gone.
  }
}
