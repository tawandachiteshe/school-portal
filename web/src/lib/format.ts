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
