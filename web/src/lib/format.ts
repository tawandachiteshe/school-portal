// Dates and numbers in the portal's voice: "Thursday 11 March", "Thu 11 Mar, 10:00".
// Always Africa/Harare, whatever the device says, so times match the timetable on the wall.

export const TZ = 'Africa/Harare'

const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })

export function formatLongDate(d: Date): string {
  return longDate.format(d)
}

export function greeting(d: Date): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }).format(d))
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

// "+263773184521" → "+263 77 ••• 4521"
export function maskPhone(e164: string): string {
  const m = /^\+(\d{3})(\d{2})\d+(\d{4})$/.exec(e164)
  return m ? `+${m[1]} ${m[2]} ••• ${m[3]}` : e164
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts })
const hm = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const shortDay = fmt({ weekday: 'short', day: 'numeric', month: 'short' })
const dayMonth = fmt({ day: 'numeric', month: 'short' })
const weekdayLong = fmt({ weekday: 'long' })
const ymd = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' })

// Calendar date in Harare as YYYY-MM-DD, for day comparisons.
function dayKey(d: Date): string {
  return ymd.format(d).split('/').reverse().join('-')
}

// Whole calendar days from `now` to `d` in Harare (0 = same day).
export function calendarDaysBetween(now: Date, d: Date): number {
  return Math.round((Date.parse(dayKey(d)) - Date.parse(dayKey(now))) / 86_400_000)
}

export const time = (d: Date) => hm.format(d) // "10:00"
// en-GB writes "Sept"; the designs use three-letter months throughout.
const threeLetter = (s: string) => s.replace('Sept', 'Sep')
export const shortDate = (d: Date) => threeLetter(shortDay.format(d).replace(',', '')) // "Thu 11 Mar"
export const shortDateTime = (d: Date) => `${shortDate(d)}, ${time(d)}` // "Thu 11 Mar, 10:00"
export const weekday = (d: Date) => weekdayLong.format(d) // "Monday"

// "in 20 min", "today", "tomorrow", "in 4 days" (design/Main, Deadlines).
export function relativeDue(due: Date, now: Date): string {
  const mins = Math.round((due.getTime() - now.getTime()) / 60_000)
  if (mins < 0) return 'started'
  if (mins < 60) return mins <= 1 ? 'now' : `in ${mins} min`
  const days = calendarDaysBetween(now, due)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

// Amber rule (docs/design-handoff.md): due within 48 hours and not submitted.
export function isUrgent(due: Date, now: Date, submitted: boolean): boolean {
  const ms = due.getTime() - now.getTime()
  return !submitted && ms >= 0 && ms <= 48 * 3_600_000
}

// Announcement timestamps: "Today, 07:15", "Yesterday", "2 Mar".
export function postedAt(d: Date, now: Date): string {
  const days = calendarDaysBetween(d, now)
  if (days === 0) return `Today, ${time(d)}`
  if (days === 1) return 'Yesterday'
  return threeLetter(dayMonth.format(d))
}

// "1.2 MB", "640 KB"
export function fileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1000))} KB`
}

const MIME_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/zip': 'ZIP',
}

export function fileKind(mime: string | null): string {
  return (mime && MIME_LABEL[mime]) || 'FILE'
}
