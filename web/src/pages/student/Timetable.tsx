import { CalendarDays, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { SubPage } from '@/components/shell/sub-page'
import { Empty } from '@/components/student/section'
import { calendarDaysBetween, time, weekday } from '@/lib/format'
import type { Slot } from '@/api/generated/model'
import { useWeekTimetable } from '@/api/generated/records/records'
import { onDay } from '@/lib/records'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

const monthDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'Africa/Harare' })
const dayNum = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'Africa/Harare' }).format(d)
const addDays = (ymd: string, n: number) => {
  const d = onDay(ymd)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// "8–12 March", "29 September – 3 October"
function range(a: Date, b: Date) {
  const [da, ma] = monthDay.format(a).split(' ')
  const [db, mb] = monthDay.format(b).split(' ')
  return ma === mb ? `${da}–${db} ${ma}` : `${da} ${ma} – ${db} ${mb}`
}

const shortAssessment = (t: string) => t.split(':')[0]

function ClassRow({ c, current, now }: { c: Slot; current: boolean; now: Date }) {
  const start = new Date(c.starts_at)
  const end = new Date(c.ends_at)
  const finished = end <= now
  return (
    <li
      className={cn(
        'grid grid-cols-[64px_minmax(0,1fr)] gap-3 py-3.5',
        finished && 'text-muted-foreground',
        current && '-mx-2 rounded-md bg-primary-soft px-2',
      )}
    >
      <span className={cn('font-mono text-sm', current && 'font-medium text-primary')}>
        {time(start)}
        <br />
        <span className={cn(!finished && 'text-muted-foreground', current && 'font-normal')}>{time(end)}</span>
      </span>
      <span>
        <span className={cn('block', !finished && 'font-medium', c.cancelled && 'line-through')}>
          <span className="font-mono">{c.module_code}</span>{' '}
          {c.assessment_title ? shortAssessment(c.assessment_title) : c.module_name}
        </span>
        <span className={cn('text-sm', !finished && 'text-muted-foreground', c.cancelled && 'text-destructive')}>
          {c.cancelled
            ? `Cancelled${c.change_reason ? ` · ${c.change_reason}` : ''}`
            : [c.venue, c.lecturer].filter(Boolean).join(' · ')}
        </span>
      </span>
    </li>
  )
}

export default function Timetable() {
  const [start, setStart] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const { data: w, isPending, isError } = useWeekTimetable(start ? { start } : undefined)
  const now = useNow()

  const days = w?.days ?? []
  const todayIdx = days.findIndex((d) => calendarDaysBetween(now, onDay(d.date)) === 0)
  const selected = picked && days.some((d) => d.date === picked) ? picked : (days[Math.max(0, todayIdx)]?.date ?? null)
  const day = days.find((d) => d.date === selected)
  const current = day?.classes.findIndex((c) => !c.cancelled && new Date(c.ends_at) > now) ?? -1
  const isToday = selected !== null && calendarDaysBetween(now, onDay(selected)) === 0

  const go = (n: number) => {
    if (!w) return
    setPicked(null)
    setStart(addDays(w.starts_on, n * 7))
  }

  return (
    <SubPage title={<span className="font-semibold">Timetable</span>} back="/modules" backLabel="Back">
      <main className="flex grow flex-col gap-5 px-4 py-5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous week"
            disabled={!w?.has_previous}
            onClick={() => go(-1)}
            className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground disabled:opacity-40"
          >
            <ChevronLeft className="size-5" strokeWidth={1.5} />
          </button>
          <div className="text-center">
            {w ? (
              <>
                <h1 className="text-lg leading-6 font-semibold">
                  {w.week ? `Week ${w.week} · ` : ''}
                  {range(onDay(w.starts_on), onDay(w.ends_on))}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {w.class_group && <span className="font-mono">{w.class_group}</span>}
                  {w.class_group && w.term_name && ' · '}
                  {w.term_name}
                </p>
              </>
            ) : (
              <Skeleton className="h-10 w-48" />
            )}
          </div>
          <button
            type="button"
            aria-label="Next week"
            disabled={!w?.has_next}
            onClick={() => go(1)}
            className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground disabled:opacity-40"
          >
            <ChevronRight className="size-5" strokeWidth={1.5} />
          </button>
        </div>

        {isError && <Empty>Couldn't load the timetable. Check your connection.</Empty>}
        {isPending && <Skeleton className="h-14" />}

        {w && (
          <>
            <div
              role="tablist"
              aria-label="Day"
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
            >
              {days.map((d) => {
                const date = onDay(d.date)
                const on = d.date === selected
                const today = calendarDaysBetween(now, date) === 0
                return (
                  <button
                    key={d.date}
                    role="tab"
                    aria-selected={on}
                    aria-label={`${weekday(date)} ${dayNum(date)}${today ? ', today' : ''}`}
                    onClick={() => setPicked(d.date)}
                    className={cn(
                      'flex h-14 flex-col items-center justify-center rounded-md border bg-card text-muted-foreground',
                      on && 'border-primary bg-primary text-primary-foreground',
                    )}
                  >
                    <span className="text-xs">{today ? 'Today' : weekday(date).slice(0, 3)}</span>
                    <span className={cn('font-mono', on ? 'font-semibold' : 'font-medium')}>{dayNum(date)}</span>
                  </button>
                )
              })}
            </div>

            {day && day.classes.length ? (
              <ul className="border-y [&>li+li]:border-t" role="tabpanel">
                {day.classes.map((c, i) => (
                  <ClassRow key={c.starts_at} c={c} current={isToday && i === current} now={now} />
                ))}
              </ul>
            ) : (
              <Empty>No classes on {day ? weekday(onDay(day.date)) : 'this day'}.</Empty>
            )}

            {w.notices.map((n) => (
              <Alert key={n.announcement_id} variant="info">
                <Info strokeWidth={1.5} />
                <p className="text-sm">
                  <span className="font-semibold">{weekday(onDay(n.date))}:</span> {n.text}
                </p>
              </Alert>
            ))}

            <a
              href="/api/student/timetable.ics"
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary"
            >
              <CalendarDays className="size-4" strokeWidth={1.5} aria-hidden />
              Add this timetable to my phone calendar
            </a>
          </>
        )}
      </main>
    </SubPage>
  )
}
