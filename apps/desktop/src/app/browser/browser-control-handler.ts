import { $browserAiControl, getBrowserControlWebview } from '@/store/browser'

import { type BrowserCommand, type BrowserCommandResult, runBrowserCommand } from './browser-control'

// Minimal gateway surface this handler needs — keeps it unit-testable without
// the full client.
export interface GatewayReplier {
  request: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}

interface BrowserControlPayload {
  request_id?: unknown
  action?: unknown
  params?: unknown
}

// Translate the Python tool's {action, params} into a typed BrowserCommand.
// Returns null for anything unrecognized.
export function commandFromPayload(payload: BrowserControlPayload): BrowserCommand | null {
  const action = typeof payload.action === 'string' ? payload.action : ''

  const params = (payload.params && typeof payload.params === 'object' ? payload.params : {}) as Record<
    string,
    unknown
  >

  switch (action) {
    case 'navigate': {
      const url = typeof params.url === 'string' ? params.url : ''

      return url ? { kind: 'navigate', url } : null
    }

    case 'read':
      return { kind: 'read' }
    case 'click': {
      const selector = typeof params.selector === 'string' ? params.selector : ''

      return selector ? { kind: 'click', selector } : null
    }

    case 'type': {
      const selector = typeof params.selector === 'string' ? params.selector : ''
      const text = typeof params.text === 'string' ? params.text : ''

      return selector ? { kind: 'type', selector, text, submit: Boolean(params.submit) } : null
    }

    default:
      return null
  }
}

// Run a gateway browser_control.request: gate on the user's AI-control toggle,
// resolve the live webview, execute, and reply via browser_control.respond so the
// blocked Python tool unblocks. ALWAYS replies (even on failure) — a missing
// reply would hang the agent until its timeout.
export async function handleBrowserControlRequest(
  payload: BrowserControlPayload | undefined,
  gateway: GatewayReplier | null
): Promise<void> {
  const requestId = typeof payload?.request_id === 'string' ? payload.request_id : ''

  if (!requestId || !gateway) {
    return
  }

  const reply = (result: BrowserCommandResult) =>
    gateway.request('browser_control.respond', { request_id: requestId, result: JSON.stringify(result) })

  if (!$browserAiControl.get()) {
    await reply({ ok: false, error: 'AI browser control is disabled. Enable it in the Browser panel.' })

    return
  }

  const webview = getBrowserControlWebview()

  if (!webview) {
    await reply({ ok: false, error: 'The Browser tool window is not open or has no page loaded.' })

    return
  }

  const command = commandFromPayload(payload ?? {})

  if (!command) {
    await reply({ ok: false, error: 'Unrecognized or incomplete browser command.' })

    return
  }

  const result = await runBrowserCommand(webview, command)
  await reply(result)
}
