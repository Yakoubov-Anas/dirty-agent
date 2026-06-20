import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { filePathForTarget } from '@/app/chat/right-rail/preview-file'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import {
  type FileSearchFile,
  type FileSearchResult,
  replaceDesktopFiles,
  searchDesktopFiles
} from '@/lib/desktop-fs'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import {
  $findInFiles,
  $findInFilesSession,
  closeFindInFiles,
  saveFindInFilesSession,
  setFindInFilesMode
} from '@/store/find-in-files'
import { notify, notifyError } from '@/store/notifications'
import { requestEditorReveal, setCurrentSessionPreviewTarget } from '@/store/preview'
import { $currentCwd } from '@/store/session'

const SEARCH_DEBOUNCE_MS = 250
// Upper bound on match rows rendered at once — keeps a big result set from
// stalling the dialog on open. Excess is summarized in a footer.
const MAX_RENDERED_ROWS = 100

// Stable signature of the inputs that affect a search result. Used to skip
// refetching when reopening with unchanged params.
function searchKey(p: { query: string; caseSensitive: boolean; wholeWord: boolean; regexp: boolean }): string {
  return `${p.caseSensitive ? 1 : 0}${p.wholeWord ? 1 : 0}${p.regexp ? 1 : 0}\u0000${p.query}`
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/)

  return parts[parts.length - 1] || path
}

function dirname(path: string): string {
  const parts = path.split(/[\\/]/)
  parts.pop()

  return parts.join('/')
}

export function FindInFilesDialog() {
  const { open, mode } = useStore($findInFiles)
  const cwd = useStore($currentCwd)

  // Seed from the persisted session so reopening shows the previous search
  // immediately (no refetch flash).
  const saved = $findInFilesSession.get()
  const [query, setQuery] = useState(saved.query)
  const [replacement, setReplacement] = useState(saved.replacement)
  const [caseSensitive, setCaseSensitive] = useState(saved.caseSensitive)
  const [wholeWord, setWholeWord] = useState(saved.wholeWord)
  const [regexp, setRegexp] = useState(saved.regexp)
  const [result, setResult] = useState<FileSearchResult | null>(saved.result)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [replacing, setReplacing] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // When true, render every match row instead of capping at MAX_RENDERED_ROWS.
  const [showAll, setShowAll] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)
  // Signature of the params the current `result` was fetched for. The effect
  // skips refetching when nothing relevant changed (reopen, focus toggles,
  // remount with a persisted result) so reopening is instant.
  const lastSearchKey = useRef(saved.result ? searchKey(saved) : null)

  // Focus the query field whenever the dialog opens.
  useEffect(() => {
    if (open) {
      // rAF so the element is mounted before we focus/select.
      requestAnimationFrame(() => {
        searchRef.current?.focus()
        searchRef.current?.select()
      })
    }
  }, [open])

  // Debounced project-wide search whenever the query or options change.
  useEffect(() => {
    if (!open) {
      return
    }

    if (!query) {
      setResult(null)
      setError(null)
      setLoading(false)

      return
    }

    // Already have results for these exact params (reopen, focus toggle,
    // remount) — keep them, don't refetch.
    if (lastSearchKey.current === searchKey({ caseSensitive, query, regexp, wholeWord })) {
      setLoading(false)

      return
    }

    let cancelled = false
    setLoading(true)

    const handle = window.setTimeout(async () => {
      try {
        const res = await searchDesktopFiles({
          caseSensitive,
          query,
          regexp,
          root: cwd || undefined,
          wholeWord
        })

        if (!cancelled) {
          setResult(res)
          setError(null)
          setShowAll(false)
          lastSearchKey.current = searchKey({ caseSensitive, query, regexp, wholeWord })
        }
      } catch (err) {
        if (!cancelled) {
          setResult(null)
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [open, query, caseSensitive, wholeWord, regexp, cwd])

  // Persist the form + results so the next open restores them instantly.
  useEffect(() => {
    saveFindInFilesSession({ caseSensitive, query, regexp, replacement, result, wholeWord })
  }, [query, replacement, caseSensitive, wholeWord, regexp, result])

  const fileCount = result?.files.length ?? 0
  const matchCount = result?.total ?? 0

  // Cap how many match rows we actually render. The result set can hold up to
  // 2000 matches; building that many DOM nodes is what made the dialog slow to
  // appear. Respect per-file collapse and stop once the row budget is spent.
  const visibleFiles = useMemo(() => {
    if (!result) {
      return []
    }

    let budget = showAll ? Number.POSITIVE_INFINITY : MAX_RENDERED_ROWS
    const out: Array<{ file: FileSearchFile; shown: FileSearchFile['matches'] }> = []

    for (const file of result.files) {
      if (budget <= 0) {
        break
      }

      const isCollapsed = collapsed.has(file.path)
      const shown = isCollapsed ? [] : file.matches.slice(0, budget)
      budget -= shown.length
      out.push({ file, shown })
    }

    return out
  }, [result, collapsed, showAll])

  const renderedRows = visibleFiles.reduce((sum, f) => sum + f.shown.length, 0)
  const hiddenRows = matchCount - renderedRows

  const openResult = async (file: FileSearchFile, line: number, column: number) => {
    try {
      const preview = await normalizeOrLocalPreviewTarget(file.path, cwd || undefined)

      if (!preview) {
        throw new Error(`Could not open ${file.path}`)
      }

      setCurrentSessionPreviewTarget(preview, 'file-browser', file.path)
      requestEditorReveal({ column, line, path: filePathForTarget(preview) })
      closeFindInFiles()
    } catch (err) {
      notifyError(err, 'Could not open file')
    }
  }

  const runReplaceAll = async () => {
    if (!result || replacing || !query) {
      return
    }

    setReplacing(true)

    try {
      const res = await replaceDesktopFiles({
        caseSensitive,
        files: result.files.map(f => f.path),
        query,
        regexp,
        replace: replacement,
        root: cwd || undefined,
        wholeWord
      })

      // Re-run the search so the result list reflects the post-replace state.
      const refreshed = await searchDesktopFiles({ caseSensitive, query, regexp, root: cwd || undefined, wholeWord })
      setResult(refreshed)
      notify({
        kind: 'success',
        message: `Replaced ${res.replacements} occurrence${res.replacements === 1 ? '' : 's'} in ${res.filesChanged} file${res.filesChanged === 1 ? '' : 's'}`
      })
    } catch (err) {
      notifyError(err, 'Replace failed')
    } finally {
      setReplacing(false)
    }
  }

  const toggleCollapsed = (path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)

      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }

      return next
    })
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeFindInFiles()
    }
  }

  const headerCount = useMemo(() => {
    if (loading) {
      return null
    }

    if (!query) {
      return ''
    }

    if (matchCount === 0) {
      return 'No results'
    }

    return `${matchCount} result${matchCount === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}${result?.truncated ? '+' : ''}`
  }, [loading, query, matchCount, fileCount, result?.truncated])

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-1200 flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
      onClick={closeFindInFiles}
      onKeyDown={onKeyDown}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-(--stroke-nous) bg-(--ui-chat-bubble-background) shadow-nous"
        onClick={event => event.stopPropagation()}
      >
        {/* Inputs + options */}
        <div className="flex flex-col gap-2 border-b border-border/60 p-3">
          <div className="flex items-center gap-2">
            <Button
              aria-label={mode === 'replace' ? 'Hide replace' : 'Show replace'}
              className="size-7 shrink-0 p-0"
              onClick={() => setFindInFilesMode(mode === 'replace' ? 'find' : 'replace')}
              size="xs"
              type="button"
              variant="ghost"
            >
              <Codicon name={mode === 'replace' ? 'chevron-down' : 'chevron-right'} size="1rem" />
            </Button>
            <Input
              aria-label="Find in files"
              className="h-8 flex-1"
              onChange={event => setQuery(event.target.value)}
              placeholder="Find in files"
              ref={searchRef}
              value={query}
            />
            <Button
              aria-label="Close"
              className="size-8 shrink-0 p-0"
              onClick={closeFindInFiles}
              size="xs"
              type="button"
              variant="ghost"
            >
              <Codicon name="close" size="1rem" />
            </Button>
          </div>

          {mode === 'replace' && (
            <div className="flex items-center gap-2 pl-9">
              <Input
                aria-label="Replace with"
                className="h-8 flex-1"
                onChange={event => setReplacement(event.target.value)}
                placeholder="Replace with"
                value={replacement}
              />
              <Button
                className="h-8 shrink-0"
                disabled={replacing || !query || matchCount === 0}
                onClick={() => void runReplaceAll()}
                size="xs"
                type="button"
                variant="secondary"
              >
                {replacing ? 'Replacing…' : 'Replace All'}
              </Button>
            </div>
          )}

          <div className="flex items-center gap-3 pl-9 text-[0.6875rem] text-muted-foreground">
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox checked={caseSensitive} onCheckedChange={v => setCaseSensitive(v === true)} />
              <span>Match case</span>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox checked={wholeWord} onCheckedChange={v => setWholeWord(v === true)} />
              <span>Whole word</span>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox checked={regexp} onCheckedChange={v => setRegexp(v === true)} />
              <span>Regex</span>
            </label>
            <span className="ml-auto tabular-nums">
              {loading ? <Loader className="size-3.5" type="lemniscate-bloom" /> : headerCount}
            </span>
          </div>
        </div>

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-y-auto p-1 text-xs">
          {error && <div className="px-3 py-2 text-destructive">{error}</div>}
          {!error && query && !loading && matchCount === 0 && (
            <div className="px-3 py-6 text-center text-muted-foreground">No matches.</div>
          )}
          {visibleFiles.map(({ file, shown }) => {
            const isCollapsed = collapsed.has(file.path)

            return (
              <div className="mb-0.5" key={file.path}>
                <button
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-(--chrome-action-hover)"
                  onClick={() => toggleCollapsed(file.path)}
                  type="button"
                >
                  <Codicon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size="0.875rem" />
                  <span className="font-medium text-foreground">{basename(file.path)}</span>
                  <span className="min-w-0 truncate text-muted-foreground/70">{dirname(file.path)}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-(--ui-bg-quaternary) px-1.5 tabular-nums text-muted-foreground">
                    {file.matches.length}
                  </span>
                </button>
                {!isCollapsed &&
                  shown.map((match, index) => (
                    <button
                      className="flex w-full items-baseline gap-2 rounded px-2 py-0.5 pl-7 text-left font-mono hover:bg-(--chrome-action-hover)"
                      key={`${match.line}:${match.column}:${index}`}
                      onClick={() => void openResult(file, match.line, match.column)}
                      type="button"
                    >
                      <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground/60">{match.line}</span>
                      <span className="min-w-0 truncate text-foreground/90">
                        {renderPreview(match.preview, match.column, match.matchEnd)}
                      </span>
                    </button>
                  ))}
              </div>
            )
          })}
          {hiddenRows > 0 && (
            <div className="flex flex-col items-center gap-1 px-3 py-2 text-center text-[0.6875rem] text-muted-foreground">
              <span>
                {hiddenRows} more match{hiddenRows === 1 ? '' : 'es'} hidden.
              </span>
              <Button onClick={() => setShowAll(true)} size="xs" type="button" variant="secondary">
                Show all
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Highlight the matched span within the line preview.
function renderPreview(preview: string, start: number, end: number) {
  if (start < 0 || end <= start || end > preview.length) {
    return preview
  }

  return (
    <>
      {preview.slice(0, start)}
      <mark className="rounded-sm bg-amber-300/40 text-foreground dark:bg-amber-300/25">{preview.slice(start, end)}</mark>
      {preview.slice(end)}
    </>
  )
}
