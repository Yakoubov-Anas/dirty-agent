import type { EditorView } from '@codemirror/view'

// Tracks the most-recently-focused CodeMirror editor so global actions (Find,
// Find in Files) can read its current selection to prefill the search query.

let activeView: EditorView | null = null

export function setActiveEditorView(view: EditorView) {
  activeView = view
}

export function clearActiveEditorView(view: EditorView) {
  if (activeView === view) {
    activeView = null
  }
}

// Returns the active editor's primary selection as a single-line string, or ''
// when there's no usable selection (empty, multi-line, or too long to be a
// sensible search seed).
export function getActiveEditorSelectionText(maxLength = 500): string {
  if (!activeView) {
    return ''
  }

  const sel = activeView.state.selection.main

  if (sel.empty || sel.to - sel.from > maxLength) {
    return ''
  }

  const text = activeView.state.sliceDoc(sel.from, sel.to)

  return text.includes('\n') ? '' : text
}
