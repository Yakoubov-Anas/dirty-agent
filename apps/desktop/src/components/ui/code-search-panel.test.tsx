import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const findNext = vi.fn()
const findPrevious = vi.fn()
const closeSearchPanel = vi.fn()
const openSearchPanel = vi.fn()
let searchOpen = false
const searchPanelOpen = vi.fn((..._args: unknown[]) => searchOpen)
const replaceNext = vi.fn()
const replaceAll = vi.fn()
const setSearchQueryOf = vi.fn((q: unknown) => ({ effect: q }))
// Tracks the last query handed to setSearchQuery so getSearchQuery can reflect
// it (the real module stores it in editor state). Lets the count logic see a
// non-empty query + a controllable match list.
let lastQuery: FakeSearchQuery | null = null
let fakeMatches: Array<{ from: number; to: number }> = []

class FakeSearchQuery {
  search: string
  caseSensitive: boolean
  regexp: boolean
  wholeWord: boolean
  replace: string
  constructor(cfg: { search: string; caseSensitive?: boolean; regexp?: boolean; wholeWord?: boolean; replace?: string }) {
    this.search = cfg.search
    this.caseSensitive = cfg.caseSensitive ?? false
    this.regexp = cfg.regexp ?? false
    this.wholeWord = cfg.wholeWord ?? false
    this.replace = cfg.replace ?? ''
  }

  get valid() {
    return this.search.length > 0
  }

  getCursor() {
    return fakeMatches[Symbol.iterator]()
  }
}

vi.mock('@codemirror/search', () => ({
  closeSearchPanel: (...args: unknown[]) => closeSearchPanel(...args),
  findNext: (...args: unknown[]) => findNext(...args),
  findPrevious: (...args: unknown[]) => findPrevious(...args),
  getSearchQuery: () => lastQuery ?? new FakeSearchQuery({ search: '' }),
  openSearchPanel: (...args: unknown[]) => openSearchPanel(...args),
  replaceAll: (...args: unknown[]) => replaceAll(...args),
  replaceNext: (...args: unknown[]) => replaceNext(...args),
  SearchQuery: FakeSearchQuery,
  searchPanelOpen: (...args: unknown[]) => searchPanelOpen(...args),
  setSearchQuery: {
    of: (q: unknown) => {
      lastQuery = q as FakeSearchQuery

      return setSearchQueryOf(q)
    }
  }
}))

// The panel is exported indirectly via createReactSearchPanel; import the file
// after mocks are registered so the mocked search module is used.
const { createReactSearchPanel, openReplacePanel } = await import('./code-search-panel')

interface FakeView {
  dispatch: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  state: { selection: { main: { from: number } } }
}

function mountPanel() {
  const view: FakeView = {
    dispatch: vi.fn(),
    focus: vi.fn(),
    state: { selection: { main: { from: 0 } } }
  }

  const panel = createReactSearchPanel(view as never)
  document.body.appendChild(panel.dom)
  act(() => {
    panel.mount?.()
  })

  return { panel, view }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  document.body.innerHTML = ''
  lastQuery = null
  fakeMatches = []
  searchOpen = false
})

describe('createReactSearchPanel', () => {
  it('renders find input, toggles and next/prev/close controls', () => {
    mountPanel()

    expect(screen.getByLabelText('Find')).toBeTruthy()
    expect(screen.getByText('Match case')).toBeTruthy()
    expect(screen.getByText('Whole word')).toBeTruthy()
    expect(screen.getByText('Regex')).toBeTruthy()
    expect(screen.getByLabelText('Next match')).toBeTruthy()
    expect(screen.getByLabelText('Previous match')).toBeTruthy()
    expect(screen.getByLabelText('Close')).toBeTruthy()
  })

  it('pushes the search query into the editor as the user types', () => {
    const { view } = mountPanel()

    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'hello' } })

    expect(setSearchQueryOf).toHaveBeenCalled()
    const query = setSearchQueryOf.mock.calls.at(-1)?.[0] as FakeSearchQuery
    expect(query.search).toBe('hello')
    expect(view.dispatch).toHaveBeenCalled()
  })

  it('shows the match count (current/total) and "No results" when empty', () => {
    fakeMatches = [
      { from: 0, to: 5 },
      { from: 10, to: 15 },
      { from: 20, to: 25 }
    ]
    mountPanel()

    // Cursor at position 0 → first match is current → "1/3".
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'foo' } })
    expect(screen.getByTestId('search-count').textContent).toBe('1/3')

    // A query with no matches shows "No results".
    fakeMatches = []
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('search-count').textContent).toBe('No results')
  })

  it('runs next / previous / close commands', () => {
    const { view } = mountPanel()

    fireEvent.click(screen.getByLabelText('Next match'))
    expect(findNext).toHaveBeenCalledWith(view)

    fireEvent.click(screen.getByLabelText('Previous match'))
    expect(findPrevious).toHaveBeenCalledWith(view)

    fireEvent.click(screen.getByLabelText('Close'))
    expect(closeSearchPanel).toHaveBeenCalledWith(view)
    expect(view.focus).toHaveBeenCalled()
  })

  it('reveals replace controls and runs replace / replace-all', () => {
    const { view } = mountPanel()

    fireEvent.click(screen.getByLabelText('Show replace'))

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    expect(replaceNext).toHaveBeenCalledWith(view)

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(replaceAll).toHaveBeenCalledWith(view)
  })

  it('openReplacePanel opens the panel with the replace row expanded', () => {
    searchOpen = false
    const view = { dispatch: vi.fn(), focus: vi.fn(), state: { selection: { main: { from: 0 } } } }

    openReplacePanel(view as never)
    expect(openSearchPanel).toHaveBeenCalledWith(view)

    // Mount the panel the way CodeMirror would after openSearchPanel — the
    // replace input should already be visible (openWithReplace honored).
    const panel = createReactSearchPanel(view as never)
    document.body.appendChild(panel.dom)
    act(() => {
      panel.mount?.()
    })

    expect(screen.getByLabelText('Replace')).toBeTruthy()
  })
})
