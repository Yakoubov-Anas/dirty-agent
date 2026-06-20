import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const searchDesktopFiles = vi.fn()
const replaceDesktopFiles = vi.fn()
const setCurrentSessionPreviewTarget = vi.fn()
const requestEditorReveal = vi.fn()
const normalizeOrLocalPreviewTarget = vi.fn()

vi.mock('@/lib/desktop-fs', () => ({
  searchDesktopFiles: (...a: unknown[]) => searchDesktopFiles(...a),
  replaceDesktopFiles: (...a: unknown[]) => replaceDesktopFiles(...a)
}))
vi.mock('@/lib/local-preview', () => ({
  normalizeOrLocalPreviewTarget: (...a: unknown[]) => normalizeOrLocalPreviewTarget(...a)
}))
// preview-file pulls in CodeMirror; stub the one helper the dialog needs.
vi.mock('@/app/chat/right-rail/preview-file', () => ({
  filePathForTarget: (t: { path?: string }) => t.path ?? ''
}))
vi.mock('@/store/preview', () => ({
  setCurrentSessionPreviewTarget: (...a: unknown[]) => setCurrentSessionPreviewTarget(...a),
  requestEditorReveal: (...a: unknown[]) => requestEditorReveal(...a)
}))
vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

import { $findInFiles, $findInFilesSession, closeFindInFiles, openFindInFiles } from '@/store/find-in-files'

import { FindInFilesDialog } from './index'

const RESULT = {
  files: [
    { path: '/proj/src/a.ts', matches: [{ line: 3, column: 4, matchEnd: 7, preview: '    foo bar' }] },
    { path: '/proj/src/b.ts', matches: [{ line: 1, column: 0, matchEnd: 3, preview: 'foo baz' }] }
  ],
  total: 2,
  truncated: false
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  closeFindInFiles()
  $findInFiles.set({ open: false, mode: 'find' })
  $findInFilesSession.set({ query: '', replacement: '', caseSensitive: false, wholeWord: false, regexp: false, result: null })
})

describe('FindInFilesDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = renderDialog()
    expect(container.querySelector('input')).toBeNull()
  })

  it('survives close + reopen (regression: crashed on reopen)', async () => {
    searchDesktopFiles.mockResolvedValue(RESULT)
    renderDialog()

    act(() => openFindInFiles('find'))
    expect(await screen.findByLabelText('Find in files')).toBeTruthy()

    act(() => closeFindInFiles())
    await waitFor(() => expect(screen.queryByLabelText('Find in files')).toBeNull())

    act(() => openFindInFiles('find'))
    expect(await screen.findByLabelText('Find in files')).toBeTruthy()
  })

  it('keeps previous results on reopen without refetching', async () => {
    searchDesktopFiles.mockResolvedValue(RESULT)
    renderDialog()

    // First open + search.
    act(() => openFindInFiles('find'))
    fireEvent.change(await screen.findByLabelText('Find in files'), { target: { value: 'foo' } })
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    expect(searchDesktopFiles).toHaveBeenCalledTimes(1)

    // Close + reopen — results show immediately, no second search call.
    act(() => closeFindInFiles())
    await waitFor(() => expect(screen.queryByLabelText('Find in files')).toBeNull())
    act(() => openFindInFiles('find'))

    expect(await screen.findByLabelText('Find in files')).toBeTruthy()
    expect(screen.getByText('a.ts')).toBeTruthy()
    // Still only one search — the cached results were reused.
    expect(searchDesktopFiles).toHaveBeenCalledTimes(1)
  })

  it('survives open → click result (auto-closes) → reopen', async () => {
    searchDesktopFiles.mockResolvedValue(RESULT)
    normalizeOrLocalPreviewTarget.mockResolvedValue({ kind: 'file', path: '/proj/src/a.ts', source: '/proj/src/a.ts', url: 'file:///proj/src/a.ts', label: 'a.ts' })
    renderDialog()

    act(() => openFindInFiles('find'))
    fireEvent.change(await screen.findByLabelText('Find in files'), { target: { value: 'foo' } })
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())

    fireEvent.click(screen.getAllByText('foo', { selector: 'mark' })[0].closest('button') as HTMLElement)
    // Clicking a result opens the file and auto-closes the dialog.
    await waitFor(() => expect(screen.queryByLabelText('Find in files')).toBeNull())

    // Reopening must not crash and should show the dialog again.
    act(() => openFindInFiles('find'))
    expect(await screen.findByLabelText('Find in files')).toBeTruthy()
  })

  it('searches as the user types and lists results grouped by file', async () => {
    searchDesktopFiles.mockResolvedValue(RESULT)
    act(() => openFindInFiles('find'))
    renderDialog()

    fireEvent.change(screen.getByLabelText('Find in files'), { target: { value: 'foo' } })

    await waitFor(() => expect(searchDesktopFiles).toHaveBeenCalled())
    expect(screen.getByText('a.ts')).toBeTruthy()
    expect(screen.getByText('b.ts')).toBeTruthy()
    expect(await screen.findByText('2 results in 2 files')).toBeTruthy()
  })

  it('opens a result and requests an editor reveal at the matched line', async () => {
    searchDesktopFiles.mockResolvedValue(RESULT)
    normalizeOrLocalPreviewTarget.mockResolvedValue({ kind: 'file', path: '/proj/src/a.ts', source: '/proj/src/a.ts', url: 'file:///proj/src/a.ts', label: 'a.ts' })
    act(() => openFindInFiles('find'))
    renderDialog()

    fireEvent.change(screen.getByLabelText('Find in files'), { target: { value: 'foo' } })
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())

    // Click the first match row (a.ts:3). Both files match "foo", so scope to
    // the first highlighted mark.
    const firstMark = screen.getAllByText('foo', { selector: 'mark' })[0]
    fireEvent.click(firstMark.closest('button') as HTMLElement)

    await waitFor(() => expect(requestEditorReveal).toHaveBeenCalled())
    expect(setCurrentSessionPreviewTarget).toHaveBeenCalled()
    expect(requestEditorReveal).toHaveBeenCalledWith(expect.objectContaining({ line: 3, path: '/proj/src/a.ts' }))
    // The dialog closes after a result is opened.
    await waitFor(() => expect(screen.queryByLabelText('Find in files')).toBeNull())
  })

  it('shows the replace row + Replace All in replace mode and calls the endpoint', async () => {
    searchDesktopFiles.mockResolvedValue(RESULT)
    replaceDesktopFiles.mockResolvedValue({ filesChanged: 2, replacements: 2 })
    act(() => openFindInFiles('replace'))
    renderDialog()

    fireEvent.change(screen.getByLabelText('Find in files'), { target: { value: 'foo' } })
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Replace with'), { target: { value: 'XXX' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace All' }))

    await waitFor(() => expect(replaceDesktopFiles).toHaveBeenCalled())
    expect(replaceDesktopFiles).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'foo', replace: 'XXX', files: ['/proj/src/a.ts', '/proj/src/b.ts'] })
    )
  })
})

function renderDialog() {
  return render(<FindInFilesDialog />)
}
