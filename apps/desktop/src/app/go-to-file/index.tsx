import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { filePathForTarget } from '@/app/chat/right-rail/preview-file'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import { findDesktopFilesByName } from '@/lib/desktop-fs'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { cn } from '@/lib/utils'
import { $goToFileOpen, closeGoToFile } from '@/store/go-to-file'
import { notifyError } from '@/store/notifications'
import { setCurrentSessionPreviewTarget } from '@/store/preview'
import { $currentCwd } from '@/store/session'

const SEARCH_DEBOUNCE_MS = 120

function basename(path: string): string {
  const parts = path.split(/[\\/]/)

  return parts[parts.length - 1] || path
}

function dirname(path: string, cwd?: string | null): string {
  let dir = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))

  // Trim the workspace prefix so the directory reads relative to the project.
  if (cwd && dir.startsWith(cwd)) {
    dir = dir.slice(cwd.length).replace(/^[\\/]+/, '')
  }

  return dir
}

export function GoToFileDialog() {
  const open = useStore($goToFileOpen)
  const cwd = useStore($currentCwd)

  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Reset + focus on open.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Debounced fuzzy file-name search.
  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setLoading(true)

    const handle = window.setTimeout(async () => {
      try {
        const res = await findDesktopFilesByName(query, cwd || undefined)

        if (!cancelled) {
          setFiles(res.files)
          setActive(0)
        }
      } catch {
        if (!cancelled) {
          setFiles([])
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
  }, [open, query, cwd])

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const openFile = async (path: string) => {
    try {
      const preview = await normalizeOrLocalPreviewTarget(path, cwd || undefined)

      if (!preview) {
        throw new Error(`Could not open ${path}`)
      }

      setCurrentSessionPreviewTarget(preview, 'file-browser', path)
      void filePathForTarget(preview)
      closeGoToFile()
    } catch (err) {
      notifyError(err, 'Could not open file')
    }
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeGoToFile()

      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(i => Math.min(files.length - 1, i + 1))

      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(i => Math.max(0, i - 1))

      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const path = files[active]

      if (path) {
        void openFile(path)
      }
    }
  }

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-1200 flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
      onClick={closeGoToFile}
      onKeyDown={onKeyDown}
    >
      <div
        className="flex max-h-[60vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-(--stroke-nous) bg-(--ui-chat-bubble-background) shadow-nous"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/60 p-3">
          <Input
            aria-label="Go to file"
            className="h-8 flex-1"
            onChange={event => setQuery(event.target.value)}
            placeholder="Go to file"
            ref={inputRef}
            value={query}
          />
          {loading ? <Loader className="size-4 shrink-0" type="lemniscate-bloom" /> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1 text-xs" ref={listRef}>
          {!loading && files.length === 0 && (
            <div className="px-3 py-6 text-center text-muted-foreground">No files.</div>
          )}
          {files.map((path, index) => (
            <button
              className={cn(
                'flex w-full items-baseline gap-2 rounded px-2 py-1 text-left',
                index === active ? 'bg-(--chrome-action-hover)' : 'hover:bg-(--chrome-action-hover)'
              )}
              data-index={index}
              key={path}
              onClick={() => void openFile(path)}
              onMouseMove={() => setActive(index)}
              type="button"
            >
              <span className="shrink-0 font-medium text-foreground">{basename(path)}</span>
              <span className="min-w-0 truncate text-muted-foreground/70">{dirname(path, cwd)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
