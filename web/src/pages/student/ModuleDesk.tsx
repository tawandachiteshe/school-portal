import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DeskBar } from '@/components/shell/student-desktop'
import type { ModuleDetail, Note } from '@/api/generated/model'
import { calendarDaysBetween, fileKind, fileSize, isUrgent, relativeDue, shortDate, shortDateTime, time } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Assessments, WeekClasses } from './ModuleDetail'

const DAYS = ['', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']

// "Mondays 08:00 Lecture Room B2, Thursdays 10:00 Lab 3"
function slotsText(m: ModuleDetail) {
  return m.weekly_slots.map((s) => `${DAYS[s.day_of_week]} ${s.starts_at}${s.venue ? ` ${s.venue}` : ''}`).join(', ')
}

function uploaded(d: Date, now: Date) {
  const days = calendarDaysBetween(d, now)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return shortDate(d)
}

function NotesTable({ m, now, onDownload }: { m: ModuleDetail; now: Date; onDownload: (n: Note) => void }) {
  if (!m.notes.length) return <p className="text-muted-foreground">No notes yet. You'll see them here as soon as your lecturer uploads one.</p>
  return (
    <table className="w-full border-collapse text-[15px] leading-[22px]">
      <thead>
        <tr className="border-b text-left text-sm text-muted-foreground">
          <th className="w-[70px] py-2 pr-3 font-medium">Week</th>
          <th className="py-2 pr-3 font-medium">Title</th>
          <th className="w-[70px] py-2 pr-3 font-medium">Type</th>
          <th className="w-20 py-2 pr-3 font-medium">Size</th>
          <th className="w-[110px] py-2 pr-3 font-medium">Uploaded</th>
          <th className="w-[110px] py-2">
            <span className="sr-only">Download</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {m.notes.map((n) => (
          <tr key={n.id} className="border-b align-top">
            <td className="py-2.5 pr-3 font-mono">{n.week ?? '–'}</td>
            <td className="py-2.5 pr-3 font-medium">{n.title}</td>
            <td className="py-2.5 pr-3 font-mono text-sm">{fileKind(n.mime_type)}</td>
            <td className="py-2.5 pr-3 font-mono text-sm">{n.size_bytes ? fileSize(n.size_bytes) : '–'}</td>
            <td className="py-2.5 pr-3 text-sm">{uploaded(new Date(n.published_at), now)}</td>
            <td className="py-2.5 text-right">
              <button
                type="button"
                onClick={() => onDownload(n)}
                className={cn('text-sm', n.downloaded ? 'text-success' : 'text-primary underline underline-offset-3')}
                aria-label={`${n.downloaded ? 'Download again' : 'Download'} ${n.title}`}
              >
                {n.downloaded ? 'Downloaded' : 'Download'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AssessmentsTable({ m, now }: { m: ModuleDetail; now: Date }) {
  return (
    <table className="w-full border-collapse text-[15px] leading-[22px]">
      <thead>
        <tr className="border-b text-left text-sm text-muted-foreground">
          <th className="py-2 pr-3 font-medium">Assessment</th>
          <th className="w-20 py-2 pr-3 text-right font-medium">Weight</th>
          <th className="w-[180px] py-2 pr-3 font-medium">Due</th>
          <th className="w-[140px] py-2 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {m.assessments.map((a) => {
          const due = new Date(a.due_at)
          const handedIn = a.status !== null
          return (
            <tr key={a.id} className="border-b">
              <td className="py-2.5 pr-3 font-medium">{a.title}</td>
              <td className="py-2.5 pr-3 text-right font-mono">{a.weight}%</td>
              <td className="py-2.5 pr-3">{shortDateTime(due)}</td>
              <td className="py-2.5 text-sm">
                {a.mark !== null ? (
                  <span className="font-mono text-base font-semibold">
                    {a.mark}/{a.max_mark}
                  </span>
                ) : due <= now ? (
                  <span className="text-muted-foreground">{handedIn ? 'Awaiting marks' : 'Marks not out yet'}</span>
                ) : handedIn ? (
                  <span className="text-muted-foreground">Submitted</span>
                ) : isUrgent(due, now, false) ? (
                  <Badge variant="urgent">{relativeDue(due, now)}</Badge>
                ) : (
                  <span className="text-muted-foreground">{relativeDue(due, now)}</span>
                )}
              </td>
            </tr>
          )
        })}
        {!m.exam_scheduled && m.exam_weight > 0 && (
          <tr className="border-b">
            <td className="py-2.5 pr-3 font-medium">Final examination</td>
            <td className="py-2.5 pr-3 text-right font-mono">{m.exam_weight}%</td>
            <td className="py-2.5 pr-3 text-muted-foreground">Date not yet set</td>
            <td />
          </tr>
        )}
      </tbody>
    </table>
  )
}

function Aside({ m, now }: { m: ModuleDetail; now: Date }) {
  const upcoming = m.assessments.filter((a) => new Date(a.due_at) > now && a.status === null)
  const [next, after] = upcoming
  const coursework = m.assessments.filter((a) => a.kind !== 'exam')
  const marked = coursework.filter((a) => a.mark !== null)
  return (
    <aside className="flex flex-col gap-7">
      <section aria-labelledby="md-next" className="flex flex-col gap-2">
        <h2 id="md-next" className="font-semibold">
          Coming up
        </h2>
        {next ? (
          <div className="rounded-md bg-primary-soft p-3">
            <div className="text-sm font-medium text-primary">
              {calendarDaysBetween(now, new Date(next.due_at)) === 0 ? 'Today' : shortDate(new Date(next.due_at))},{' '}
              {time(new Date(next.due_at))} · {relativeDue(new Date(next.due_at), now)}
            </div>
            <div className="font-medium">{next.title}</div>
            <div className="text-sm text-muted-foreground">
              {[next.venue, `${next.weight}% of the module`].filter(Boolean).join(' · ')}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing else due for this module.</p>
        )}
        {after && (
          <p className="text-sm">
            <span className="font-medium">{after.title}</span>
            <br />
            <span className="text-muted-foreground">Due {shortDateTime(new Date(after.due_at))}</span>
          </p>
        )}
      </section>
      <section aria-labelledby="md-marks" className="flex flex-col gap-2">
        <h2 id="md-marks" className="font-semibold">
          Your marks so far
        </h2>
        {marked.map((a) => (
          <div key={a.id} className="flex justify-between gap-3 text-sm">
            <span>{a.title}</span>
            <span className="font-mono font-semibold">
              {a.mark}/{a.max_mark}
            </span>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          {marked.length} of {coursework.length} coursework {coursework.length === 1 ? 'item' : 'items'} marked
        </p>
      </section>
      {m.lecturer && (
        <section aria-labelledby="md-lec" className="flex flex-col gap-1">
          <h2 id="md-lec" className="font-semibold">
            Lecturer
          </h2>
          <p className="text-sm">{m.lecturer.name}</p>
          {(m.lecturer.consultation_hours || m.lecturer.office) && (
            <p className="text-sm text-muted-foreground">
              Consultation: {[m.lecturer.consultation_hours, m.lecturer.office].filter(Boolean).join(', ')}
            </p>
          )}
          {m.lecturer.email && <p className="font-mono text-sm text-muted-foreground select-all">{m.lecturer.email}</p>}
        </section>
      )}
    </aside>
  )
}

// design/DeskModule
export default function ModuleDesk({
  m,
  tab,
  setTab,
  now,
  onDownload,
}: {
  m: ModuleDetail
  tab: string
  setTab: (t: string) => void
  now: Date
  onDownload: (n: Note) => void
}) {
  return (
    <>
      <DeskBar
        left={
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
            <Link to="/modules" className="text-primary underline underline-offset-3">
              Modules
            </Link>
            <span aria-hidden>/</span>
            <span className="font-mono text-foreground">{m.code}</span>
          </nav>
        }
      />
      <main className="flex flex-col gap-5 px-8 py-6">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-sm text-muted-foreground">{m.code}</p>
          <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.015em]">{m.name}</h1>
          <p className="text-muted-foreground">{[m.lecturer?.name, slotsText(m)].filter(Boolean).join(' · ')}</p>
        </div>
        <Tabs value={tab} onValueChange={setTab} className="gap-5">
          <TabsList aria-label="Module sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="notes">
              Notes <Badge className="h-5">{m.notes.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="assessments">Assessments</TabsTrigger>
          </TabsList>
          <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-12">
            <div>
              <TabsContent value="overview" className="flex flex-col gap-6">
                <WeekClasses classes={m.week_classes} week={m.week} now={now} />
                <Assessments m={m} now={now} />
              </TabsContent>
              <TabsContent value="notes">
                <NotesTable m={m} now={now} onDownload={onDownload} />
              </TabsContent>
              <TabsContent value="assessments">
                <AssessmentsTable m={m} now={now} />
              </TabsContent>
            </div>
            <Aside m={m} now={now} />
          </div>
        </Tabs>
      </main>
    </>
  )
}
