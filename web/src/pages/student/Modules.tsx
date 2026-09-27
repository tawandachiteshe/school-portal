import { CalendarDays, ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty } from '@/components/student/section'
import { calendarDaysBetween, shortDate, time } from '@/lib/format'
import { useModules, type ModuleSummary } from '@/lib/modules'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

// "today 10:00, Lab 3", "tomorrow 08:00, …", "Mon 15 Mar 08:00, Lecture Room B2"
function nextText(n: NonNullable<ModuleSummary['next_class']>, now: Date) {
  const d = new Date(n.starts_at)
  const days = calendarDaysBetween(now, d)
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : shortDate(d)
  return `${day} ${time(d)}${n.venue ? `, ${n.venue}` : ''}`
}

export default function Modules() {
  const { data, isPending, isError } = useModules()
  const now = useNow()
  const first = data?.modules.find((m) => m.next_class)
  return (
    <main className="flex grow flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">Modules</h1>
        {data && (
          <p className="text-muted-foreground">
            {data.term_name}
            {data.class_group && (
              <>
                {' · '}
                <span className="font-mono">{data.class_group}</span>
              </>
            )}
            {` · ${data.modules.length} ${data.modules.length === 1 ? 'module' : 'modules'}`}
          </p>
        )}
      </div>
      {isPending && (
        <div className="flex flex-col gap-4 border-y py-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {isError && <Empty>Couldn't load your modules. Check your connection.</Empty>}
      {data &&
        (data.modules.length ? (
          <ul className="border-y [&>li+li]:border-t">
            {data.modules.map((m) => (
              <li key={m.code}>
                <Link to={`/modules/${m.code}`} className="flex items-center gap-3 py-4">
                  <div className="flex min-w-0 grow flex-col gap-0.5">
                    <span className="font-mono text-sm text-muted-foreground">{m.code}</span>
                    <span className="font-semibold">{m.name}</span>
                    {m.lecturer && <span className="text-sm text-muted-foreground">{m.lecturer}</span>}
                    {(m.next_class || m.new_notes > 0) && (
                      <span className="mt-1 text-sm">
                        {m.next_class && (
                          <>
                            Next:{' '}
                            <span className={cn(m === first && 'font-medium text-primary')}>
                              {nextText(m.next_class, now)}
                            </span>
                          </>
                        )}
                        {m.next_class && m.new_notes > 0 && ' · '}
                        {m.new_notes > 0 && `${m.new_notes} new ${m.new_notes === 1 ? 'note' : 'notes'}`}
                      </span>
                    )}
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>You're not enrolled in any modules this semester. Ask Student Affairs if this looks wrong.</Empty>
        ))}
      <Link to="/timetable" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary">
        <CalendarDays className="size-4" strokeWidth={1.5} aria-hidden />
        Full weekly timetable
      </Link>
    </main>
  )
}
