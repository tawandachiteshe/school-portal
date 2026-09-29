import { describe, expect, it } from 'vitest'
import { code128 } from './code128'

describe('code128', () => {
  it('encodes start, data, checksum and stop', () => {
    const { width } = code128('CC20270142')
    // 11 modules per symbol × (start + 10 chars + checksum) + 13 for stop + quiet zones.
    expect(width).toBe(11 * 12 + 13 + 20)
  })

  it('rejects characters outside set B', () => {
    expect(() => code128('é')).toThrow()
  })
})
