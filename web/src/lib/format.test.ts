import { describe, expect, it } from 'vitest'
import {
  acceptedText,
  dateWithYear,
  dayDateTimeWithYear,
  fileSize,
  isUrgent,
  longDateWithYear,
  maskPhone,
  onDay,
  postedAt,
  relativeDue,
  shortDateTime,
  weekRange,
} from './format'

// 2027-03-11 is a Thursday. Harare is UTC+2 with no DST.
const now = new Date('2027-03-11T07:40:00Z') // 09:40 in Harare

describe('format', () => {
  it('writes relative due times like the designs', () => {
    expect(relativeDue(new Date('2027-03-11T08:00:00Z'), now)).toBe('in 20 min')
    expect(relativeDue(new Date('2027-03-11T15:00:00Z'), now)).toBe('today')
    expect(relativeDue(new Date('2027-03-12T15:00:00Z'), now)).toBe('tomorrow')
    expect(relativeDue(new Date('2027-03-15T21:59:00Z'), now)).toBe('in 4 days')
    expect(relativeDue(new Date('2027-04-09T15:00:00Z'), now)).toBe('in 4 weeks')
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

describe('acceptedText', () => {
  it('says which files to upload, like the design', () => {
    expect(acceptedText(['.c', '.pdf'])).toBe('a .c file or PDF')
    expect(acceptedText(['.pdf'])).toBe('a PDF')
    expect(acceptedText(null)).toBeNull()
  })
})

describe('dates with a year', () => {
  it('drops the comma Intl puts after the weekday', () => {
    const d = new Date('2027-03-11T08:00:00Z')
    expect(dateWithYear(d)).toBe('11 March 2027')
    expect(dayDateTimeWithYear(d)).toBe('Thu 11 March 2027, 10:00')
    expect(longDateWithYear(d)).toBe('Thursday 11 March 2027')
    expect(weekRange(onDay('2027-03-08'), onDay('2027-03-12'))).toBe('8–12 March')
    expect(weekRange(onDay('2026-09-29'), onDay('2026-10-03'))).toBe('29 September – 3 October')
  })
})

describe('months', () => {
  it('uses three-letter months', () => {
    expect(postedAt(new Date('2026-09-18T10:00:00Z'), new Date('2026-09-27T10:00:00Z'))).toBe('18 Sep')
    expect(shortDateTime(new Date('2026-09-28T06:00:00Z'))).toBe('Mon 28 Sep, 08:00')
  })
})
