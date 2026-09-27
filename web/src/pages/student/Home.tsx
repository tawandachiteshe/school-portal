import { useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, MessageSquare, ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AnnouncementRow, DueRow, LoanRow, NoteRow } from '@/components/student/rows'
import { Empty, Section } from '@/components/student/section'
import { TodayTimeline } from '@/components/student/today-timeline'
import { useNoteDownload } from '@/components/student/use-note-download'
import { useRenewLoan } from '@/api/generated/library/library'
import type { Dashboard } from '@/api/generated/model'
import { useDashboard } from '@/api/generated/student/student'
import { errorMessage } from '@/lib/api'
import { useMe } from '@/lib/auth'
import { calendarDaysBetween, formatLongDate, greeting, shortDate, time, weekday } from '@/lib/format'
import { invalidateStudentData } from '@/lib/student'
import { useIsDesktop } from '@/lib/use-desktop'
import { useNow } from '@/lib/use-now'
import HomeDesk from './HomeDesk'
import { lastSaved, useOnline } from '@/lib/offline'
import { DeskFallback } from '@/components/shell/student-desktop'

const list = '[&>li+li]:border-t'

function nextClassDay(d: Date, now: Date) {
  const days = calendarDaysBetween(now, d)
  if (days === 1) return 'tomorrow'
  if (days < 7) return `on ${weekday(d)}`
  return `on ${shortDate(d)}`
}

function Greeting() {
  const { data: me } = useMe()
  const now = useNow()
  const week = me?.term?.week ? ` · Week ${me.term.week} of ${me.term.weeks}` : ''
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">
        {greeting(now)}, {me?.given_name}
      </h1>
      <p className="text-muted-foreground">
        {formatLongDate(now)}
        {week}
      </p>
    </div>
  )
}

// design/StateLoading: known text stays real; only unknown rows are skeletons.
function Loading() {
  return (
    <main aria-busy="true" className="flex flex-col gap-8 px-4 pt-6 pb-8">
      <Greeting />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg leading-6 font-semibold">Today</h2>
        {[70, 60, 75].map((w) => (
          <div key={w} className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 py-2">
            <Skeleton className="h-3.5" />
            <span className="flex flex-col gap-2">
              <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
              <Skeleton className="h-3" style={{ width: `${w - 25}%` }} />
            </span>
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg leading-6 font-semibold">Due in the next 7 days</h2>
        {[80, 70].map((w) => (
          <div key={w} className="flex flex-col gap-2 py-2">
            <Skeleton className="h-5 w-[120px]" />
            <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
            <Skeleton className="h-3" style={{ width: `${w - 30}%` }} />
          </div>
        ))}
      </section>
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden />
        Loading your day. Slow connection, this may take a few seconds.
      </p>
    </main>
  )
}

export default function Home() {
  const { data, isPending, isError, refetch } = useDashboard()
  const now = useNow()
  const qc = useQueryClient()
  const download = useNoteDownload()
  const desktop = useIsDesktop()
  const renew = useRenewLoan({
    mutation: {
      onSuccess: (r) => {
        toast(`Renewed. Due back ${shortDate(new Date(r.due_at))}.`)
        void invalidateStudentData(qc)
      },
      onError: (e) => toast(errorMessage(e, 'Could not renew. Try again.')),
    },
  })

  if (isPending)
    return desktop ? (
      <DeskFallback>
        <Loading />
      </DeskFallback>
    ) : (
      <Loading />
    )
  if (isError || !data)
    return (
      <main className="flex flex-col gap-8 px-4 pt-6 pb-8">
        <Greeting />
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col items-start gap-3 text-foreground">
            Couldn't load your dashboard. Check your connection.
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    )

  if (desktop)
    return (
      <>
        <HomeDesk
          data={data}
          now={now}
          onRenew={(loanId) => renew.mutate({ loanId })}
          renewing={renew.isPending}
          onDownload={(n) => download.request(n)}
        />
        {download.sheet}
      </>
    )
  return (
    <>
      <DashboardView
        data={data}
        now={now}
        onRenew={(loanId) => renew.mutate({ loanId })}
        renewing={renew.isPending}
        onDownload={(n) => download.request(n)}
      />
      {download.sheet}
    </>
  )
}

function DashboardView({
  data,
  now,
  onRenew,
  renewing,
  onDownload,
}: {
  data: Dashboard
  now: Date
  onRenew: (id: string) => void
  renewing: boolean
  onDownload: (n: Dashboard['notes'][number]) => void
}) {
  const next = data.next_class
  const ann = data.announcements
  return (
    <main className="flex flex-col gap-8 px-4 pt-6 pb-8">
      <Greeting />

      <Section id="h-today" title="Today" link={{ to: '/timetable', label: 'Timetable' }}>
        {data.today.length ? (
          <TodayTimeline classes={data.today} now={now} />
        ) : (
          <Empty>
            No classes today.
            {next && (
              <>
                {' '}
                Your next class is{' '}
                <span className="font-medium text-foreground">
                  <span className="font-mono">{next.module_code}</span>{' '}
                  {nextClassDay(new Date(next.starts_at), now)} at {time(new Date(next.starts_at))}
                </span>
                {next.venue && ` in ${next.venue}`}.
              </>
            )}
          </Empty>
        )}
        <OfflineRoomNote />
      </Section>

      <Section id="h-due" title="Due in the next 7 days" link={{ to: '/deadlines', label: 'All deadlines' }}>
        {data.due.length ? (
          <ul className={list}>
            {data.due.map((d) => (
              <DueRow key={d.id} item={d} now={now} />
            ))}
          </ul>
        ) : (
          <Empty>Nothing due. Tests and assignments appear here once lecturers add them.</Empty>
        )}
      </Section>

      <Section
        id="h-ann"
        title="Announcements"
        link={ann.total > ann.items.length ? { to: '/announcements', label: `All ${ann.total}` } : undefined}
      >
        {ann.items.length ? (
          <ul className={list}>
            {ann.items.map((a) => (
              <AnnouncementRow key={a.id} item={a} now={now} />
            ))}
          </ul>
        ) : (
          <Empty>No announcements.</Empty>
        )}
      </Section>

      <Section id="h-notes" title="New notes" link={{ to: '/modules', label: 'All notes' }}>
        {data.notes.length ? (
          <ul className={list}>
            {data.notes.map((n) => (
              <NoteRow key={n.id} item={n} onDownload={() => onDownload(n)} />
            ))}
          </ul>
        ) : (
          <Empty>No notes yet. You'll see them here as soon as a lecturer uploads one.</Empty>
        )}
      </Section>

      <Section id="h-lib" title="Library loans" link={{ to: '/library', label: 'Search catalogue' }}>
        {data.loans.length ? (
          <ul className={list}>
            {data.loans.map((l) => (
              <LoanRow key={l.id} item={l} onRenew={onRenew} renewing={renewing} />
            ))}
          </ul>
        ) : (
          <Empty>No books on loan. Show your student card at the desk in Block A to borrow.</Empty>
        )}
      </Section>

      <section aria-labelledby="h-res" className="flex flex-col gap-1">
        <h2 id="h-res" className="text-lg leading-6 font-semibold">
          Results
        </h2>
        {data.results.published ? (
          <Link to="/results" className="font-medium text-primary underline underline-offset-3">
            {data.results.term_name} results are published
          </Link>
        ) : (
          <p className="text-muted-foreground">
            {data.results.term_name ? `${data.results.term_name.replace(/ \d{4}$/, '')} results` : 'Results'} not
            yet published
          </p>
        )}
      </section>

      <section aria-label="Ask TCFL">
        <Link to="/ask" className="flex min-h-16 items-center gap-3 rounded-md border bg-card py-3 pr-3 pl-4">
          <MessageSquare className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <div className="min-w-0 grow">
            <div className="font-medium">Ask TCFL</div>
            <div className="text-sm text-muted-foreground">
              Fees, timetables, exam rules and college procedures. Answers link to the official source.
            </div>
          </div>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        </Link>
      </section>
    </main>
  )
}

// design/StateOffline: the timetable shown is the saved one.
function OfflineRoomNote() {
  const online = useOnline()
  const qc = useQueryClient()
  const saved = lastSaved(qc)
  if (online || !saved) return null
  return <p className="text-xs text-muted-foreground">Room changes made after {time(saved)} won't show until you're back online.</p>
}
