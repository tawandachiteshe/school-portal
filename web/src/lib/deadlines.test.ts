import { describe, expect, it } from 'vitest'
import { acceptedText } from './deadlines'

describe('acceptedText', () => {
  it('says which files to upload, like the design', () => {
    expect(acceptedText(['.c', '.pdf'])).toBe('a .c file or PDF')
    expect(acceptedText(['.pdf'])).toBe('a PDF')
    expect(acceptedText(null)).toBeNull()
  })
})
