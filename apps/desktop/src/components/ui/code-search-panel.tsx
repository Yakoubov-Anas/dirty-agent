import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  searchPanelOpen,
  SearchQuery,
  setSearchQuery
} from '@codemirror/search'
import { type EditorView } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'

interface SearchPanelProps {
  view: EditorView
  initialFocusRef: React.MutableRefObject<(() => void) | null>
}

// Set when the panel is opened via the replace command (Ctrl/Cmd+R) so the
// panel mounts with the Replace row already expanded. Consumed once on mount.
let openWithReplace = false

// React search/replace panel for the CodeMirror editor, built from the app's
// own Button / Checkbox / Input so it matches the rest of the UI (font,
// checkboxes, buttons) — unlike the @codemirror/search default panel.
function SearchPanel({ view, initialFocusRef }: SearchPanelProps) {
  const existing = getSearchQuery(view.state)
  const [search, setSearch] = useState(existing.search)
  const [replace, setReplace] = useState(existing.replace)
  const [caseSensitive, setCaseSensitive] = useState(existing.caseSensitive)
  const [regexp, setRegexp] = useState(existing.regexp)
  const [wholeWord, setWholeWord] = useState(existing.wholeWord)
  const [showReplace, setShowReplace] = useState(openWithReplace)
  const [matches, setMatches] = useState<{ current: number; total: number }>({ current: 0, total: 0 })
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Count all matches of the active query and which one (1-based) the primary
  // selection currently sits on. Called after every panel action (typing,
  // toggling options, find next/prev) so the "N of M" indicator stays current.
  const recount = () => {
    const query = getSearchQuery(view.state)

    if (!query.search || !query.valid) {
      setMatches({ current: 0, total: 0 })

      return
    }

    const head = view.state.selection.main.from
    let total = 0
    let current = 0

    try {
      const cursor = query.getCursor(view.state)

      for (let step = cursor.next(); !step.done; step = cursor.next()) {
        total += 1

        // The "current" match is the first one at/after the selection head.
        if (current === 0 && step.value.from >= head) {
          current = total
        }
      }
    } catch {
      setMatches({ current: 0, total: 0 })

      return
    }

    // Selection past the last match → wrap the indicator to the last match.
    if (current === 0 && total > 0) {
      current = total
    }

    setMatches({ current, total })
  }

  // Push the current field state into the editor's search state.
  const commit = (next?: Partial<{ caseSensitive: boolean; regexp: boolean; search: string; wholeWord: boolean }>) => {
    const query = new SearchQuery({
      caseSensitive: next?.caseSensitive ?? caseSensitive,
      regexp: next?.regexp ?? regexp,
      replace,
      search: next?.search ?? search,
      wholeWord: next?.wholeWord ?? wholeWord
    })

    view.dispatch({ effects: setSearchQuery.of(query) })
    recount()
  }

  // Find next/previous, then refresh the match indicator.
  const goNext = () => {
    findNext(view)
    recount()
  }

  const goPrevious = () => {
    findPrevious(view)
    recount()
  }

  // Recount once on mount in case a query was already active when the panel
  // opened (repeated Ctrl+F, or opened from an existing selection).
  useEffect(() => {
    recount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Let the panel host focus the field after mount / on repeated Ctrl+F.
  useEffect(() => {
    initialFocusRef.current = () => {
      const el = searchRef.current

      if (el) {
        el.focus()
        el.select()
      }
    }

    initialFocusRef.current()

    return () => {
      initialFocusRef.current = null
    }
  }, [initialFocusRef])

  const onSearchChange = (value: string) => {
    setSearch(value)
    commit({ search: value })
  }

  const toggle = (key: 'caseSensitive' | 'regexp' | 'wholeWord', value: boolean) => {
    if (key === 'caseSensitive') {
      setCaseSensitive(value)
    } else if (key === 'regexp') {
      setRegexp(value)
    } else {
      setWholeWord(value)
    }

    commit({ [key]: value })
    searchRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()

      if (event.shiftKey) {
        goPrevious()
      } else {
        goNext()
      }

      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeSearchPanel(view)
      view.focus()
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-border bg-background px-2.5 py-2 text-xs" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-1.5">
        <Button
          aria-label={showReplace ? 'Hide replace' : 'Show replace'}
          className="size-6 p-0"
          onClick={() => setShowReplace(v => !v)}
          size="xs"
          type="button"
          variant="ghost"
        >
          <Codicon name={showReplace ? 'chevron-down' : 'chevron-right'} size="0.875rem" />
        </Button>
        <Input
          aria-label="Find"
          className="h-7 flex-1"
          onChange={event => onSearchChange(event.target.value)}
          placeholder="Find"
          ref={searchRef}
          value={search}
        />
        <span className="min-w-12 shrink-0 text-right tabular-nums text-[0.6875rem] text-muted-foreground" data-testid="search-count">
          {search ? (matches.total === 0 ? 'No results' : `${matches.current}/${matches.total}`) : ''}
        </span>
        <Button aria-label="Previous match" className="size-7 p-0" onClick={goPrevious} size="xs" type="button" variant="secondary">
          <Codicon name="arrow-up" size="0.875rem" />
        </Button>
        <Button aria-label="Next match" className="size-7 p-0" onClick={goNext} size="xs" type="button" variant="secondary">
          <Codicon name="arrow-down" size="0.875rem" />
        </Button>
        <Button
          aria-label="Close"
          className="size-7 p-0"
          onClick={() => {
            closeSearchPanel(view)
            view.focus()
          }}
          size="xs"
          type="button"
          variant="ghost"
        >
          <Codicon name="close" size="0.875rem" />
        </Button>
      </div>

      <div className="flex items-center gap-3 pl-8 text-[0.6875rem] text-muted-foreground">
        <label className="flex cursor-pointer items-center gap-1.5">
          <Checkbox checked={caseSensitive} onCheckedChange={value => toggle('caseSensitive', value === true)} />
          <span>Match case</span>
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <Checkbox checked={wholeWord} onCheckedChange={value => toggle('wholeWord', value === true)} />
          <span>Whole word</span>
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <Checkbox checked={regexp} onCheckedChange={value => toggle('regexp', value === true)} />
          <span>Regex</span>
        </label>
      </div>

      {showReplace && (
        <div className="flex items-center gap-1.5 pl-8">
          <Input
            aria-label="Replace"
            className="h-7 flex-1"
            onChange={event => {
              setReplace(event.target.value)
              view.dispatch({
                effects: setSearchQuery.of(
                  new SearchQuery({ caseSensitive, regexp, replace: event.target.value, search, wholeWord })
                )
              })
            }}
            placeholder="Replace"
            value={replace}
          />
          <Button className="h-7" onClick={() => { replaceNext(view); recount() }} size="xs" type="button" variant="secondary">
            Replace
          </Button>
          <Button className="h-7" onClick={() => { replaceAll(view); recount() }} size="xs" type="button" variant="secondary">
            All
          </Button>
        </div>
      )}
    </div>
  )
}

// CodeMirror panel factory: mounts the React SearchPanel into the panel's DOM
// host. The `mount` hook re-focuses the field each time the panel opens (a
// repeated Ctrl+F), matching the default search behavior.
export function createReactSearchPanel(view: EditorView) {
  const dom = document.createElement('div')
  dom.className = 'cm-react-search-panel'
  const focusRef: React.MutableRefObject<(() => void) | null> = { current: null }
  let root: Root | null = null

  return {
    dom,
    mount() {
      root = createRoot(dom)
      root.render(<SearchPanel initialFocusRef={focusRef} view={view} />)
    },
    destroy() {
      // Defer unmount out of CodeMirror's update cycle — React forbids
      // unmounting a root synchronously from inside a render/commit.
      const toUnmount = root
      root = null
      queueMicrotask(() => toUnmount?.unmount())
    }
  }
}

// Open the search panel with the Replace row expanded (Ctrl/Cmd+R). If the
// panel is already open, just reveal replace and keep focus there.
export function openReplacePanel(view: EditorView): boolean {
  openWithReplace = true

  if (searchPanelOpen(view.state)) {
    // Already open: re-mount so the Replace row shows. Toggle closed→open in one
    // microtask so the panel rebuilds with openWithReplace honored.
    closeSearchPanel(view)
    queueMicrotask(() => {
      openSearchPanel(view)
      openWithReplace = false
    })

    return true
  }

  openSearchPanel(view)
  // The panel reads openWithReplace synchronously on mount; clear it next tick.
  queueMicrotask(() => {
    openWithReplace = false
  })

  return true
}
