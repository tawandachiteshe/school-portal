import { Check, Clock, Upload } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Empty } from '@/components/student/section'
import { acceptedText, useDeadlines, type DeadlineItem } from '@/lib/deadlines'
import { isUrgent, relativeDue, shortDateTime } from '@/lib/format'
import { KIND_LABEL } from '@/lib/student'
import { useUpload } from '@/lib/uploads'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

const SHOW = ['upcoming', 'submitted', 'marked'] as const
type Show = (typeof SHOW)[number]

function Head({ item }: { item: DeadlineItem }) {
  return (
    <div className="flex items-center gap-2">
      <Badge>{KIND_LABEL[item.kind]}</Badge>
      <span className="font-mono text-sm text-muted-foreground">{item.module_code}</span>
    </div>
  )
}

function SubmitButton({ item }: { item: DeadlineItem }) {
  const upload = useUpload(item.id)
  const label = upload && upload.phase !== 'done' ? 'See upload' : 'Submit work'
  return (
    <div className="mt-2">
      <Button variant="outline" asChild>
        <Link to={`/deadlines/${item.id}/submit`}>
          <Upload strokeWidth={1.5} />
          {label}
        </Link>
      </Button>
    </div>
  )
}

function UpcomingRow({ item, now }: { item: DeadlineItem; now: Date }) {
  const due = new Date(item.due_at)
  const done = item.status !== null
  const late = due <= now
  const accept = acceptedText(item.accepted_extensions)
  const where =
    item.submission_mode === 'online'
      ? done
        ? null
        : accept
          ? `upload ${accept}`
          : 'submit online'
      : item.submission_mode === 'physical'
        ? 'hand in'
        : item.venue
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="flex min-w-0 grow flex-col gap-1">
        <Head item={item} />
        <div className={cn('font-medium', done && 'text-muted-foreground')}>{item.title}</div>
        <div className="text-sm text-muted-foreground">{[shortDateTime(due), where].filter(Boolean).join(' · ')}</div>
        {late && !done && item.allow_late_until && (
          <div className="text-sm font-medium text-destructive">
            Deadline passed. Late submissions until {shortDateTime(new Date(item.allow_late_until))}
          </div>
        )}
        {item.submission_mode === 'online' && !done && <SubmitButton item={item} />}
      </div>
      {done ? (
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <Check className="size-4 text-success" strokeWidth={1.5} aria-hidden />
          Submitted
        </span>
      ) : isUrgent(due, now, false) ? (
        <Badge variant="urgent">
          <Clock strokeWidth={1.5} aria-hidden />
          {relativeDue(due, now)}
        </Badge>
      ) : (
        !late && <span className="text-sm whitespace-nowrap text-muted-foreground">{relativeDue(due, now)}</span>
      )}
    </li>
  )
}

function SubmittedRow({ item }: { item: DeadlineItem }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="flex min-w-0 grow flex-col gap-1">
        <Head item={item} />
        <Link to={`/deadlines/${item.id}/submit`} className="font-medium">
          {item.title}
        </Link>
        <div className="text-sm text-muted-foreground">
          {item.submitted_at ? `Submitted ${shortDateTime(new Date(item.submitted_at))}` : 'Handed in'}
        </div>
      </div>
      {item.status === 'late' ? (
        <Badge variant="destructive">Late</Badge>
      ) : (
        <span className="text-sm text-muted-foreground">Awaiting marks</span>
      )}
    </li>
  )
}

function MarkedRow({ item }: { item: DeadlineItem }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="flex min-w-0 grow flex-col gap-1">
        <Head item={item} />
        <div className="font-medium">{item.title}</div>
        <div className="text-sm text-muted-foreground">{shortDateTime(new Date(item.due_at))}</div>
        {item.feedback && <p className="mt-1 text-sm">{item.feedback}</p>}
      </div>
      <span className="font-mono font-semibold whitespace-nowrap">
        {item.mark}/{item.max_mark}
      </span>
    </li>
  )
}

function Group({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="border-b pb-2 text-xs leading-4 font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {title}
      </h2>
      <ul className="[&>li+li]:border-t">{children}</ul>
    </section>
  )
}

function Upcoming({ items, week, now }: { items: DeadlineItem[]; week: number | null; now: Date }) {
  const open = items.filter(
    (i) => new Date(i.due_at) > now || (i.status === null && i.allow_late_until && new Date(i.allow_late_until) > now),
  )
  if (!open.length) return <Empty>Nothing coming up. New tests and assignments appear here once lecturers add them.</Empty>
  const thisWeek = open.filter((i) => week === null || (i.week ?? 0) <= week)
  const nextWeek = week === null ? [] : open.filter((i) => i.week === week + 1)
  const later = week === null ? [] : open.filter((i) => (i.week ?? 0) > week + 1 || i.week === null)
  return (
    <div className="flex flex-col gap-6">
      {thisWeek.length > 0 && (
        <Group id="h-this" title={week ? `This week · Week ${week}` : 'Coming up'}>
          {thisWeek.map((i) => (
            <UpcomingRow key={i.id} item={i} now={now} />
          ))}
        </Group>
      )}
      {nextWeek.length > 0 && (
        <Group id="h-next" title={`Next week · Week ${week! + 1}`}>
          {nextWeek.map((i) => (
            <UpcomingRow key={i.id} item={i} now={now} />
          ))}
        </Group>
      )}
      {later.length > 0 && (
        <Group id="h-later" title="Later this semester">
          {later.map((i) => (
            <UpcomingRow key={i.id} item={i} now={now} />
          ))}
        </Group>
      )}
    </div>
  )
}

export default function Deadlines() {
  const [params, setParams] = useSearchParams()
  const show: Show = SHOW.includes(params.get('show') as Show) ? (params.get('show') as Show) : 'upcoming'
  const { data, isPending, isError } = useDeadlines()
  const now = useNow()
  const submitted = data?.items
    .filter((i) => (i.status === 'submitted' || i.status === 'late') && i.mark === null)
    .sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))
  const marked = data?.items.filter((i) => i.mark !== null).sort((a, b) => b.due_at.localeCompare(a.due_at))

  return (
    <main className="flex grow flex-col gap-6 px-4 py-6">
      <Tabs
        value={show}
        onValueChange={(v) => setParams(v === 'upcoming' ? {} : { show: v }, { replace: true })}
        className="gap-6"
      >
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">Deadlines</h1>
          <TabsList variant="segmented" aria-label="Filter deadlines">
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="submitted">Submitted</TabsTrigger>
            <TabsTrigger value="marked">Marked</TabsTrigger>
          </TabsList>
        </div>
        {isPending && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        )}
        {isError && <Empty>Couldn't load your deadlines. Check your connection.</Empty>}
        {data && (
          <>
            <TabsContent value="upcoming">
              <Upcoming items={data.items} week={data.week} now={now} />
            </TabsContent>
            <TabsContent value="submitted">
              {submitted?.length ? (
                <ul className="[&>li+li]:border-t">
                  {submitted.map((i) => (
                    <SubmittedRow key={i.id} item={i} />
                  ))}
                </ul>
              ) : (
                <Empty>Nothing waiting for marks.</Empty>
              )}
            </TabsContent>
            <TabsContent value="marked">
              {marked?.length ? (
                <ul className="[&>li+li]:border-t">
                  {marked.map((i) => (
                    <MarkedRow key={i.id} item={i} />
                  ))}
                </ul>
              ) : (
                <Empty>No marks released yet.</Empty>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>
    </main>
  )
}
