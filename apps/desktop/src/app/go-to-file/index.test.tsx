import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const findDesktopFilesByName = vi.fn()
const setCurrentSessionPreviewTarget = vi.fn()
const normalizeOrLocalPreviewTarget = vi.fn()

vi.mock('@/lib/desktop-fs', () => ({
  findDesktopFilesByName: (...a: unknown[]) => findDesktopFilesByName(...a)
}))
vi.mock('@/lib/local-preview', () => ({
  normalizeOrLocalPreviewTarget: (...a: unknown[]) => normalizeOrLocalPreviewTarget(...a)
}))
vi.mock('@/app/chat/right-rail/preview-file', () => ({
  filePathForTarget: (t: { path?: string }) => t.path ?? ''
}))
vi.mock('@/store/preview', () => ({
  setCurrentSessionPreviewTarget: (...a: unknown[]) => setCurrentSessionPreviewTarget(...a)
}))
vi.mock('@/store/notifications', () => ({ notifyError: vi.fn() }))

import { $goToFileOpen, closeGoToFile, openGoToFile } from '@/store/go-to-file'

import { GoToFileDialog } from './index'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  $goToFileOpen.set(false)
})

describe('GoToFileDialog', () => {
  it('is closed by default', () => {
    const { container } = render(<GoToFileDialog />)
    expect(container.querySelector('input')).toBeNull()
  })

  it('lists fuzzy-matched files as the user types', async () => {
    findDesktopFilesByName.mockResolvedValue({ files: ['/proj/src/code-editor.tsx', '/proj/src/model-edit.tsx'], truncated: false })
    render(<GoToFileDialog />)

    act(() => openGoToFile())
    fireEvent.change(await screen.findByLabelText('Go to file'), { target: { value: 'codeedit' } })

    await waitFor(() => expect(findDesktopFilesByName).toHaveBeenCalledWith('codeedit', undefined))
    expect(await screen.findByText('code-editor.tsx')).toBeTruthy()
    expect(screen.getByText('model-edit.tsx')).toBeTruthy()
  })

  it('opens the active file on Enter and closes', async () => {
    findDesktopFilesByName.mockResolvedValue({ files: ['/proj/src/a.ts', '/proj/src/b.ts'], truncated: false })
    normalizeOrLocalPreviewTarget.mockResolvedValue({ kind: 'file', path: '/proj/src/b.ts', source: '/proj/src/b.ts', url: 'file:///proj/src/b.ts', label: 'b.ts' })
    render(<GoToFileDialog />)

    act(() => openGoToFile())
    const input = await screen.findByLabelText('Go to file')
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())

    // Arrow down to the 2nd file, then Enter.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(setCurrentSessionPreviewTarget).toHaveBeenCalled())
    expect(normalizeOrLocalPreviewTarget).toHaveBeenCalledWith('/proj/src/b.ts', undefined)
    await waitFor(() => expect(screen.queryByLabelText('Go to file')).toBeNull())
  })

  it('closes on Escape', async () => {
    findDesktopFilesByName.mockResolvedValue({ files: [], truncated: false })
    render(<GoToFileDialog />)

    act(() => openGoToFile())
    const input = await screen.findByLabelText('Go to file')
    fireEvent.keyDown(input, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByLabelText('Go to file')).toBeNull())
  })

  it('reopens reliably after close', async () => {
    findDesktopFilesByName.mockResolvedValue({ files: [], truncated: false })
    render(<GoToFileDialog />)

    act(() => openGoToFile())
    expect(await screen.findByLabelText('Go to file')).toBeTruthy()
    act(() => closeGoToFile())
    await waitFor(() => expect(screen.queryByLabelText('Go to file')).toBeNull())
    act(() => openGoToFile())
    expect(await screen.findByLabelText('Go to file')).toBeTruthy()
  })
})
