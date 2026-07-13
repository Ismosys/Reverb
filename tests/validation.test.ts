import { describe, expect, it } from 'vitest'
import { artistIdFromUrl, clamp, isHttpUrl, requireNumber, requireString } from '@core/utils/validation'

describe('artistIdFromUrl', () => {
  it('extracts a numeric id from an /artist/ path', () => {
    expect(artistIdFromUrl('https://www.reverbnation.com/artist/123456')).toBe('123456')
  })

  it('extracts a numeric id from a slugged /artist/ path', () => {
    expect(artistIdFromUrl('https://www.reverbnation.com/artist/some-band/987654')).toBe('987654')
  })

  it('extracts an id from an artist_id query parameter', () => {
    expect(artistIdFromUrl('https://www.reverbnation.com/main?artist_id=555')).toBe('555')
  })

  it('falls back to a slug for non-numeric profiles', () => {
    expect(artistIdFromUrl('https://www.reverbnation.com/coolband')).toBe('coolband')
  })

  it('is deterministic for the same URL', () => {
    const url = 'https://www.reverbnation.com/artist/42'
    expect(artistIdFromUrl(url)).toBe(artistIdFromUrl(url))
  })

  it('degrades gracefully on a malformed URL', () => {
    expect(artistIdFromUrl('not a url')).toBe('not-a-url')
  })
})

describe('isHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isHttpUrl('http://x.com')).toBe(true)
    expect(isHttpUrl('https://x.com/a/b?c=d')).toBe(true)
  })

  it('rejects other protocols and junk', () => {
    expect(isHttpUrl('ftp://x.com')).toBe(false)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
    expect(isHttpUrl(null)).toBe(false)
  })
})

describe('clamp', () => {
  it('bounds values into range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })
})

describe('requireString', () => {
  it('trims and returns valid strings', () => {
    expect(requireString('  hi ', 'f')).toBe('hi')
  })

  it('throws on empty/blank/non-string', () => {
    expect(() => requireString('', 'f')).toThrow()
    expect(() => requireString('   ', 'f')).toThrow()
    expect(() => requireString(123, 'f')).toThrow()
  })
})

describe('requireNumber', () => {
  it('coerces numeric strings', () => {
    expect(requireNumber('42', 'f')).toBe(42)
  })

  it('enforces min/max', () => {
    expect(() => requireNumber(5, 'f', { min: 10 })).toThrow()
    expect(() => requireNumber(50, 'f', { max: 10 })).toThrow()
    expect(requireNumber(7, 'f', { min: 1, max: 10 })).toBe(7)
  })

  it('rejects NaN and non-finite', () => {
    expect(() => requireNumber('abc', 'f')).toThrow()
    expect(() => requireNumber(Infinity, 'f')).toThrow()
  })
})
