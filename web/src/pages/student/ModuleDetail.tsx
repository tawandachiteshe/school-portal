import { useParams, useSearchParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SubPage } from '@/components/shell/sub-page'
import { NoteRow } from '@/components/student/rows'
import { Empty } from '@/components/student/section'
import { useNoteDownload } from '@/components/student/use-note-download'
import { ApiError } from '@/lib/api'
import { calendarDaysBetween, isUrgent, relativeDue, shortDate, shortDateTime, time } from '@/lib/format'
import { useModule, type ModuleAssessment, type ModuleDetail as Detail, type ModuleNote, type WeekClass } from '@/lib/modules'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

const KIND: Record<string, string> = { lecture: 'Lecture', tutorial: 'Tutorial', lab: 'Lab', consultation: 'Consultation' }
const TABS = ['overview', 'notes', 'assessments'] as const
type Tab = (typeof TABS)[number]

function H2({ id, children, aside }: { id: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-3">
      <h2 id={id} className="text-lg leading-6 font-semibold">
        {children}
      </h2>
      {aside}
    </div>
  )
}

function WeekClasses({ classes, week, now }: { classes: WeekClass[]; week: number | null; now: Date }) {
  const current = classes.findIndex((c) => !c.cancelled && new Date(c.ends_at) > now)
  return (
    <section aria-labelledby="h-week" className="flex flex-col">
      <H2 id="h-week">{week ? `Week ${week} classes` : 'This week'}</H2>
      {classes.length ? (
        <ul className="[&>li+li]:border-t">
          {classes.map((c, i) => {
            const start = new Date(c.starts_at)
            const end = new Date(c.ends_at)
            const finished = end <= now
            const isToday = calendarDaysBetween(now, start) === 0
            const highlight = i === current
            const title = c.assessment_title ?? KIND[c.kind] ?? c.kind
            const note = c.cancelled
              ? `Cancelled${c.change_reason ? ` · ${c.change_reason}` : ''}`
              : finished
                ? 'finished'
                : c.assessment_title
                  ? 'bring your student card'
                  : null
            return (
              <li
                key={c.starts_at}
                className={cn(
                  'grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-3',
                  finished && 'text-muted-foreground',
                  highlight && '-mx-2 rounded-md bg-primary-soft px-2',
                )}
              >
                <span className="text-sm">
                  <span className={cn('block', isToday && highlight && 'font-medium text-primary')}>
                    {isToday ? 'Today' : shortDate(start)}
                  </span>
                  <span className="font-mono">
                    {time(start)}–{time(end)}
                  </span>
                </span>
                <span>
                  <span className={cn('block', !finished && 'font-medium', c.cancelled && 'line-through')}>{title}</span>
                  <span className={cn('text-sm', !finished && 'text-muted-foreground', c.cancelled && 'text-destructive')}>
                    {[c.venue, note].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <Empty>No classes for this module this week.</Empty>
      )}
    </section>
  )
}

function AssessmentRow({ a, now }: { a: ModuleAssessment; now: Date }) {
  const due = new Date(a.due_at)
  const handedIn = a.status !== null
  const past = due <= now
  const meta = handedIn && a.submitted_at ? `Submitted ${shortDate(new Date(a.submitted_at))}` : shortDateTime(due)
  let right: React.ReactNode
  if (a.mark !== null)
    right = (
      <span className="font-mono font-semibold">
        {a.mark}/{a.max_mark}
      </span>
    )
  else if (past && !handedIn && a.submission_mode === 'online')
    right = <span className="text-sm font-medium text-destructive">Not submitted</span>
  else if (past) right = <span className="text-sm text-muted-foreground">Marks not out yet</span>
  else if (isUrgent(due, now, handedIn)) right = <Badge variant="urgent">{relativeDue(due, now)}</Badge>
  else right = <span className="text-sm whitespace-nowrap text-muted-foreground">{handedIn ? 'Submitted' : relativeDue(due, now)}</span>
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="min-w-0 grow">
        <div className="font-medium">{a.title}</div>
        <div className="text-sm text-muted-foreground">
          {a.weight}% · {meta}
        </div>
      </div>
      {right}
    </li>
  )
}

function Assessments({ m, now }: { m: Detail; now: Date }) {
  return (
    <section aria-labelledby="h-ass" className="flex flex-col">
      <H2
        id="h-ass"
        aside={
          <span className="text-sm text-muted-foreground">
            Coursework {m.coursework_weight}% · Exam {m.exam_weight}%
          </span>
        }
      >
        Assessments
      </H2>
      <ul className="[&>li+li]:border-t">
        {m.assessments.map((a) => (
          <AssessmentRow key={a.id} a={a} now={now} />
        ))}
        {!m.exam_scheduled && m.exam_weight > 0 && (
          <li className="py-3">
            <div className="font-medium">Final examination</div>
            <div className="text-sm text-muted-foreground">{m.exam_weight}% · date not yet set</div>
          </li>
        )}
      </ul>
    </section>
  )
}

function Notes({
  notes,
  now,
  onDownload,
}: {
  notes: ModuleNote[]
  now: Date
  onDownload: (n: ModuleNote) => void
}) {
  if (!notes.length) return <Empty>No notes yet. You'll see them here as soon as your lecturer uploads one.</Empty>
  const weeks = [...new Set(notes.map((n) => n.week ?? 0))].sort((a, b) => b - a)
  return (
    <div className="flex flex-col gap-6">
      {weeks.map((w) => (
        <section key={w} aria-labelledby={`h-w${w}`}>
          <h2 id={`h-w${w}`} className="font-semibold">
            {w ? `Week ${w}` : 'Other'}
          </h2>
          <ul className="mt-1 [&>li+li]:border-t">
            {notes
              .filter((n) => (n.week ?? 0) === w)
              .map((n) => (
                <NoteRow
                  key={n.id}
                  item={{ ...n, module_code: '', week: null }}
                  showModule={false}
                  now={now}
                  onDownload={() => onDownload(n)}
                />
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default function ModuleDetail() {
  const { code = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'overview'
  const setTab = (t: string) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })
  const { data: m, isPending, error } = useModule(code.toUpperCase())
  const now = useNow()
  const download = useNoteDownload()
  const get = (n: ModuleNote) => download.request({ ...n }, { ask: !n.downloaded })

  return (
    <SubPage title={code.toUpperCase()} mono back="/modules" backLabel="Back to modules" bottomNav>
      <main className="flex grow flex-col gap-6 px-4 pt-5 pb-8">
        {isPending && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-4 h-40" />
          </div>
        )}
        {error && <Empty>{error instanceof ApiError ? error.message : "Couldn't load this module."}</Empty>}
        {m && (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">{m.name}</h1>
              <p className="text-muted-foreground">{[m.lecturer?.name, m.term_name].filter(Boolean).join(' · ')}</p>
            </div>
            <Tabs value={tab} onValueChange={setTab} className="gap-6">
              <TabsList aria-label="Module sections">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="notes">
                  Notes <Badge className="h-5">{m.notes.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="assessments">Assessments</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="flex flex-col gap-6">
                <WeekClasses classes={m.week_classes} week={m.week} now={now} />
                <Assessments m={m} now={now} />
                <section aria-labelledby="h-notes" className="flex flex-col">
                  <H2
                    id="h-notes"
                    aside={
                      m.notes.length > 3 && (
                        <button
                          type="button"
                          onClick={() => setTab('notes')}
                          className="inline-flex min-h-11 items-center text-sm font-medium text-primary"
                        >
                          All {m.notes.length}
                        </button>
                      )
                    }
                  >
                    Latest notes
                  </H2>
                  {m.notes.length ? (
                    <ul className="[&>li+li]:border-t">
                      {m.notes.slice(0, 3).map((n) => (
                        <NoteRow
                          key={n.id}
                          item={{ ...n, module_code: '' }}
                          showModule={false}
                          now={now}
                          onDownload={() => get(n)}
                        />
                      ))}
                    </ul>
                  ) : (
                    <Empty>No notes yet.</Empty>
                  )}
                </section>
                {m.lecturer && (
                  <section aria-labelledby="h-lec" className="flex flex-col gap-1">
                    <h2 id="h-lec" className="text-lg leading-6 font-semibold">
                      Lecturer
                    </h2>
                    <p>{m.lecturer.name}</p>
                    {(m.lecturer.consultation_hours || m.lecturer.office) && (
                      <p className="text-sm text-muted-foreground">
                        Consultation: {[m.lecturer.consultation_hours, m.lecturer.office].filter(Boolean).join(', ')}
                      </p>
                    )}
                    {m.lecturer.email && (
                      <a href={`mailto:${m.lecturer.email}`} className="text-sm text-primary underline underline-offset-3">
                        {m.lecturer.email}
                      </a>
                    )}
                  </section>
                )}
              </TabsContent>

              <TabsContent value="notes">
                <Notes notes={m.notes} now={now} onDownload={get} />
              </TabsContent>

              <TabsContent value="assessments">
                <Assessments m={m} now={now} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
      {download.sheet}
    </SubPage>
  )
}
