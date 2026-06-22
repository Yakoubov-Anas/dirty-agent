import { describe, expect, it } from 'vitest'

import { buildElementContext, type PickedElement } from './element-picker'

const base: PickedElement = {
  url: 'https://example.com/page?q=1',
  selector: 'div#main > p:nth-of-type(2)',
  tag: 'p',
  text: 'Hello world',
  html: '<p>Hello world</p>',
  rect: { x: 10, y: 20, width: 300, height: 40 }
}

describe('buildElementContext', () => {
  it('labels with tag and host', () => {
    expect(buildElementContext(base).label).toBe('p @ example.com')
  })

  it('includes selector, url, position, text and html', () => {
    const { text } = buildElementContext(base)
    expect(text).toContain('https://example.com/page?q=1')
    expect(text).toContain('Selector: div#main > p:nth-of-type(2)')
    expect(text).toContain('300×40 at (10, 20)')
    expect(text).toContain('Text:')
    expect(text).toContain('Hello world')
    expect(text).toContain('HTML:')
    expect(text).toContain('<p>Hello world</p>')
  })

  it('omits the text section when the element has no text', () => {
    const { text } = buildElementContext({ ...base, text: '' })
    expect(text).not.toContain('Text:')
    expect(text).toContain('HTML:')
  })

  it('falls back to the raw url when it is not parseable', () => {
    expect(buildElementContext({ ...base, url: 'not a url' }).label).toBe('p @ not a url')
  })
})
