import { beforeEach, describe, expect, it } from 'vitest'

// Ensure a clean localStorage so loadBindings() uses shipped defaults.
beforeEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    /* jsdom always has localStorage */
  }
})

describe('keybind combo index', () => {
  it('maps Ctrl/Cmd+Shift+F to find.inFiles and +R to find.replaceInFiles', async () => {
    const { $comboIndex } = await import('@/store/keybinds')
    const { canonicalizeCombo } = await import('@/lib/keybinds/combo')

    const index = $comboIndex.get()
    expect(index.get(canonicalizeCombo('mod+shift+f'))).toBe('find.inFiles')
    expect(index.get(canonicalizeCombo('mod+shift+r'))).toBe('find.replaceInFiles')
  })

  it('does not leave session.focusSearch on Ctrl+Shift+F', async () => {
    const { $comboIndex } = await import('@/store/keybinds')
    const { canonicalizeCombo } = await import('@/lib/keybinds/combo')

    expect($comboIndex.get().get(canonicalizeCombo('mod+shift+f'))).not.toBe('session.focusSearch')
  })
})
