import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $browserAiControl,
  registerBrowserControlWebview,
  setBrowserAiControl
} from '@/store/browser'

import type { ControlWebview } from './browser-control'
import { commandFromPayload, handleBrowserControlRequest } from './browser-control-handler'

describe('commandFromPayload', () => {
  it('maps navigate with a url', () => {
    expect(commandFromPayload({ action: 'navigate', params: { url: 'x.com' } })).toEqual({
      kind: 'navigate',
      url: 'x.com'
    })
  })

  it('maps read', () => {
    expect(commandFromPayload({ action: 'read' })).toEqual({ kind: 'read' })
  })

  it('maps click and type with selectors', () => {
    expect(commandFromPayload({ action: 'click', params: { selector: '#a' } })).toEqual({
      kind: 'click',
      selector: '#a'
    })
    expect(commandFromPayload({ action: 'type', params: { selector: '#i', text: 'hi', submit: true } })).toEqual({
      kind: 'type',
      selector: '#i',
      text: 'hi',
      submit: true
    })
  })

  it('returns null for missing required fields or unknown actions', () => {
    expect(commandFromPayload({ action: 'navigate', params: {} })).toBeNull()
    expect(commandFromPayload({ action: 'click', params: {} })).toBeNull()
    expect(commandFromPayload({ action: 'whoops' })).toBeNull()
  })
})

function fakeGateway() {
  const request = vi.fn().mockResolvedValue({ status: 'ok' })

  return { gateway: { request }, request }
}

function lastResult(request: ReturnType<typeof vi.fn>) {
  const params = request.mock.calls.at(-1)?.[1] as { request_id: string; result: string }

  return { requestId: params.request_id, result: JSON.parse(params.result) }
}

describe('handleBrowserControlRequest', () => {
  beforeEach(() => {
    setBrowserAiControl(false)
    registerBrowserControlWebview(null)
  })

  afterEach(() => {
    setBrowserAiControl(false)
    registerBrowserControlWebview(null)
  })

  it('does nothing without a request_id or gateway', async () => {
    const { gateway, request } = fakeGateway()
    await handleBrowserControlRequest({ action: 'read' }, gateway)
    expect(request).not.toHaveBeenCalled()
    await handleBrowserControlRequest({ request_id: 'r1', action: 'read' }, null)
    // null gateway → no throw, no call
    expect(request).not.toHaveBeenCalled()
  })

  it('replies with an error when AI control is off', async () => {
    const { gateway, request } = fakeGateway()
    registerBrowserControlWebview({ executeJavaScript: vi.fn() } as ControlWebview)
    await handleBrowserControlRequest({ request_id: 'r1', action: 'read' }, gateway)
    const { requestId, result } = lastResult(request)
    expect(request).toHaveBeenCalledWith('browser_control.respond', expect.anything())
    expect(requestId).toBe('r1')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('disabled')
  })

  it('replies with an error when no webview is registered', async () => {
    const { gateway, request } = fakeGateway()
    $browserAiControl.set(true)
    await handleBrowserControlRequest({ request_id: 'r2', action: 'read' }, gateway)
    const { result } = lastResult(request)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not open')
  })

  it('runs the command and replies with the result when enabled', async () => {
    const { gateway, request } = fakeGateway()
    $browserAiControl.set(true)
    const executeJavaScript = vi.fn().mockResolvedValue({ found: true })
    registerBrowserControlWebview({ executeJavaScript } as ControlWebview)

    await handleBrowserControlRequest({ request_id: 'r3', action: 'click', params: { selector: '#go' } }, gateway)

    expect(executeJavaScript).toHaveBeenCalled()
    const { requestId, result } = lastResult(request)
    expect(requestId).toBe('r3')
    expect(result).toEqual({ ok: true, found: true })
  })

  it('replies with an error for an unrecognized command', async () => {
    const { gateway, request } = fakeGateway()
    $browserAiControl.set(true)
    registerBrowserControlWebview({ executeJavaScript: vi.fn() } as ControlWebview)
    await handleBrowserControlRequest({ request_id: 'r4', action: 'nope' }, gateway)
    const { result } = lastResult(request)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unrecognized')
  })
})
