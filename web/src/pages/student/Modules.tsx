import { CalendarDays, ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty } from '@/components/student/section'
import { calendarDaysBetween, shortDate, time } from '@/lib/format'
import type { ModuleList, ModuleSummary } from '@/api/generated/model'
import { useListModules } from '@/api/generated/modules/modules'
import { useNow } from '@/lib/use-now'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { ClassContext, DeskBar, DeskFallback } from '@/components/shell/student-desktop'

// "today 10:00, Lab 3", "tomorrow 08:00, …", "Mon 15 Mar 08:00, Lecture Room B2"
function nextText(n: NonNullable<ModuleSummary['next_class']>, now: Date) {
  const d = new Date(n.starts_at)
  const days = calendarDaysBetween(now, d)
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : shortDate(d)
  return `${day} ${time(d)}${n.venue ? `, ${n.venue}` : ''}`
}

// Desktop: the same list as a table, in the style of the other Desk* screens.
function ModulesDesk({ data, now }: { data: ModuleList; now: Date }) {
  const first = data.modules.find((m) => m.next_class)
  const th = 'py-2 pr-3 text-left text-sm font-medium text-muted-foreground'
  return (
    <>
      <DeskBar
        left={<ClassContext />}
        right={
          <Link to="/timetable" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
            <CalendarDays className="size-4" strokeWidth={1.5} aria-hidden />
            Full weekly timetable
          </Link>
        }
      />
      <main className="flex max-w-[1040px] flex-col gap-5 p-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.015em]">Modules</h1>
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
        </div>
        {data.modules.length ? (
          <table className="w-full border-collapse text-[15px] leading-[22px]">
            <thead>
              <tr className="border-b">
                <th className={`${th} w-[100px]`}>Code</th>
                <th className={th}>Module</th>
                <th className={`${th} w-[180px]`}>Lecturer</th>
                <th className={`${th} w-[260px]`}>Next class</th>
                <th className={`${th} w-[110px]`}>New notes</th>
                <th className={`${th} w-16`}>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.modules.map((m) => (
                <tr key={m.code} className="border-b">
                  <td className="py-3 pr-3 font-mono">{m.code}</td>
                  <td className="py-3 pr-3 font-medium">
                    <Link to={`/modules/${m.code}`}>{m.name}</Link>
                  </td>
                  <td className="py-3 pr-3 text-muted-foreground">{m.lecturer ?? '–'}</td>
                  <td className={cn('py-3 pr-3', m === first && 'font-medium text-primary')}>
                    {m.next_class ? nextText(m.next_class, now) : <span className="text-muted-foreground">None this week</span>}
                  </td>
                  <td className="py-3 pr-3">{m.new_notes ? m.new_notes : <span className="text-muted-foreground">–</span>}</td>
                  <td className="py-3 text-right">
                    <Link to={`/modules/${m.code}`} className="text-sm text-primary underline underline-offset-3">
                      Open<span className="sr-only"> {m.code}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>You're not enrolled in any modules this semester. Ask Student Affairs if this looks wrong.</Empty>
        )}
      </main>
    </>
  )
}

export default function Modules() {
  const { data, isPending, isError } = useListModules()
  const now = useNow()
  const desktop = useIsDesktop()
  const first = data?.modules.find((m) => m.next_class)
  if (desktop)
    return data ? (
      <ModulesDesk data={data} now={now} />
    ) : (
      <DeskFallback>
        {isError ? <Empty>Couldn't load your modules. Check your connection.</Empty> : <Skeleton className="mt-6 h-48" />}
      </DeskFallback>
    )
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
