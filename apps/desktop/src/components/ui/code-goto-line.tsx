import { type Extension, StateEffect, StateField } from '@codemirror/state'
import { EditorView, type Panel, showPanel } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'

// Toggle effect + state for the go-to-line panel. showPanel renders the React
// panel below the editor while the field is true.
const toggleGotoLine = StateEffect.define<boolean>()

const gotoLineState = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(toggleGotoLine)) {
        value = effect.value
      }
    }

    return value
  },
  provide: field => showPanel.from(field, open => (open ? createGotoLinePanel : null))
})

function closeGotoLine(view: EditorView) {
  view.dispatch({ effects: toggleGotoLine.of(false) })
}

// Open (or re-focus) the go-to-line prompt.
export function openGotoLine(view: EditorView): boolean {
  view.dispatch({ effects: toggleGotoLine.of(true) })

  return true
}

function GotoLinePanel({ view }: { view: EditorView }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const totalLines = view.state.doc.lines

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const go = () => {
    const parsed = Number.parseInt(value.trim(), 10)

    if (!Number.isFinite(parsed) || parsed < 1) {
      setError(true)

      return
    }

    const lineNumber = Math.min(totalLines, parsed)
    const line = view.state.doc.line(lineNumber)

    view.dispatch({
      effects: [toggleGotoLine.of(false), EditorView.scrollIntoView(line.from, { y: 'center' })],
      selection: { anchor: line.from }
    })
    view.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      go()

      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeGotoLine(view)
      view.focus()
    }
  }

  return (
    <div className="flex items-center gap-2 border-t border-border bg-background px-2.5 py-2 text-xs" onKeyDown={onKeyDown}>
      <span className="text-muted-foreground">Go to line</span>
      <Input
        aria-invalid={error}
        aria-label="Line number"
        className="h-7 w-24"
        inputMode="numeric"
        onChange={event => {
          setError(false)
          setValue(event.target.value)
        }}
        placeholder={`1–${totalLines}`}
        ref={inputRef}
        value={value}
      />
      <Button className="h-7" onClick={go} size="xs" type="button" variant="secondary">
        Go
      </Button>
      <Button
        aria-label="Close"
        className="ml-auto size-7 p-0"
        onClick={() => {
          closeGotoLine(view)
          view.focus()
        }}
        size="xs"
        type="button"
        variant="ghost"
      >
        <Codicon name="close" size="0.875rem" />
      </Button>
    </div>
  )
}

function createGotoLinePanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  dom.className = 'cm-react-goto-line-panel'
  let root: Root | null = null

  return {
    dom,
    mount() {
      root = createRoot(dom)
      root.render(<GotoLinePanel view={view} />)
    },
    destroy() {
      const toUnmount = root
      root = null
      queueMicrotask(() => toUnmount?.unmount())
    }
  }
}

// The state field that powers the go-to-line panel. Bind a key to
// `openGotoLine` to trigger it (see code-editor.tsx).
export const gotoLineExtension: Extension = gotoLineState
