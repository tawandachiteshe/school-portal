import { Check, Clock, Upload } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Empty } from '@/components/student/section'
import { useDeadlines } from '@/api/generated/deadlines/deadlines'
import type { DeadlineItem } from '@/api/generated/model'
import { acceptedText } from '@/lib/deadlines'
import { isUrgent, relativeDue, shortDate, shortDateTime } from '@/lib/format'
import { KIND_LABEL } from '@/lib/student'
import { useUpload } from '@/lib/uploads'
import { useIsDesktop } from '@/lib/use-desktop'
import { useNow } from '@/lib/use-now'
import { ClassContext, DeskBar } from '@/components/shell/student-desktop'
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

type Group = { id: string; title: string; items: DeadlineItem[] }

// "This week · Week 6", "Next week · Week 7", "Later this semester" (design/Deadlines)
function upcomingGroups(items: DeadlineItem[], week: number | null, now: Date): Group[] {
  const open = items.filter(
    (i) => new Date(i.due_at) > now || (i.status === null && i.allow_late_until && new Date(i.allow_late_until) > now),
  )
  if (week === null) return open.length ? [{ id: 'h-this', title: 'Coming up', items: open }] : []
  return [
    { id: 'h-this', title: `This week · Week ${week}`, items: open.filter((i) => (i.week ?? 0) <= week) },
    { id: 'h-next', title: `Next week · Week ${week + 1}`, items: open.filter((i) => i.week === week + 1) },
    { id: 'h-later', title: 'Later this semester', items: open.filter((i) => (i.week ?? 0) > week + 1 || i.week === null) },
  ].filter((g) => g.items.length)
}

function Upcoming({ items, week, now }: { items: DeadlineItem[]; week: number | null; now: Date }) {
  const groups = upcomingGroups(items, week, now)
  if (!groups.length) return <Empty>Nothing coming up. New tests and assignments appear here once lecturers add them.</Empty>
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <Group key={g.id} id={g.id} title={g.title}>
          {g.items.map((i) => (
            <UpcomingRow key={i.id} item={i} now={now} />
          ))}
        </Group>
      ))}
    </div>
  )
}

const th = 'py-2 pr-3 text-left text-sm font-medium text-muted-foreground'

function DeskRow({ i, now }: { i: DeadlineItem; now: Date }) {
  const due = new Date(i.due_at)
  const done = i.status !== null
  return (
    <tr className={cn('border-b', done && 'text-muted-foreground')}>
      <td className="py-2 pr-3">
        <Badge>{KIND_LABEL[i.kind]}</Badge>
      </td>
      <td className="py-2 pr-3 font-mono text-sm">{i.module_code}</td>
      <td className={cn('py-2 pr-3', !done && 'font-medium')}>{i.title}</td>
      <td className="py-2 pr-3">{shortDateTime(due)}</td>
      <td className="py-2 pr-3 text-sm">
        {!done && isUrgent(due, now, false) ? (
          <Badge variant="urgent">{relativeDue(due, now)}</Badge>
        ) : (
          <span className="text-muted-foreground">{due > now ? relativeDue(due, now) : 'Late window'}</span>
        )}
      </td>
      <td className="py-2 text-right text-sm">
        {done ? (
          <span className="inline-flex items-center gap-1">
            <Check className="size-4 text-success" strokeWidth={1.5} aria-hidden />
            Submitted{i.submitted_at && ` ${shortDate(new Date(i.submitted_at))}`}
          </span>
        ) : i.submission_mode === 'online' && due.getTime() - now.getTime() < 7 * 86_400_000 ? (
          <Button size="sm" asChild>
            <Link to={`/deadlines/${i.id}/submit`}>Submit work</Link>
          </Button>
        ) : (
          i.submission_mode !== 'online' && <span className="text-muted-foreground">{i.venue}</span>
        )}
      </td>
    </tr>
  )
}

function DeskTables({ show, items, week, now }: { show: Show; items: DeadlineItem[]; week: number | null; now: Date }) {
  if (show === 'upcoming') {
    const groups = upcomingGroups(items, week, now)
    if (!groups.length) return <Empty>Nothing coming up.</Empty>
    return (
      <table className="w-full border-collapse text-[15px] leading-[22px]">
        <thead>
          <tr className="border-b">
            <th className={cn(th, 'w-[110px]')}>Type</th>
            <th className={cn(th, 'w-[90px]')}>Module</th>
            <th className={th}>Title</th>
            <th className={cn(th, 'w-[180px]')}>Due</th>
            <th className={cn(th, 'w-[130px]')}>When</th>
            <th className={cn(th, 'w-[170px]')}>
              <span className="sr-only">Action or place</span>
            </th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.id}>
            <tr>
              <td colSpan={6} className="bg-muted px-3 py-1.5 text-xs leading-4 font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                {g.title}
              </td>
            </tr>
            {g.items.map((i) => (
              <DeskRow key={i.id} i={i} now={now} />
            ))}
          </tbody>
        ))}
      </table>
    )
  }
  const rows =
    show === 'submitted'
      ? items.filter((i) => (i.status === 'submitted' || i.status === 'late') && i.mark === null)
      : items.filter((i) => i.mark !== null)
  if (!rows.length) return <Empty>{show === 'submitted' ? 'Nothing waiting for marks.' : 'No marks released yet.'}</Empty>
  return (
    <table className="w-full border-collapse text-[15px] leading-[22px]">
      <thead>
        <tr className="border-b">
          <th className={cn(th, 'w-[110px]')}>Type</th>
          <th className={cn(th, 'w-[90px]')}>Module</th>
          <th className={th}>Title</th>
          <th className={cn(th, 'w-[180px]')}>{show === 'submitted' ? 'Submitted' : 'Due'}</th>
          <th className={cn(th, show === 'marked' ? 'w-[90px] text-right' : 'w-[150px]')}>
            {show === 'submitted' ? 'Status' : 'Mark'}
          </th>
          {show === 'marked' && <th className={cn(th, 'pl-6')}>Feedback</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((i) => (
          <tr key={i.id} className="border-b align-top">
            <td className="py-2 pr-3">
              <Badge>{KIND_LABEL[i.kind]}</Badge>
            </td>
            <td className="py-2 pr-3 font-mono text-sm">{i.module_code}</td>
            <td className="py-2 pr-3 font-medium">
              {show === 'submitted' ? <Link to={`/deadlines/${i.id}/submit`}>{i.title}</Link> : i.title}
            </td>
            <td className="py-2 pr-3">
              {show === 'submitted' && i.submitted_at ? shortDateTime(new Date(i.submitted_at)) : shortDateTime(new Date(i.due_at))}
            </td>
            {show === 'submitted' ? (
              <td className="py-2 text-sm">
                {i.status === 'late' ? <Badge variant="destructive">Late</Badge> : <span className="text-muted-foreground">Awaiting marks</span>}
              </td>
            ) : (
              <>
                <td className="py-2 text-right font-mono font-semibold">
                  {i.mark}/{i.max_mark}
                </td>
                <td className="py-2 pl-6 text-sm">{i.feedback}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
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
  const desktop = useIsDesktop()
  const setShow = (v: string) => setParams(v === 'upcoming' ? {} : { show: v }, { replace: true })

  if (desktop)
    return (
      <>
        <DeskBar left={<ClassContext />} />
        <main className="flex flex-col gap-4 px-8 py-6">
          <Tabs value={show} onValueChange={setShow} className="gap-4">
            <div className="flex items-end justify-between">
              <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.015em]">Deadlines</h1>
              <TabsList variant="segmented" aria-label="Filter deadlines" className="w-[340px]">
                <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                <TabsTrigger value="submitted">Submitted</TabsTrigger>
                <TabsTrigger value="marked">Marked</TabsTrigger>
              </TabsList>
            </div>
            {isPending && <Skeleton className="h-64" />}
            {isError && <Empty>Couldn't load your deadlines. Check your connection.</Empty>}
            {data && <DeskTables show={show} items={data.items} week={data.week} now={now} />}
          </Tabs>
        </main>
      </>
    )

  return (
    <main className="flex grow flex-col gap-6 px-4 py-6">
      <Tabs
        value={show}
        onValueChange={setShow}
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
