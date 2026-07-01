import { describe, expect, it } from 'vitest'
import { generateToken, safeCompare } from '../../src/flow/token.js'

describe('generateToken', () => {
  it('returns a 64-character hex string (256bit)', () => {
    const token = generateToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces different tokens across calls', () => {
    expect(generateToken()).not.toBe(generateToken())
  })
})

describe('safeCompare', () => {
  it('returns true for equal strings', () => {
    expect(safeCompare('abc', 'abc')).toBe(true)
  })

  it('returns false for different strings of equal length', () => {
    expect(safeCompare('abc', 'abd')).toBe(false)
  })

  it('returns false without throwing when lengths differ', () => {
    expect(() => safeCompare('short', 'a-much-longer-string')).not.toThrow()
    expect(safeCompare('short', 'a-much-longer-string')).toBe(false)
  })
})
