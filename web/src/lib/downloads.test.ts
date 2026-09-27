import { afterEach, describe, expect, it } from 'vitest'
import { shouldAsk } from './downloads'

const setConnection = (type?: string) =>
  Object.defineProperty(navigator, 'connection', { value: type ? { type, addEventListener() {} } : undefined, configurable: true })

describe('shouldAsk before a large download', () => {
  afterEach(() => setConnection(undefined))

  it('asks on a phone with Save mobile data on', () => {
    expect(shouldAsk(4_800_000, true)).toBe(true)
    expect(shouldAsk(300_000, true)).toBe(false) // small files never ask
  })

  it('does not ask on a computer just because Save mobile data is on', () => {
    expect(shouldAsk(4_800_000, true, true)).toBe(false)
  })

  it('asks on a computer that reports mobile data (tethered laptop)', () => {
    setConnection('cellular')
    expect(shouldAsk(4_800_000, false, true)).toBe(true)
  })
})
