import { atom } from 'nanostores'

export interface TerminalTab {
  id: string
  title: string
}

let counter = 0

const nextId = () => `term-${Date.now().toString(36)}-${(counter++).toString(36)}`

// JetBrains names console tabs "Local", "Local (2)", … — the index drives the
// suffix so reopening a freed slot still reads naturally.
function makeTab(index: number): TerminalTab {
  return { id: nextId(), title: index === 0 ? 'Local' : `Local (${index + 1})` }
}

const initialTab = makeTab(0)

export const $terminalTabs = atom<TerminalTab[]>([initialTab])
export const $activeTerminalTabId = atom<string>(initialTab.id)

export function selectTerminalTab(id: string) {
  if ($terminalTabs.get().some(tab => tab.id === id)) {
    $activeTerminalTabId.set(id)
  }
}

export function addTerminalTab(): string {
  const tabs = $terminalTabs.get()
  const tab = makeTab(tabs.length)

  $terminalTabs.set([...tabs, tab])
  $activeTerminalTabId.set(tab.id)

  return tab.id
}

// Removes a tab. Returns false when it was the last one (the caller decides
// whether to hide the console instead of leaving it empty).
export function closeTerminalTab(id: string): boolean {
  const tabs = $terminalTabs.get()

  if (tabs.length <= 1) {
    return false
  }

  const index = tabs.findIndex(tab => tab.id === id)

  if (index === -1) {
    return true
  }

  const next = tabs.filter(tab => tab.id !== id)

  $terminalTabs.set(next)

  if ($activeTerminalTabId.get() === id) {
    $activeTerminalTabId.set(next[Math.max(0, index - 1)].id)
  }

  return true
}
