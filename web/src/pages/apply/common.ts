import type { ApplyStep, MyApplication } from '@/api/generated/model'

export const STEP_PATH: Record<ApplyStep, string> = {
  programme: '/apply/programme',
  national_id: '/apply/id',
  birth_certificate: '/apply/birth-certificate',
  results: '/apply/results',
  review: '/apply/review',
  submit: '/apply/submit',
}

// Where an applicant belongs: the next unfinished step while drafting, otherwise the status or offer.
export function applyHome(app: MyApplication | null | undefined): string {
  if (!app) return STEP_PATH.programme
  if (app.status === 'draft' && app.payment_waiting) return '/apply/pay'
  if (app.status === 'draft') return STEP_PATH[app.next_step ?? 'programme']
  if (app.status === 'accepted') return '/apply/offer'
  return '/apply/status'
}

const tz = 'Africa/Harare'
const fullDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz })
const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz })
const longDay = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz })

// "Mon 12 October 2026"
export const dayText = (d: Date) => fullDate.format(d).replace(',', '')
// "Mon 12 October 2026, 14:05"
export const dayTimeText = (d: Date) => `${dayText(d)}, ${hm.format(d)}`
// "Friday 13 November 2026"
export const longDayText = (d: Date) => longDay.format(d).replace(',', '')
// A date-only value ("2026-10-30") at midday, so it never shifts a day.
export const dateOnly = (s: string) => new Date(`${s}T12:00:00`)
