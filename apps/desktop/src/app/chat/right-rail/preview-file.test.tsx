import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PreviewTarget } from '@/store/preview'

const readDesktopFileText = vi.fn()
const writeDesktopFileText = vi.fn()

vi.mock('@/lib/desktop-fs', () => ({
  readDesktopFileText: (path: string) => readDesktopFileText(path),
  readDesktopFileDataUrl: vi.fn(),
  writeDesktopFileText: (path: string, content: string) => writeDesktopFileText(path, content)
}))

// react-shiki pulls in a heavy async highlighter; stub it so the read-only
// source view (truncated files) renders synchronously in jsdom.
vi.mock('react-shiki', () => ({
  default: ({ children }: { children: string }) => <pre>{children}</pre>
}))

// CodeMirror needs real layout it can't get in jsdom. Stub the editor to a
// controlled <textarea> that exercises onChange + onSave (Cmd+S) so the
// autosave + save wiring in EditableCodeView is what's under test.
vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: ({
    value,
    onChange,
    onSave
  }: {
    value: string
    onChange?: (v: string) => void
    onSave?: () => void
  }) => (
    <textarea
      defaultValue={value}
      onChange={e => onChange?.(e.target.value)}
      onKeyDown={e => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          onSave?.()
        }
      }}
    />
  )
}))

import { LocalFilePreview, relativePathFromCwd } from './preview-file'

const target: PreviewTarget = {
  kind: 'file',
  label: 'hello.py',
  path: '/work/hello.py',
  previewKind: 'text',
  source: '/work/hello.py',
  url: 'file:///work/hello.py'
}

afterEach(() => {
  cleanup()
  readDesktopFileText.mockReset()
  writeDesktopFileText.mockReset()
})

describe('relativePathFromCwd', () => {
  it('returns the workspace-relative path, separator/case-insensitive', () => {
    expect(relativePathFromCwd('/work', '/work/src/app.py')).toBe('src/app.py')
    expect(relativePathFromCwd('C:\\Proj', 'C:/proj/src/App.ts')).toBe('src/App.ts')
  })

  it('returns null for paths outside the workspace', () => {
    expect(relativePathFromCwd('/work', '/other/app.py')).toBeNull()
    expect(relativePathFromCwd('', '/work/app.py')).toBeNull()
  })
})


describe('LocalFilePreview editing', () => {
  it('opens code files editable by default and autosaves on Cmd+S', async () => {
    readDesktopFileText.mockResolvedValue({
      byteSize: 12,
      language: 'python',
      path: '/work/hello.py',
      text: 'print("hi")'
    })
    writeDesktopFileText.mockResolvedValue({ byteSize: 16, path: '/work/hello.py' })

    render(<LocalFilePreview reloadKey={0} target={target} />)

    // No Edit/Save buttons — the editor is present once the file loads.
    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    expect(textarea.value).toBe('print("hi")')
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()

    fireEvent.change(textarea, { target: { value: 'print("bye")' } })
    fireEvent.keyDown(textarea, { ctrlKey: true, key: 's' })

    await waitFor(() => expect(writeDesktopFileText).toHaveBeenCalledWith('/work/hello.py', 'print("bye")'))
  })

  it('does not autosave — typing alone never writes to disk', async () => {
    vi.useFakeTimers()
    readDesktopFileText.mockResolvedValue({
      byteSize: 3,
      language: 'text',
      path: '/work/hello.py',
      text: 'foo'
    })
    writeDesktopFileText.mockResolvedValue({ byteSize: 3, path: '/work/hello.py' })

    try {
      render(<LocalFilePreview reloadKey={0} target={target} />)

      await vi.waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy())
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

      fireEvent.change(textarea, { target: { value: 'foobar' } })
      // Wait well past any plausible debounce window — still no write.
      await vi.advanceTimersByTimeAsync(5000)
      expect(writeDesktopFileText).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces a save error and keeps the editor open', async () => {
    readDesktopFileText.mockResolvedValue({
      byteSize: 3,
      language: 'text',
      path: '/work/hello.py',
      text: 'foo'
    })
    writeDesktopFileText.mockRejectedValue(new Error('File is not writable'))

    render(<LocalFilePreview reloadKey={0} target={target} />)

    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'bar' } })
    fireEvent.keyDown(textarea, { ctrlKey: true, key: 's' })

    expect(await screen.findByText('Save failed: File is not writable')).toBeTruthy()
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('keeps a truncated (partial) read read-only — no editor', async () => {
    readDesktopFileText.mockResolvedValue({
      byteSize: 1024,
      language: 'text',
      path: '/work/hello.py',
      text: 'partial',
      truncated: true
    })

    render(<LocalFilePreview reloadKey={0} target={target} />)

    await screen.findByText('partial')
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
