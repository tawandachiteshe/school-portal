import { describe, expect, it } from 'vitest'
import { fileSize, isUrgent, maskPhone, postedAt, relativeDue, shortDateTime } from './format'

// 2027-03-11 is a Thursday. Harare is UTC+2 with no DST.
const now = new Date('2027-03-11T07:40:00Z') // 09:40 in Harare

describe('format', () => {
  it('writes relative due times like the designs', () => {
    expect(relativeDue(new Date('2027-03-11T08:00:00Z'), now)).toBe('in 20 min')
    expect(relativeDue(new Date('2027-03-11T15:00:00Z'), now)).toBe('today')
    expect(relativeDue(new Date('2027-03-12T15:00:00Z'), now)).toBe('tomorrow')
    expect(relativeDue(new Date('2027-03-15T21:59:00Z'), now)).toBe('in 4 days')
  })

  it('counts calendar days in Harare, not UTC', () => {
    // 23:30 Harare on Thursday is 21:30 UTC; 00:30 Friday Harare is still Thursday in UTC.
    expect(relativeDue(new Date('2027-03-11T22:30:00Z'), now)).toBe('tomorrow')
  })

  it('applies the 48 hour amber rule', () => {
    expect(isUrgent(new Date('2027-03-13T07:00:00Z'), now, false)).toBe(true)
    expect(isUrgent(new Date('2027-03-13T08:00:00Z'), now, false)).toBe(false)
    expect(isUrgent(new Date('2027-03-11T08:00:00Z'), now, true)).toBe(false)
  })

  it('formats dates, times, sizes and phones', () => {
    expect(shortDateTime(new Date('2027-03-11T08:00:00Z'))).toBe('Thu 11 Mar, 10:00')
    expect(postedAt(new Date('2027-03-11T05:15:00Z'), now)).toBe('Today, 07:15')
    expect(postedAt(new Date('2027-03-10T10:00:00Z'), now)).toBe('Yesterday')
    expect(postedAt(new Date('2027-03-02T10:00:00Z'), now)).toBe('2 Mar')
    expect(fileSize(1_200_000)).toBe('1.2 MB')
    expect(fileSize(640_000)).toBe('640 KB')
    expect(maskPhone('+263773184521')).toBe('+263 77 ••• 4521')
  })
})

describe('months', () => {
  it('uses three-letter months', () => {
    expect(postedAt(new Date('2026-09-18T10:00:00Z'), new Date('2026-09-27T10:00:00Z'))).toBe('18 Sep')
    expect(shortDateTime(new Date('2026-09-28T06:00:00Z'))).toBe('Mon 28 Sep, 08:00')
  })
})
