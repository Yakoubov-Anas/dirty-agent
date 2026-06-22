import { describe, expect, it } from 'vitest'

import {
  appendRunLines,
  createRunConfig,
  cwdKey,
  formatEnvText,
  parseEnvText,
  removeRunConfigFrom,
  type RunConfig,
  type RunLine,
  upsertRunConfig
} from './run-configs'

describe('cwdKey', () => {
  it('uses the cwd, falling back to a global bucket', () => {
    expect(cwdKey('/home/x/proj')).toBe('/home/x/proj')
    expect(cwdKey('   ')).toBe('__global__')
    expect(cwdKey('')).toBe('__global__')
  })
})

describe('createRunConfig', () => {
  it('fills defaults and generates an id', () => {
    const c = createRunConfig({ name: 'Tests', command: 'npm test' })
    expect(c.name).toBe('Tests')
    expect(c.command).toBe('npm test')
    expect(c.id).toMatch(/^run_/)
    expect(c.cwd).toBeUndefined()
    expect(c.env).toBeUndefined()
  })

  it('keeps a provided id, cwd and env', () => {
    const c = createRunConfig({ id: 'x1', name: 'A', command: 'ls', cwd: '/tmp', env: { K: 'v' } })
    expect(c.id).toBe('x1')
    expect(c.cwd).toBe('/tmp')
    expect(c.env).toEqual({ K: 'v' })
  })

  it('drops blank name to a default and trims cwd', () => {
    const c = createRunConfig({ name: '   ', command: 'ls', cwd: '  /a  ' })
    expect(c.name).toBe('New configuration')
    expect(c.cwd).toBe('/a')
  })
})

describe('upsert / remove', () => {
  const a: RunConfig = { id: 'a', name: 'A', command: 'a' }
  const b: RunConfig = { id: 'b', name: 'B', command: 'b' }

  it('appends a new config', () => {
    expect(upsertRunConfig([a], b)).toEqual([a, b])
  })

  it('replaces an existing config in place', () => {
    const updated = { ...a, command: 'a2' }
    expect(upsertRunConfig([a, b], updated)).toEqual([updated, b])
  })

  it('removes by id', () => {
    expect(removeRunConfigFrom([a, b], 'a')).toEqual([b])
    expect(removeRunConfigFrom([a, b], 'missing')).toEqual([a, b])
  })
})

describe('env text', () => {
  it('parses KEY=value lines, ignoring blanks/comments/bad lines', () => {
    const env = parseEnvText('A=1\n\n# comment\nB = two = 2\nnope\n=bad\nC=')
    expect(env).toEqual({ A: '1', B: 'two = 2', C: '' })
  })

  it('round-trips format → parse', () => {
    const env = { FOO: 'bar', BAZ: 'qux' }
    expect(parseEnvText(formatEnvText(env))).toEqual(env)
  })

  it('formats undefined as empty', () => {
    expect(formatEnvText(undefined)).toBe('')
  })
})

describe('appendRunLines', () => {
  const base: RunLine[] = []

  it('splits a chunk into lines and ignores a trailing newline', () => {
    const out = appendRunLines(base, 'stdout', 'one\ntwo\n', 0)
    expect(out.map(l => l.text)).toEqual(['one', 'two'])
    expect(out.every(l => l.stream === 'stdout')).toBe(true)
  })

  it('keeps a partial last line (no trailing newline)', () => {
    const out = appendRunLines(base, 'stdout', 'partial', 0)
    expect(out.map(l => l.text)).toEqual(['partial'])
  })

  it('appends to existing lines', () => {
    const first = appendRunLines(base, 'stdout', 'a\n', 0)
    const second = appendRunLines(first, 'stderr', 'b\n', 5)
    expect(second.map(l => l.text)).toEqual(['a', 'b'])
    expect(second[1].stream).toBe('stderr')
  })
})
