import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClassContext, DeskBar } from '@/components/shell/student-desktop'
import type { Slot, Week } from '@/api/generated/model'
import { calendarDaysBetween, dayOfMonth, isUrgent, onDay, time, weekday, weekRange } from '@/lib/format'
import { cn } from '@/lib/utils'

const HOUR = 64 // px per hour (design/DeskTimetable)
const KIND: Record<string, string> = { lecture: 'Lecture', tutorial: 'Tutorial', lab: 'Lab', consultation: 'Consultation' }
const minutesOfDay = (d: Date) => {
  const [h, m] = time(d).split(':').map(Number)
  return h * 60 + m
}

// "Lab 3 closed on Friday 2 October for network maintenance. None of…" → "Lab 3 closed"
const shortNotice = (t: string) => t.split(/ on | for |\. /)[0]

export default function TimetableDesk({
  w,
  now,
  onWeek,
}: {
  w: Week
  now: Date
  onWeek: (n: -1 | 0 | 1) => void
}) {
  // Rows from 08:00 to 17:00, stretched if anything falls outside.
  const all = w.days.flatMap((d) => d.classes)
  const first = Math.min(8 * 60, ...all.map((c) => minutesOfDay(new Date(c.starts_at))))
  const last = Math.max(17 * 60, ...all.map((c) => minutesOfDay(new Date(c.ends_at))))
  const startHour = Math.floor(first / 60)
  const endHour = Math.ceil(last / 60)
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)
  const height = (endHour - startHour) * HOUR
  const y = (d: Date) => ((minutesOfDay(d) - startHour * 60) / 60) * HOUR
  const cols = `56px repeat(${w.days.length}, minmax(0, 1fr))`
  const thisWeek = w.days.some((d) => calendarDaysBetween(now, onDay(d.date)) === 0)

  return (
    <>
      <DeskBar
        left={<ClassContext />}
        right={
          <Button variant="outline" size="sm" asChild>
            <a href="/api/student/timetable.ics">
              <CalendarDays strokeWidth={1.5} className="size-4" />
              Add to my calendar
            </a>
          </Button>
        }
      />
      <main className="flex flex-col gap-4 px-8 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">
            {w.week ? `Week ${w.week} · ` : ''}
            {weekRange(onDay(w.starts_on), onDay(w.ends_on))}
          </h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" aria-label="Previous week" disabled={!w.has_previous} onClick={() => onWeek(-1)}>
              <ChevronLeft strokeWidth={1.5} className="size-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={thisWeek} onClick={() => onWeek(0)}>
              This week
            </Button>
            <Button variant="outline" size="sm" aria-label="Next week" disabled={!w.has_next} onClick={() => onWeek(1)}>
              <ChevronRight strokeWidth={1.5} className="size-4" />
            </Button>
          </div>
        </div>

        <div className="grid border-b" style={{ gridTemplateColumns: cols }}>
          <span />
          {w.days.map((d) => {
            const date = onDay(d.date)
            const today = calendarDaysBetween(now, date) === 0
            const notice = w.notices.find((n) => n.date === d.date)
            return (
              <div
                key={d.date}
                aria-current={today ? 'date' : undefined}
                className={cn('border-l p-2', today && 'bg-primary-soft')}
              >
                <div className={cn('text-sm', today ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                  {weekday(date).slice(0, 3)}
                  {today && ' · today'}
                </div>
                <div className={cn('font-mono', today ? 'font-semibold text-primary' : 'font-medium')}>{dayOfMonth(date)}</div>
                {notice && (
                  <div className="truncate text-xs text-muted-foreground" title={notice.text}>
                    {shortNotice(notice.text)}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div className="relative" style={{ height }}>
            {hours.map((h, i) => (
              <span key={h} className="absolute right-2 font-mono text-xs text-muted-foreground" style={{ top: i * HOUR - 7 }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {w.days.map((d) => {
            const date = onDay(d.date)
            const today = calendarDaysBetween(now, date) === 0
            const current = today ? d.classes.findIndex((c) => !c.cancelled && new Date(c.ends_at) > now) : -1
            // Tests already show in their class block; mark only work that's handed in.
            const due = w.due.filter(
              (x) => (x.kind === 'assignment' || x.kind === 'project') && calendarDaysBetween(date, new Date(x.due_at)) === 0,
            )
            const nowY = y(now)
            return (
              <div
                key={d.date}
                className="relative border-l"
                style={{
                  height,
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${HOUR}px)`,
                  backgroundColor: today ? 'color-mix(in oklab, var(--primary-soft) 40%, transparent)' : undefined,
                }}
              >
                {d.classes.map((c: Slot, i) => {
                  const start = new Date(c.starts_at)
                  const end = new Date(c.ends_at)
                  const past = end <= now
                  const cur = i === current
                  const label = c.assessment_title ? c.assessment_title.split(':')[0] : (KIND[c.kind] ?? c.kind)
                  return (
                    <div
                      key={c.starts_at}
                      className={cn(
                        'absolute inset-x-1 flex flex-col gap-px overflow-hidden rounded-sm border bg-card px-2 py-1.5 text-[13px] leading-[18px]',
                        past && 'bg-background',
                        cur && 'border-primary bg-primary-soft',
                        c.cancelled && 'opacity-60',
                      )}
                      style={{ top: y(start) + 2, height: Math.max(28, y(end) - y(start) - 4) }}
                    >
                      <span className={cn('font-mono text-xs text-muted-foreground', cur && 'text-primary')}>
                        {time(start)}–{time(end)}
                        {cur && (start > now ? ' · next' : ' · now')}
                      </span>
                      <span className={cn('font-medium', past && 'font-normal text-muted-foreground', c.cancelled && 'line-through')}>
                        <span className="font-mono">{c.module_code}</span> {label}
                      </span>
                      <span className="text-muted-foreground">
                        {c.cancelled ? 'Cancelled' : [c.venue, today && !past ? c.lecturer : null].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  )
                })}
                {today && nowY >= 0 && nowY <= height && (
                  <div aria-label={`Now, ${time(now)}`} className="absolute inset-x-0 h-0.5 bg-primary" style={{ top: nowY }}>
                    <span className="absolute -top-[3px] -left-1 size-2 rounded-full bg-primary" />
                  </div>
                )}
                {due.map((x) => {
                  const at = new Date(x.due_at)
                  const top = Math.min(height - 24, Math.max(0, y(at) - 12))
                  const amber = isUrgent(at, now, x.submitted)
                  return (
                    <div key={x.id} className="absolute inset-x-1 flex items-center gap-1.5" style={{ top }}>
                      <span className={cn('h-0.5 grow', amber ? 'bg-urgent-line' : 'bg-border-strong')} />
                      <Badge variant={amber ? 'urgent' : 'neutral'} title={x.title}>
                        {time(at)} {x.title.split(':')[0]} {x.submitted ? 'submitted' : 'due'}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </main>
    </>
  )
}
