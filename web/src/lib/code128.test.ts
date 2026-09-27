import { describe, expect, it } from 'vitest'
import { code128 } from './code128'

describe('code128', () => {
  it('encodes start, data, checksum and stop', () => {
    const { width } = code128('TCFL20270142')
    // 11 modules per symbol × (start + 12 chars + checksum) + 13 for stop + quiet zones.
    expect(width).toBe(11 * 14 + 13 + 20)
  })

  it('rejects characters outside set B', () => {
    expect(() => code128('é')).toThrow()
  })
})
