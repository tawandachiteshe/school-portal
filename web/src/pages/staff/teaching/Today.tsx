import { Upload } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StaffTopBar } from '@/components/shell/staff-shell'
import type { MarkingItem, TeachingClass } from '@/api/generated/model'
import { useOverview } from '@/api/generated/teaching/teaching'
import { calendarDaysBetween, fileSize, formatLongDate, greeting, shortDate, time } from '@/lib/format'
import { onDay } from '@/lib/records'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from './staff-ui'

const KIND: Record<string, string> = { lecture: 'Lecture', tutorial: 'Tutorial', lab: 'Lab', consultation: 'Consultation' }

function inWords(mins: number) {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`
}

// "Today, 07:02", "Thu 4 Mar"
function uploaded(d: Date, now: Date) {
  return calendarDaysBetween(d, now) === 0 ? `Today, ${time(d)}` : shortDate(d)
}

function dueText(on: string, now: Date) {
  const days = calendarDaysBetween(now, onDay(on))
  if (days < 0) return 'overdue'
  if (days === 0) return 'due today'
  if (days === 1) return 'due tomorrow'
  return null
}

function ClassRow({ c, current, now }: { c: TeachingClass; current: boolean; now: Date }) {
  const start = new Date(c.starts_at)
  const end = new Date(c.ends_at)
  const what = c.assessment_title ? c.assessment_title.split(':')[0] : KIND[c.kind] ?? c.kind
  const mins = Math.max(0, Math.round(((start <= now ? end : start).getTime() - now.getTime()) / 60_000))
  const status = end <= now ? 'finished' : start <= now ? `ends in ${inWords(mins)}` : current ? `starts in ${inWords(mins)}` : null
  const registerOpen = !c.cancelled && calendarDaysBetween(start, now) === 0 && start.getTime() - now.getTime() < 60 * 60_000
  return (
    <tr className={cn(current && 'bg-primary-soft')}>
      <td className={cn(td, 'font-mono', current && 'font-medium text-primary')}>
        {time(start)}–{time(end)}
      </td>
      <td className={td}>
        <div className="font-medium">
          {what} · <span className="font-mono">{c.class_group}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {c.cancelled ? 'Cancelled' : [`${c.students} students`, status].filter(Boolean).join(' · ')}
        </div>
      </td>
      <td className={td}>{c.venue}</td>
      <td className={cn(td, 'text-right')}>
        {c.register_taken ? (
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/staff/teaching/register/${c.slot_id}/${c.on_date}`}>Register taken</Link>
          </Button>
        ) : (
          registerOpen && (
            <Button size="sm" variant={current ? 'default' : 'outline'} asChild>
              <Link to={`/staff/teaching/register/${c.slot_id}/${c.on_date}`}>Take register</Link>
            </Button>
          )
        )}
      </td>
    </tr>
  )
}

function MarkingRow({ m, now }: { m: MarkingItem; now: Date }) {
  const due = m.marks_due_on ? dueText(m.marks_due_on, now) : null
  const started = m.marked + m.absent > 0
  const sat = calendarDaysBetween(new Date(m.due_at), now) === 0
  const meta = started
    ? `${m.marked} of ${m.students} marked`
    : m.kind === 'test' || m.kind === 'exam' || m.kind === 'practical'
      ? `Sat ${sat ? 'today' : shortDate(new Date(m.due_at))}`
      : `Due ${shortDate(new Date(m.due_at))}`
  return (
    <li className="flex items-center gap-4 py-3">
      <div className="grow">
        <div className="font-medium">
          {m.title.split(':')[0]} · <span className="font-mono">{m.class_group}</span>
        </div>
        <div className="text-sm text-muted-foreground">
          {meta}
          {m.marks_due_on && ` · marks due ${shortDate(onDay(m.marks_due_on))}`}
        </div>
      </div>
      {due && <Badge variant="urgent">{due}</Badge>}
      <Button variant="outline" size="sm" asChild>
        <Link to={`/staff/teaching/assessments/${m.assessment_id}/marks`}>{started ? 'Continue' : 'Enter marks'}</Link>
      </Button>
    </li>
  )
}

// design/LecturerHome
export default function Today() {
  const { data, isPending, isError } = useOverview()
  const now = useNow()
  const current = data?.today.findIndex((c) => !c.cancelled && new Date(c.ends_at) > now) ?? -1
  const first = data?.classes[0]
  const week = data?.term?.week ? ` · Week ${data.term.week} of ${data.term.weeks}` : ''
  return (
    <>
      <StaffTopBar
        left={data?.term?.name ?? ''}
        right={
          first && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/staff/teaching/classes/${first.offering_id}?tab=notes&upload=1`}>
                <Upload strokeWidth={1.5} className="size-4" />
                Upload notes
              </Link>
            </Button>
          )
        }
      />
      <main className="flex flex-col gap-8 p-8">
        <div className="flex flex-col gap-1">
          <h1 className={staffH1}>
            {greeting(now)}
            {data && `, ${data.greeting_name}`}
          </h1>
          <p className="text-muted-foreground">
            {formatLongDate(now)}
            {week}
          </p>
        </div>
        {isPending && <Skeleton className="h-48" />}
        {isError && <p className="text-muted-foreground">Couldn't load your day. Check your connection.</p>}
        {data && (
          <>
            <div className="grid grid-cols-2 items-start gap-10">
              <section aria-labelledby="lh-today" className="flex flex-col gap-2">
                <h2 id="lh-today" className="text-lg leading-6 font-semibold">
                  Today's classes
                </h2>
                {data.today.length ? (
                  <Table
                    head={
                      <>
                        <th className={cn(th, 'w-[110px]')}>Time</th>
                        <th className={th}>Class</th>
                        <th className={th}>Venue</th>
                        <th className={th}>
                          <span className="sr-only">Register</span>
                        </th>
                      </>
                    }
                  >
                    {data.today.map((c, i) => (
                      <ClassRow key={c.slot_id} c={c} current={i === current} now={now} />
                    ))}
                  </Table>
                ) : (
                  <p className="border-y py-3 text-muted-foreground">No classes today.</p>
                )}
              </section>
              <section aria-labelledby="lh-mark" className="flex flex-col gap-2">
                <h2 id="lh-mark" className="text-lg leading-6 font-semibold">
                  Marking
                </h2>
                {data.marking.length ? (
                  <ul className="border-y [&>li+li]:border-t">
                    {data.marking.map((m) => (
                      <MarkingRow key={m.assessment_id} m={m} now={now} />
                    ))}
                  </ul>
                ) : (
                  <p className="border-y py-3 text-muted-foreground">Nothing waiting to be marked.</p>
                )}
              </section>
            </div>

            <section aria-labelledby="lh-notes" className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h2 id="lh-notes" className="text-lg leading-6 font-semibold">
                  Notes you've shared
                </h2>
                {first && (
                  <Link to={`/staff/teaching/classes/${first.offering_id}?tab=notes`} className="text-sm font-medium text-primary">
                    All notes
                  </Link>
                )}
              </div>
              {data.notes.length ? (
                <Table
                  head={
                    <>
                      <th className={th}>Title</th>
                      <th className={th}>Class</th>
                      <th className={th}>Week</th>
                      <th className={th}>Size</th>
                      <th className={th}>Uploaded</th>
                      <th className={cn(th, 'text-right')}>Downloaded by</th>
                    </>
                  }
                >
                  {data.notes.map((n) => (
                    <tr key={n.first_material_id}>
                      <td className={cn(td, 'font-medium')}>{n.title}</td>
                      <td className={cn(td, 'font-mono')}>{n.class_groups.join(', ')}</td>
                      <td className={td}>{n.week ?? '–'}</td>
                      <td className={cn(td, 'font-mono')}>{n.size_bytes ? fileSize(n.size_bytes) : '–'}</td>
                      <td className={td}>{uploaded(new Date(n.published_at), now)}</td>
                      <td className={cn(td, 'text-right')}>
                        <span className="font-mono">
                          {n.downloaded}/{n.audience}
                        </span>
                        {n.audience - n.downloaded > 0 && n.audience - n.downloaded <= 5 && (
                          <span className="text-muted-foreground"> · {n.audience - n.downloaded} haven't</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <p className="text-muted-foreground">You haven't shared any notes yet.</p>
              )}
            </section>
          </>
        )}
      </main>
    </>
  )
}

