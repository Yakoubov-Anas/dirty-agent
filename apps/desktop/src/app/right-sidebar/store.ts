import { atom } from 'nanostores'

import { TERMINAL_PANE_ID } from '@/store/layout'
import { $paneOpen, setPaneOpen } from '@/store/panes'

// The console is a JetBrains-style tool window: its open state lives in the
// shared pane store (so the edge stripe toggle + relocation work like every
// other panel). These keep the historic terminal-takeover API as a thin alias.
export const $terminalTakeover = $paneOpen(TERMINAL_PANE_ID)

export const setTerminalTakeover = (active: boolean) => setPaneOpen(TERMINAL_PANE_ID, active)

/** A command queued to run in the embedded terminal. The terminal pane flushes
 *  (and clears) it once its session is live, so a value set before the pane
 *  mounts still runs. Cleared after flush so a later remount can't replay it. */
export const $terminalInjection = atom<null | string>(null)

/** Open the terminal pane and run a command in it. Used to disconnect external
 *  (CLI-managed) providers, which Hermes can't clear via the API — the user
 *  sees exactly what runs instead of Hermes silently deleting their creds. */
export const runInTerminal = (command: string) => {
  const trimmed = command.trim()

  if (!trimmed) {
    return
  }

  setTerminalTakeover(true)
  $terminalInjection.set(trimmed)
}
