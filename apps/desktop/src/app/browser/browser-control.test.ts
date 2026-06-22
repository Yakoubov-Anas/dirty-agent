import { describe, expect, it, vi } from 'vitest'

import { type ControlWebview, runBrowserCommand } from './browser-control'

function fakeWebview(overrides: Partial<ControlWebview> = {}): ControlWebview {
  return {
    executeJavaScript: vi.fn().mockResolvedValue(null),
    getURL: () => 'https://current.example',
    loadURL: vi.fn(),
    ...overrides
  }
}

describe('runBrowserCommand navigate', () => {
  it('normalizes a bare host to https and calls loadURL', async () => {
    const loadURL = vi.fn()
    const wv = fakeWebview({ loadURL })
    const result = await runBrowserCommand(wv, { kind: 'navigate', url: 'example.com' })
    expect(result).toEqual({ ok: true, url: 'https://example.com' })
    expect(loadURL).toHaveBeenCalledWith('https://example.com')
  })

  it('keeps explicit schemes and localhost uses http', async () => {
    const loadURL = vi.fn()
    const wv = fakeWebview({ loadURL })
    await runBrowserCommand(wv, { kind: 'navigate', url: 'http://x.test' })
    expect(loadURL).toHaveBeenCalledWith('http://x.test')
    await runBrowserCommand(wv, { kind: 'navigate', url: 'localhost:3000' })
    expect(loadURL).toHaveBeenCalledWith('http://localhost:3000')
  })

  it('fails on empty url', async () => {
    const result = await runBrowserCommand(fakeWebview(), { kind: 'navigate', url: '  ' })
    expect(result.ok).toBe(false)
  })

  it('fails when loadURL is unavailable', async () => {
    const wv = fakeWebview({ loadURL: undefined })
    const result = await runBrowserCommand(wv, { kind: 'navigate', url: 'example.com' })
    expect(result.ok).toBe(false)
  })
})

describe('runBrowserCommand read', () => {
  it('returns the page snapshot from executeJavaScript', async () => {
    const wv = fakeWebview({
      executeJavaScript: vi.fn().mockResolvedValue({
        url: 'https://r.example',
        title: 'Title',
        text: 'body text',
        html: '<html></html>'
      })
    })

    const result = await runBrowserCommand(wv, { kind: 'read' })
    expect(result).toMatchObject({
      ok: true,
      url: 'https://r.example',
      title: 'Title',
      text: 'body text',
      html: '<html></html>'
    })
  })

  it('falls back to getURL when the script returns nothing', async () => {
    const wv = fakeWebview({ executeJavaScript: vi.fn().mockResolvedValue(null) })
    const result = await runBrowserCommand(wv, { kind: 'read' })
    expect(result.ok).toBe(true)
    expect(result.url).toBe('https://current.example')
  })
})

describe('runBrowserCommand click / type', () => {
  it('reports found on click', async () => {
    const wv = fakeWebview({ executeJavaScript: vi.fn().mockResolvedValue({ found: true }) })
    const result = await runBrowserCommand(wv, { kind: 'click', selector: '#go' })
    expect(result).toEqual({ ok: true, found: true })
  })

  it('reports not found on click', async () => {
    const wv = fakeWebview({ executeJavaScript: vi.fn().mockResolvedValue({ found: false }) })
    const result = await runBrowserCommand(wv, { kind: 'click', selector: '#missing' })
    expect(result).toMatchObject({ ok: false, found: false })
  })

  it('escapes selector + text into the injected script', async () => {
    const exec = vi.fn().mockResolvedValue({ found: true })
    const wv = fakeWebview({ executeJavaScript: exec })
    await runBrowserCommand(wv, { kind: 'type', selector: 'input[name="q"]', text: 'a"b\nc', submit: true })
    const code = exec.mock.calls[0][0] as string
    expect(code).toContain('input[name=\\"q\\"]')
    expect(code).toContain('requestSubmit')
    // newline + quote survive as a valid JS literal (no raw break)
    expect(code).toContain(JSON.stringify('a"b\nc'))
  })
})

describe('runBrowserCommand errors', () => {
  it('captures executeJavaScript throwing', async () => {
    const wv = fakeWebview({ executeJavaScript: vi.fn().mockRejectedValue(new Error('boom')) })
    const result = await runBrowserCommand(wv, { kind: 'read' })
    expect(result).toEqual({ ok: false, error: 'boom' })
  })
})
