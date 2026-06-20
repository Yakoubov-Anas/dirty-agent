import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { gotoLineExtension, openGotoLine } from './code-goto-line'

// jsdom has no layout engine, so CodeMirror's async measure pass throws
// (textRange().getClientRects is not a function). Stub rAF to a no-op so the
// view never schedules a measure — the panel state + cursor logic we test
// don't depend on layout.
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

const views: EditorView[] = []

function makeView(doc: string) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [gotoLineExtension] })
  })

  views.push(view)

  return view
}

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy()
  }

  cleanup()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('go to line panel', () => {
  it('opens on openGotoLine and shows the line input', () => {
    const view = makeView('a\nb\nc\nd\ne')

    act(() => {
      openGotoLine(view)
    })

    expect(screen.getByText('Go to line')).toBeTruthy()
    expect(screen.getByLabelText('Line number')).toBeTruthy()
  })

  it('moves the cursor to the requested line', () => {
    const view = makeView('line1\nline2\nline3\nline4')

    act(() => {
      openGotoLine(view)
    })

    fireEvent.change(screen.getByLabelText('Line number'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))

    // Cursor should be at the start of line 3.
    const pos = view.state.selection.main.head
    expect(view.state.doc.lineAt(pos).number).toBe(3)
    // Panel closes after jumping.
    expect(screen.queryByLabelText('Line number')).toBeNull()
  })

  it('clamps an out-of-range line to the last line', () => {
    const view = makeView('one\ntwo\nthree')

    act(() => {
      openGotoLine(view)
    })

    fireEvent.change(screen.getByLabelText('Line number'), { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))

    const pos = view.state.selection.main.head
    expect(view.state.doc.lineAt(pos).number).toBe(3)
  })

  it('flags an invalid (non-numeric) entry and stays open', () => {
    const view = makeView('a\nb\nc')

    act(() => {
      openGotoLine(view)
    })

    const input = screen.getByLabelText('Line number')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))

    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('Line number')).toBeTruthy()
  })
})
