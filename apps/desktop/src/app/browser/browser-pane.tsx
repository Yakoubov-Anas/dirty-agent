import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import {
  $browserAiControl,
  $browserLoadRequest,
  $browserUrl,
  navigateBrowser,
  registerBrowserControlWebview,
  reloadBrowser,
  setBrowserAiControl
} from '@/store/browser'
import { BROWSER_PANE_ID } from '@/store/layout'
import { $toolWindowSide } from '@/store/tool-windows'

import { SidebarPanelLabel } from '../shell/sidebar-label'

import { attachPickedElement, ELEMENT_PICKER_SCRIPT, type PickedElement } from './element-picker'

// Dedicated browser webview. Its own partition (cookies/session) keeps it fully
// isolated from the right-rail preview pane's `persist:hermes-preview`.
type BrowserWebview = HTMLElement & {
  canGoBack?: () => boolean
  canGoForward?: () => boolean
  executeJavaScript?: (code: string) => Promise<unknown>
  getURL?: () => string
  goBack?: () => void
  goForward?: () => void
  loadURL?: (url: string) => void
  reload?: () => void
  stop?: () => void
}

export function BrowserPane() {
  const { t } = useI18n()
  const b = t.browser
  const side = useStore($toolWindowSide(BROWSER_PANE_ID))
  const url = useStore($browserUrl)
  const loadRequest = useStore($browserLoadRequest)
  const aiControl = useStore($browserAiControl)

  const hostRef = useRef<HTMLDivElement | null>(null)
  const webviewRef = useRef<BrowserWebview | null>(null)
  const lastLoadRequestRef = useRef(loadRequest)

  const [inputValue, setInputValue] = useState(url)
  const [currentUrl, setCurrentUrl] = useState(url)
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [picking, setPicking] = useState(false)

  const hasPage = Boolean(url)

  const syncNavState = useCallback(() => {
    const webview = webviewRef.current

    setCanBack(Boolean(webview?.canGoBack?.()))
    setCanForward(Boolean(webview?.canGoForward?.()))
  }, [])

  const togglePick = useCallback(async () => {
    const webview = webviewRef.current

    if (!webview?.executeJavaScript || !hasPage) {
      return
    }

    // Already picking → cancel the in-page picker.
    if (picking) {
      void webview.executeJavaScript('window.__hermesPickCancel && window.__hermesPickCancel()')

      return
    }

    setPicking(true)

    try {
      const picked = (await webview.executeJavaScript(ELEMENT_PICKER_SCRIPT)) as PickedElement | null

      if (picked) {
        attachPickedElement(picked)
      }
    } catch {
      // Page navigated away or script blocked — silently end the pick.
    } finally {
      setPicking(false)
    }
  }, [hasPage, picking])

  // Create the webview once, lazily, the first time there's a URL to load.
  useEffect(() => {
    const host = hostRef.current

    if (!host || !hasPage || webviewRef.current) {
      return
    }

    const webview = document.createElement('webview') as BrowserWebview
    webview.className = 'flex h-full w-full flex-1 bg-transparent'
    webview.setAttribute('partition', 'persist:hermes-browser')
    webview.setAttribute('src', $browserUrl.get())
    webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes')

    const onNavigate = (event: Event) => {
      const detail = event as Event & { url?: string }

      if (detail.url) {
        setCurrentUrl(detail.url)
        setInputValue(detail.url)
      }

      syncNavState()
    }

    const onStart = () => setLoading(true)

    const onStop = () => {
      setLoading(false)
      syncNavState()
    }

    webview.addEventListener('did-navigate', onNavigate)
    webview.addEventListener('did-navigate-in-page', onNavigate)
    webview.addEventListener('did-start-loading', onStart)
    webview.addEventListener('did-stop-loading', onStop)
    host.appendChild(webview)
    webviewRef.current = webview
    lastLoadRequestRef.current = $browserLoadRequest.get()
    // Expose the live webview to the gateway-driven controller (AI control).
    registerBrowserControlWebview(webview)

    return () => {
      webview.removeEventListener('did-navigate', onNavigate)
      webview.removeEventListener('did-navigate-in-page', onNavigate)
      webview.removeEventListener('did-start-loading', onStart)
      webview.removeEventListener('did-stop-loading', onStop)
      webview.remove()
      webviewRef.current = null
      registerBrowserControlWebview(null)
    }
  }, [hasPage, syncNavState])

  // React to navigation requests (new URL or re-submit/reload). The first load
  // is already handled by the webview's initial `src`, so skip it.
  useEffect(() => {
    if (loadRequest === lastLoadRequestRef.current) {
      return
    }

    lastLoadRequestRef.current = loadRequest
    webviewRef.current?.loadURL?.($browserUrl.get())
  }, [loadRequest])

  const submitUrl = () => {
    const value = inputValue.trim()

    if (!value) {
      return
    }

    navigateBrowser(value)
  }

  return (
    <aside
      aria-label={b.aria}
      className={cn(
        'relative flex h-full w-full min-w-0 flex-col overflow-hidden border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) pt-(--pane-header-reserve) text-(--ui-text-tertiary)',
        side === 'left' ? 'border-r' : 'border-l'
      )}
    >
      {/* Header label */}
      <div className="flex h-8 shrink-0 items-center gap-1 px-2.5">
        <SidebarPanelLabel>{b.title}</SidebarPanelLabel>
      </div>

      {/* Navigation toolbar */}
      <div className="flex shrink-0 items-center gap-0.5 px-1.5 pb-1.5">
        <Tip label={b.back}>
          <Button
            aria-label={b.back}
            className="size-6 rounded-md text-(--ui-text-secondary)!"
            disabled={!canBack}
            onClick={() => {
              triggerHaptic('tap')
              webviewRef.current?.goBack?.()
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name="arrow-left" size="0.875rem" />
          </Button>
        </Tip>
        <Tip label={b.forward}>
          <Button
            aria-label={b.forward}
            className="size-6 rounded-md text-(--ui-text-secondary)!"
            disabled={!canForward}
            onClick={() => {
              triggerHaptic('tap')
              webviewRef.current?.goForward?.()
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name="arrow-right" size="0.875rem" />
          </Button>
        </Tip>
        <Tip label={loading ? b.stop : b.reload}>
          <Button
            aria-label={loading ? b.stop : b.reload}
            className="size-6 rounded-md text-(--ui-text-secondary)!"
            disabled={!hasPage}
            onClick={() => {
              triggerHaptic('tap')

              if (loading) {
                webviewRef.current?.stop?.()
              } else {
                reloadBrowser()
                webviewRef.current?.reload?.()
              }
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name={loading ? 'close' : 'refresh'} size="0.875rem" />
          </Button>
        </Tip>
        <Input
          aria-label={b.urlPlaceholder}
          className="h-6 min-w-0 flex-1 rounded-md text-xs"
          onChange={event => setInputValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submitUrl()
            }
          }}
          placeholder={b.urlPlaceholder}
          spellCheck={false}
          value={inputValue}
        />
        <Tip label={picking ? b.pickCancel : b.pickElement}>
          <Button
            aria-label={picking ? b.pickCancel : b.pickElement}
            aria-pressed={picking}
            className={cn(
              'size-6 rounded-md text-(--ui-text-secondary)!',
              picking && 'bg-primary/15 text-primary!'
            )}
            disabled={!hasPage}
            onClick={() => {
              triggerHaptic('tap')
              void togglePick()
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name="inspect" size="0.875rem" />
          </Button>
        </Tip>
        <Tip label={aiControl ? b.aiControlOn : b.aiControlOff}>
          <Button
            aria-label={aiControl ? b.aiControlOn : b.aiControlOff}
            aria-pressed={aiControl}
            className={cn(
              'size-6 rounded-md text-(--ui-text-secondary)!',
              aiControl && 'bg-primary/15 text-primary!'
            )}
            onClick={() => {
              triggerHaptic('tap')
              setBrowserAiControl(!aiControl)
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name={aiControl ? 'unlock' : 'lock'} size="0.875rem" />
          </Button>
        </Tip>
        <Tip label={b.openExternal}>
          <Button
            aria-label={b.openExternal}
            className="size-6 rounded-md text-(--ui-text-secondary)!"
            disabled={!currentUrl}
            onClick={() => {
              triggerHaptic('tap')

              if (currentUrl) {
                void window.hermesDesktop?.openExternal(currentUrl)
              }
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Codicon name="link-external" size="0.875rem" />
          </Button>
        </Tip>
      </div>

      {/* Webview / empty state */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-transparent">
        <div className={cn('absolute inset-0 flex bg-transparent', !hasPage && 'pointer-events-none opacity-0')} ref={hostRef} />
        {!hasPage && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Codicon className="text-(--ui-text-tertiary)/60" name="globe" size="1.5rem" />
            <p className="text-xs text-(--ui-text-tertiary)">{b.empty}</p>
            <p className="text-[0.7rem] text-(--ui-text-tertiary)/70">{b.emptyHint}</p>
          </div>
        )}
      </div>
    </aside>
  )
}
