import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  type LanguageSupport,
  syntaxHighlighting
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view'
import { useEffect, useRef } from 'react'

import { clearActiveEditorView, setActiveEditorView } from '@/components/ui/active-editor'
import { gotoLineExtension, openGotoLine } from '@/components/ui/code-goto-line'
import { createReactSearchPanel, openReplacePanel } from '@/components/ui/code-search-panel'
import { cn } from '@/lib/utils'

export interface CodeEditorProps {
  /** Initial document text. Subsequent prop changes reset the document only
   *  when `docKey` changes (so typing isn't clobbered by parent re-renders). */
  value: string
  /** Bump to force the editor to re-seed from `value` (e.g. file path change,
   *  external reload, or a save that rewrote the buffer). */
  docKey?: number | string
  /** File path or name — used to resolve the syntax-highlighting grammar. */
  filename?: string
  /** Explicit CodeMirror/language-data language name (overrides filename). */
  language?: string
  readOnly?: boolean
  dark?: boolean
  className?: string
  onChange?: (value: string) => void
  /** Cmd/Ctrl+S handler. Return value is ignored; preventDefault is automatic. */
  onSave?: () => void
  /** Cmd/Ctrl+L — add the current selection (or line) to the chat composer as
   *  a file ref. Receives the 1-based start/end line range of the selection. */
  onAddSelectionRef?: (range: { start: number; end: number }) => void
  /** Cmd/Ctrl+Enter — "run" action (e.g. SQL console). Receives the selected
   *  text, or the statement under the caret (between semicolons) when empty. */
  onRun?: (sql: string) => void
  /** Scroll to + place the cursor on this 1-based line/column. Re-applied
   *  whenever `revealKey` changes (so jumping to the same line twice works). */
  reveal?: { line: number; column?: number } | null
  revealKey?: number | string
}

// Transparent editor chrome so the editor blends with the themed preview pane
// instead of painting an opaque box. Token COLORS come from the highlight style
// (defaultHighlightStyle in light, oneDarkHighlightStyle in dark); this theme
// only governs background, gutter, cursor, and selection surfaces.
const transparentTheme = (dark: boolean) =>
  EditorView.theme(
    {
      '&': { backgroundColor: 'transparent', color: 'var(--foreground)' },
      '.cm-content': { caretColor: 'var(--foreground)', fontFamily: 'inherit' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
      '&.cm-focused': { outline: 'none' },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        border: 'none',
        color: 'color-mix(in srgb, var(--muted-foreground) 65%, transparent)'
      },
      '.cm-activeLine': {
        backgroundColor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)'
      },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
      '.cm-selectionBackground, ::selection': {
        backgroundColor: dark ? 'rgba(120,170,255,0.25)' : 'rgba(80,130,255,0.18)'
      },
      '&.cm-focused .cm-selectionBackground, &.cm-focused ::selection': {
        backgroundColor: dark ? 'rgba(120,170,255,0.32)' : 'rgba(80,130,255,0.24)'
      },
      '.cm-matchingBracket': {
        backgroundColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
        outline: 'none'
      },
      '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.5', overflow: 'auto' },

      // The search panel itself is a custom React component (see
      // code-search-panel.tsx); these only theme the panel host + the in-doc
      // match highlights it drives.
      '.cm-panels': { backgroundColor: 'transparent', color: 'var(--foreground)', borderColor: 'var(--border)' },
      '.cm-searchMatch': {
        backgroundColor: dark ? 'rgba(255,210,80,0.22)' : 'rgba(255,190,40,0.30)',
        outline: dark ? '1px solid rgba(255,210,80,0.35)' : '1px solid rgba(200,140,0,0.4)'
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: dark ? 'rgba(255,170,60,0.45)' : 'rgba(255,160,20,0.55)'
      }
    },
    { dark }
  )

// Resolve a CodeMirror language extension from a filename or explicit language
// name using @codemirror/language-data's lazy grammar registry. Grammars load
// async, so this returns a promise; the editor reconfigures once it resolves.
async function resolveLanguage(filename?: string, language?: string): Promise<LanguageSupport | null> {
  const byName = language
    ? languages.find(l => l.name.toLowerCase() === language.toLowerCase() || l.alias.includes(language.toLowerCase()))
    : null

  const ext = filename ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase() : ''
  const byExt = !byName && ext ? languages.find(l => l.extensions.includes(ext)) : null
  const desc = byName || byExt

  if (!desc) {
    return null
  }

  try {
    const support = await desc.load()

    return support as LanguageSupport
  } catch {
    return null
  }
}

/**
 * CodeEditor — a CodeMirror 6 editor with line numbers, syntax highlighting,
 * history (undo/redo), bracket matching/closing, search, multi-cursor, and
 * indent-with-Tab. Editable by default; pass `readOnly` to disable. Chrome is
 * transparent so it blends with the surrounding pane. Cmd/Ctrl+S → onSave;
 * Cmd/Ctrl+L → onAddSelectionRef with the selected line range.
 */
export function CodeEditor({
  value,
  docKey,
  filename,
  language,
  readOnly = false,
  dark = true,
  className,
  onChange,
  onSave,
  onRun,
  onAddSelectionRef,
  reveal,
  revealKey
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const langCompartment = useRef(new Compartment())
  const themeCompartment = useRef(new Compartment())
  const highlightCompartment = useRef(new Compartment())
  const readOnlyCompartment = useRef(new Compartment())
  // Keep the latest callbacks in refs so the editor instance (created once) can
  // call them without being torn down on every parent render.
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onRunRef = useRef(onRun)
  const onAddSelectionRefRef = useRef(onAddSelectionRef)
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onRunRef.current = onRun
  onAddSelectionRefRef.current = onAddSelectionRef

  // Create the editor once.
  useEffect(() => {
    if (!hostRef.current) {
      return
    }

    const appKeymap = keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          onSaveRef.current?.()

          return true
        }
      },
      {
        key: 'Mod-l',
        preventDefault: true,
        run: view => {
          if (!onAddSelectionRefRef.current) {
            return false
          }

          const range = view.state.selection.main
          const start = view.state.doc.lineAt(range.from).number
          const end = view.state.doc.lineAt(range.to).number
          onAddSelectionRefRef.current({ end, start })

          return true
        }
      },
      {
        // Run (e.g. SQL console): hand the consumer the current selection, or —
        // when the selection is empty — the statement under the caret (the text
        // between the nearest semicolons). preventDefault so it never inserts a
        // newline.
        key: 'Mod-Enter',
        preventDefault: true,
        run: view => {
          if (!onRunRef.current) {
            return false
          }

          const sel = view.state.selection.main
          let sql = ''

          if (!sel.empty) {
            sql = view.state.sliceDoc(sel.from, sel.to)
          } else {
            const doc = view.state.doc.toString()
            const caret = sel.from
            let start = doc.lastIndexOf(';', caret - 1) + 1
            let end = doc.indexOf(';', caret)

            if (end === -1) {
              end = doc.length
            }

            start = Math.max(0, start)
            sql = doc.slice(start, end)
          }

          onRunRef.current(sql.trim())

          return true
        }
      },
      {
        // Go to line. CodeMirror's searchKeymap binds Mod-g to "find next"; this
        // higher-precedence binding (appKeymap sits before searchKeymap) makes
        // Mod-g prompt for a line number and jump the cursor there instead.
        key: 'Mod-g',
        preventDefault: true,
        run: openGotoLine
      },
      {
        // Open the search panel directly in replace mode. The browser's native
        // Mod-r is reload, so preventDefault is essential here.
        key: 'Mod-r',
        preventDefault: true,
        run: openReplacePanel
      }
    ])

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        highlightSelectionMatches(),
        // Custom React search/replace panel built from the app's UI components
        // (matches font/checkboxes/buttons), replacing the default grey panel.
        search({ createPanel: createReactSearchPanel }),
        gotoLineExtension,
        appKeymap,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab
        ]),
        langCompartment.current.of([]),
        highlightCompartment.current.of(
          syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle, { fallback: true })
        ),
        themeCompartment.current.of(transparentTheme(dark)),
        readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString())
          }

          // Track the focused editor so global Find / Find-in-Files can read
          // its selection to prefill the search query.
          if (update.focusChanged && update.view.hasFocus) {
            setActiveEditorView(update.view)
          }
        })
      ]
    })

    const view = new EditorView({ parent: hostRef.current, state })
    viewRef.current = view

    return () => {
      clearActiveEditorView(view)
      view.destroy()
      viewRef.current = null
    }
    // Intentionally create once; docKey/value/lang/theme updates flow through
    // the dedicated effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-seed the document when docKey changes (new file / external reload).
  useEffect(() => {
    const view = viewRef.current

    if (!view) {
      return
    }

    if (view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, insert: value, to: view.state.doc.length } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  // Scroll to + select the requested line when `reveal`/`revealKey` changes.
  useEffect(() => {
    const view = viewRef.current

    if (!view || !reveal) {
      return
    }

    const lineNumber = Math.max(1, Math.min(view.state.doc.lines, reveal.line))
    const line = view.state.doc.line(lineNumber)
    const pos = Math.min(line.to, line.from + Math.max(0, reveal.column ?? 0))

    view.dispatch({
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      selection: { anchor: pos }
    })
    view.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey])

  // Resolve + apply the language grammar.
  useEffect(() => {
    let cancelled = false

    void resolveLanguage(filename, language).then(support => {
      const view = viewRef.current

      if (cancelled || !view || !support) {
        return
      }

      view.dispatch({ effects: langCompartment.current.reconfigure(support) })
    })

    return () => {
      cancelled = true
    }
  }, [filename, language])

  // Apply theme + highlight + read-only changes without recreating the editor.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        themeCompartment.current.reconfigure(transparentTheme(dark)),
        highlightCompartment.current.reconfigure(
          syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle, { fallback: true })
        )
      ]
    })
  }, [dark])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly))
    })
  }, [readOnly])

  return (
    <div
      className={cn('h-full min-h-0 w-full overflow-hidden font-mono text-xs [&_.cm-editor]:h-full', className)}
      ref={hostRef}
    />
  )
}
