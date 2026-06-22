import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  $browserLoadRequest,
  $browserUrl,
  navigateBrowser,
  normalizeBrowserInput,
  reloadBrowser
} from './browser'

describe('normalizeBrowserInput', () => {
  it('keeps explicit schemes untouched', () => {
    expect(normalizeBrowserInput('https://example.com')).toBe('https://example.com')
    expect(normalizeBrowserInput('http://example.com')).toBe('http://example.com')
    expect(normalizeBrowserInput('file:///tmp/x')).toBe('file:///tmp/x')
  })

  it('prefixes https for bare hosts', () => {
    expect(normalizeBrowserInput('example.com')).toBe('https://example.com')
    expect(normalizeBrowserInput('example.com/path?q=1')).toBe('https://example.com/path?q=1')
  })

  it('uses http for localhost', () => {
    expect(normalizeBrowserInput('localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeBrowserInput('localhost')).toBe('http://localhost')
  })

  it('falls back to a web search for free text', () => {
    expect(normalizeBrowserInput('hello world')).toBe('https://duckduckgo.com/?q=hello%20world')
    expect(normalizeBrowserInput('single')).toBe('https://duckduckgo.com/?q=single')
  })

  it('returns empty for blank input', () => {
    expect(normalizeBrowserInput('   ')).toBe('')
  })
})

describe('navigateBrowser / reloadBrowser', () => {
  beforeEach(() => {
    $browserUrl.set('')
    $browserLoadRequest.set(0)
  })

  afterEach(() => {
    $browserUrl.set('')
    $browserLoadRequest.set(0)
  })

  it('sets the url and bumps the load token', () => {
    navigateBrowser('example.com')
    expect($browserUrl.get()).toBe('https://example.com')
    expect($browserLoadRequest.get()).toBe(1)
  })

  it('bumps the token again on identical re-submit', () => {
    navigateBrowser('example.com')
    navigateBrowser('example.com')
    expect($browserLoadRequest.get()).toBe(2)
  })

  it('reload bumps the token only when a page is loaded', () => {
    reloadBrowser()
    expect($browserLoadRequest.get()).toBe(0)

    navigateBrowser('example.com')
    reloadBrowser()
    expect($browserLoadRequest.get()).toBe(2)
  })
})
