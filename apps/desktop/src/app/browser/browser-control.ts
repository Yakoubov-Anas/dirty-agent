// Pure command executor for AI-driven control of the dedicated browser webview
// (phase 3, Option B). Each command takes a minimal webview handle and returns a
// structured result. Kept dependency-free + side-effect-isolated so it is unit
// testable with a fake handle, and reused by the gateway-driven controller.

export interface ControlWebview {
  executeJavaScript?: (code: string) => Promise<unknown>
  getURL?: () => string
  loadURL?: (url: string) => void
}

export type BrowserCommand =
  | { kind: 'navigate'; url: string }
  | { kind: 'read' }
  | { kind: 'click'; selector: string }
  | { kind: 'type'; selector: string; text: string; submit?: boolean }

export interface BrowserCommandResult {
  ok: boolean
  // navigate
  url?: string
  // read
  title?: string
  text?: string
  html?: string
  // click / type
  found?: boolean
  error?: string
}

const READ_TEXT_CAP = 6000
const READ_HTML_CAP = 8000

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i

// JS-string literal escaping for values we inline into executeJavaScript code.
function jsString(value: string): string {
  return JSON.stringify(value)
}

function normalizeNavigateUrl(raw: string): string {
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

  return `https://${value}`
}

function readScript(): string {
  return `(function () {
    return {
      url: location.href,
      title: document.title || '',
      text: (document.body ? (document.body.innerText || document.body.textContent || '') : '').replace(/\\s+/g, ' ').trim().slice(0, ${READ_TEXT_CAP}),
      html: (document.documentElement ? document.documentElement.outerHTML : '').slice(0, ${READ_HTML_CAP})
    };
  })();`
}

function clickScript(selector: string): string {
  return `(function () {
    var el = document.querySelector(${jsString(selector)});
    if (!el) return { found: false };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    if (typeof el.click === 'function') { el.click(); } else {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    return { found: true };
  })();`
}

function typeScript(selector: string, text: string, submit: boolean): string {
  return `(function () {
    var el = document.querySelector(${jsString(selector)});
    if (!el) return { found: false };
    el.focus();
    var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) { setter.set.call(el, ${jsString(text)}); } else { el.value = ${jsString(text)}; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (${submit ? 'true' : 'false'}) {
      var form = el.form || el.closest('form');
      if (form && typeof form.requestSubmit === 'function') { form.requestSubmit(); }
      else if (form) { form.submit(); }
      else { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13 })); }
    }
    return { found: true };
  })();`
}

export async function runBrowserCommand(
  webview: ControlWebview,
  command: BrowserCommand
): Promise<BrowserCommandResult> {
  try {
    if (command.kind !== 'navigate' && !webview.executeJavaScript) {
      return { ok: false, error: 'scripting unavailable' }
    }

    switch (command.kind) {
      case 'navigate': {
        const url = normalizeNavigateUrl(command.url)

        if (!url) {
          return { ok: false, error: 'empty url' }
        }

        if (!webview.loadURL) {
          return { ok: false, error: 'navigation unavailable' }
        }

        webview.loadURL(url)

        return { ok: true, url }
      }

      case 'read': {
        const result = (await webview.executeJavaScript!(readScript())) as {
          url?: string
          title?: string
          text?: string
          html?: string
        } | null

        return {
          ok: true,
          url: result?.url ?? webview.getURL?.() ?? '',
          title: result?.title ?? '',
          text: result?.text ?? '',
          html: result?.html ?? ''
        }
      }

      case 'click': {
        const result = (await webview.executeJavaScript!(clickScript(command.selector))) as {
          found?: boolean
        } | null

        const found = Boolean(result?.found)

        return found ? { ok: true, found: true } : { ok: false, found: false, error: 'selector not found' }
      }

      case 'type': {
        const result = (await webview.executeJavaScript!(
          typeScript(command.selector, command.text, Boolean(command.submit))
        )) as { found?: boolean } | null

        const found = Boolean(result?.found)

        return found ? { ok: true, found: true } : { ok: false, found: false, error: 'selector not found' }
      }

      default: {
        return { ok: false, error: 'unknown command' }
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
