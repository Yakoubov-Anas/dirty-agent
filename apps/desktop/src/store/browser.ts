import { atom } from 'nanostores'

import type { ControlWebview } from '@/app/browser/browser-control'
import { persistBoolean, persistString, storedBoolean, storedString } from '@/lib/storage'

const BROWSER_URL_STORAGE_KEY = 'hermes.desktop.browser.url'
const BROWSER_AI_CONTROL_STORAGE_KEY = 'hermes.desktop.browser.aiControl'

export const BROWSER_HOME_URL = 'https://duckduckgo.com'

// The URL the dedicated Browser tool window has loaded. Persisted so the panel
// restores the last page on reopen. This is OWN state — entirely separate from
// the preview pane's $previewTarget; the two browsers share nothing.
export const $browserUrl = atom<string>(storedString(BROWSER_URL_STORAGE_KEY) ?? '')

$browserUrl.subscribe(url => persistString(BROWSER_URL_STORAGE_KEY, url))

// A monotonically increasing token the pane watches to force a (re)load of the
// current $browserUrl even when the string itself didn't change (e.g. the user
// re-submits the same URL, or hits reload).
export const $browserLoadRequest = atom(0)

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i
const BARE_HOST_RE = /^[^\s/]+\.[^\s/]+/

// Turn raw address-bar input into a navigable URL: keep explicit schemes, add
// https:// to bare hosts (example.com, localhost:3000), otherwise treat it as a
// web search.
export function normalizeBrowserInput(raw: string): string {
  const value = raw.trim()

  if (!value) {
    return ''
  }

  if (SCHEME_RE.test(value)) {
    return value
  }

  if (value === 'localhost' || value.startsWith('localhost:') || value.startsWith('localhost/')) {
    return `http://${value}`
  }

  if (BARE_HOST_RE.test(value) && !value.includes(' ')) {
    return `https://${value}`
  }

  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`
}

// Load a URL in the Browser tool window. Accepts raw input (normalized) and
// always bumps the load token so an identical URL still triggers a navigation.
export function navigateBrowser(raw: string) {
  const url = normalizeBrowserInput(raw)

  if (!url) {
    return
  }

  $browserUrl.set(url)
  $browserLoadRequest.set($browserLoadRequest.get() + 1)
}

// Force a reload of whatever is currently loaded.
export function reloadBrowser() {
  if (!$browserUrl.get()) {
    return
  }

  $browserLoadRequest.set($browserLoadRequest.get() + 1)
}

// ─── AI control (phase 3) ───────────────────────────────────────────────────

// Opt-in gate: when false, the agent cannot drive the browser webview even if it
// calls the control tool. Off by default — driving acts in the user's logged-in
// session, so it's a deliberate, persisted choice (like tool approval).
export const $browserAiControl = atom<boolean>(storedBoolean(BROWSER_AI_CONTROL_STORAGE_KEY, false))

$browserAiControl.subscribe(on => persistBoolean(BROWSER_AI_CONTROL_STORAGE_KEY, on))

export function setBrowserAiControl(on: boolean) {
  $browserAiControl.set(on)
}

// Live handle to the active browser webview, registered by BrowserPane while
// mounted. A non-component gateway listener resolves the webview through this so
// it can run agent commands without prop-drilling a ref. Null when the pane is
// closed or no page is loaded.
let activeControlWebview: ControlWebview | null = null

export function registerBrowserControlWebview(webview: ControlWebview | null) {
  activeControlWebview = webview
}

export function getBrowserControlWebview(): ControlWebview | null {
  return activeControlWebview
}
