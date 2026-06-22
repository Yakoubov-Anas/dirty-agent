import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { formatRefValue } from '@/components/assistant-ui/directive-text'
import { setComposerTerminalSelection } from '@/store/composer'

export interface PickedElement {
  url: string
  selector: string
  tag: string
  text: string
  html: string
  rect: { x: number; y: number; width: number; height: number }
}

const MAX_TEXT = 2000
const MAX_HTML = 4000

// Injected into the <webview> page via webview.executeJavaScript(). Returns a
// Promise that resolves with the picked element's data, or null if the user
// cancels (Escape). A hover overlay highlights the element under the cursor;
// click selects it. window.__hermesPickCancel lets the host cancel from outside.
export const ELEMENT_PICKER_SCRIPT = `(function () {
  return new Promise(function (resolve) {
    var OVERLAY_ID = '__hermes_pick_overlay__';
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
    if (window.__hermesPickCancel) { try { window.__hermesPickCancel(); } catch (e) {} }

    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:rgba(59,130,246,0.22);outline:2px solid rgba(59,130,246,0.95);border-radius:2px;transition:all 40ms ease;top:0;left:0;width:0;height:0;';
    (document.body || document.documentElement).appendChild(overlay);
    var prevCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = 'crosshair';
    var current = null;

    function nthOfType(el) {
      var i = 1, sib = el;
      while ((sib = sib.previousElementSibling)) { if (sib.nodeName === el.nodeName) i++; }
      return i;
    }
    function cssPath(el) {
      if (!el || el.nodeType !== 1) return '';
      var parts = [];
      var node = el;
      while (node && node.nodeType === 1 && parts.length < 6) {
        var part = node.nodeName.toLowerCase();
        if (node.id) { parts.unshift(part + '#' + CSS.escape(node.id)); break; }
        var cls = (node.className && typeof node.className === 'string')
          ? node.className.trim().split(/\\s+/).slice(0, 2).filter(Boolean) : [];
        if (cls.length) part += '.' + cls.map(function (c) { return CSS.escape(c); }).join('.');
        part += ':nth-of-type(' + nthOfType(node) + ')';
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(' > ');
    }
    function move(e) {
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === overlay) return;
      current = el;
      var r = el.getBoundingClientRect();
      overlay.style.top = r.top + 'px';
      overlay.style.left = r.left + 'px';
      overlay.style.width = r.width + 'px';
      overlay.style.height = r.height + 'px';
    }
    function cleanup() {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mousedown', swallow, true);
      document.removeEventListener('pointerdown', swallow, true);
      document.removeEventListener('mouseup', swallow, true);
      document.removeEventListener('auxclick', swallow, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.documentElement.style.cursor = prevCursor;
      overlay.remove();
      window.__hermesPickCancel = null;
    }
    function pick(el) {
      var r = el.getBoundingClientRect();
      var data = {
        url: location.href,
        selector: cssPath(el),
        tag: el.nodeName.toLowerCase(),
        text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, ${MAX_TEXT}),
        html: (el.outerHTML || '').slice(0, ${MAX_HTML}),
        rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
      };
      cleanup();
      resolve(data);
    }
    // Swallow press/up so links, buttons and framework routers don't fire during
    // a pick (some navigate on mousedown/pointerdown, not click).
    function swallow(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (current) pick(current);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(); resolve(null); }
    }
    window.__hermesPickCancel = function () { cleanup(); resolve(null); };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mousedown', swallow, true);
    document.addEventListener('pointerdown', swallow, true);
    document.addEventListener('mouseup', swallow, true);
    document.addEventListener('auxclick', swallow, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  });
})();`

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

// Pure: turn a picked element into the label + fenced text block sent to the AI.
export function buildElementContext(picked: PickedElement): { label: string; text: string } {
  const label = `${picked.tag} @ ${hostFromUrl(picked.url)}`

  const lines = [
    `Picked web element from ${picked.url}`,
    `Selector: ${picked.selector}`,
    `Position: ${picked.rect.width}×${picked.rect.height} at (${picked.rect.x}, ${picked.rect.y})`
  ]

  if (picked.text) {
    lines.push('', 'Text:', picked.text)
  }

  lines.push('', 'HTML:', picked.html)

  return { label, text: lines.join('\n') }
}

// Attach a picked element to the main composer as a @terminal-style text block
// (the existing raw-text attachment path), then focus the composer.
export function attachPickedElement(picked: PickedElement) {
  const { label, text } = buildElementContext(picked)

  setComposerTerminalSelection(label, text)
  requestComposerInsert(`@terminal:${formatRefValue(label)}`, { mode: 'inline', target: 'main' })
  requestComposerFocus('main')
}
