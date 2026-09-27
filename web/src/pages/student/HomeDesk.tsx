import { Check, Clock, Pin } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClassContext, DeskBar, DeskSearch } from '@/components/shell/student-desktop'
import type { Dashboard, DueItem, TodayClass } from '@/api/generated/model'
import { useMe } from '@/lib/auth'
import {
  fileKind,
  fileSize,
  formatLongDate,
  greeting,
  isUrgent,
  postedAt,
  relativeDue,
  shortDate,
  shortDateTime,
  time,
} from '@/lib/format'
import { KIND_LABEL } from '@/lib/student'
import { cn } from '@/lib/utils'

const list = '[&>li+li]:border-t'

function Head({ id, title, link }: { id: string; title: string; link?: { to: string; label: string } }) {
  return (
    <div className="flex items-center justify-between border-b">
      <h2 id={id} className="text-lg leading-6 font-semibold">
        {title}
      </h2>
      {link && (
        <Link to={link.to} className="inline-flex min-h-11 items-center text-sm font-medium text-primary">
          {link.label}
        </Link>
      )}
    </div>
  )
}

function inWords(mins: number) {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`
}

function TodayRow({ c, current, now }: { c: TodayClass; current: boolean; now: Date }) {
  const start = new Date(c.starts_at)
  const end = new Date(c.ends_at)
  const finished = end <= now
  const mins = Math.max(0, Math.round(((start <= now ? end : start).getTime() - now.getTime()) / 60_000))
  const what = c.assessment_title ?? c.module_name
  return (
    <li
      className={cn(
        'grid grid-cols-[110px_minmax(0,1fr)_130px] gap-4 py-3',
        finished && 'text-muted-foreground',
        current && '-mx-3 rounded-md bg-primary-soft px-3',
      )}
    >
      <span className={cn('pt-0.5 font-mono text-sm', current && 'font-medium text-primary')}>
        {time(start)}–{time(end)}
      </span>
      <span>
        <span className={cn('block', !finished && 'font-medium', c.cancelled && 'line-through')}>
          <span className="font-mono">{c.module_code}</span> {what}
        </span>
        <span className={cn('text-sm', !finished && 'text-muted-foreground')}>
          {c.cancelled ? `Cancelled${c.change_reason ? ` · ${c.change_reason}` : ''}` : [c.venue, c.lecturer].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className={cn('pt-0.5 text-right text-sm', current && 'font-medium text-primary')}>
        {finished ? 'Finished' : current ? (start <= now ? `Ends in ${inWords(mins)}` : `Starts in ${inWords(mins)}`) : ''}
      </span>
    </li>
  )
}

function DueRow({ d, now }: { d: DueItem; now: Date }) {
  const due = new Date(d.due_at)
  const where = d.submission_mode === 'online' ? 'submit online' : d.submission_mode === 'physical' ? 'hand in' : d.venue
  return (
    <li
      className={cn('grid grid-cols-[minmax(0,1fr)_150px_110px] items-start gap-4 py-3', d.submitted && 'text-muted-foreground')}
    >
      <span>
        <span className={cn('block', !d.submitted && 'font-medium')}>{d.title}</span>
        <span className={cn('text-sm', !d.submitted && 'text-muted-foreground')}>
          {KIND_LABEL[d.kind]} · <span className="font-mono">{d.module_code}</span>
          {!d.submitted && where && ` · ${where}`}
        </span>
      </span>
      <span className="pt-0.5 text-sm">{shortDateTime(due)}</span>
      <span className="text-right">
        {d.submitted ? (
          <span className="inline-flex items-center gap-1 pt-0.5 text-sm">
            <Check className="size-4 text-success" strokeWidth={1.5} aria-hidden />
            Submitted
          </span>
        ) : isUrgent(due, now, false) ? (
          <Badge variant="urgent">
            <Clock strokeWidth={1.5} aria-hidden />
            {relativeDue(due, now)}
          </Badge>
        ) : (
          <span className="pt-0.5 text-sm text-muted-foreground">{relativeDue(due, now)}</span>
        )}
      </span>
    </li>
  )
}

// design/DeskHome
export default function HomeDesk({
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
  const { data: me } = useMe()
  const current = data.today.findIndex((c) => !c.cancelled && new Date(c.ends_at) > now)
  const ann = data.announcements
  const next = data.next_class
  const week = me?.term?.week ? ` · Week ${me.term.week} of ${me.term.weeks}` : ''
  return (
    <>
      <DeskBar left={<ClassContext />} right={<DeskSearch />} />
      <main className="flex flex-col gap-8 p-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.015em]">
            {greeting(now)}, {me?.given_name}
          </h1>
          <p className="text-muted-foreground">
            {formatLongDate(now)}
            {week}
          </p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_330px] items-start gap-10">
          <div className="flex flex-col gap-8">
            <section aria-labelledby="dh-today">
              <Head id="dh-today" title="Today" link={{ to: '/timetable', label: 'Week view' }} />
              {data.today.length ? (
                <ul className={list}>
                  {data.today.map((c, i) => (
                    <TodayRow key={c.starts_at} c={c} current={i === current} now={now} />
                  ))}
                </ul>
              ) : (
                <p className="pt-3 text-muted-foreground">
                  No classes today.
                  {next && (
                    <>
                      {' '}
                      Your next class is <span className="font-mono">{next.module_code}</span> on{' '}
                      {shortDateTime(new Date(next.starts_at))}
                      {next.venue && ` in ${next.venue}`}.
                    </>
                  )}
                </p>
              )}
            </section>

            <section aria-labelledby="dh-due">
              <Head id="dh-due" title="Due in the next 7 days" link={{ to: '/deadlines', label: 'All deadlines' }} />
              {data.due.length ? (
                <ul className={list}>
                  {data.due.map((d) => (
                    <DueRow key={d.id} d={d} now={now} />
                  ))}
                </ul>
              ) : (
                <p className="pt-3 text-muted-foreground">Nothing due. Tests and assignments appear here once lecturers add them.</p>
              )}
            </section>

            <section aria-labelledby="dh-notes">
              <Head id="dh-notes" title="New notes" link={{ to: '/modules', label: 'All notes' }} />
              {data.notes.length ? (
                <ul className={list}>
                  {data.notes.map((n) => (
                    <li key={n.id} className="flex items-center gap-3 py-2.5">
                      <Badge className="w-12 justify-center font-mono">{fileKind(n.mime_type)}</Badge>
                      <span className="grow">
                        <span className="block font-medium">{n.title}</span>
                        <span className="text-sm text-muted-foreground">
                          <span className="font-mono">{n.module_code}</span>
                          {n.week && ` · Week ${n.week}`}
                          {n.size_bytes && ` · ${fileSize(n.size_bytes)}`}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onDownload(n)}
                        className="text-sm text-primary underline underline-offset-3"
                      >
                        Download<span className="sr-only"> {n.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pt-3 text-muted-foreground">No notes yet.</p>
              )}
            </section>
          </div>

          <aside className="flex flex-col gap-8">
            <section aria-labelledby="dh-ann">
              <Head
                id="dh-ann"
                title="Announcements"
                link={{ to: '/announcements', label: ann.total > ann.items.length ? `All ${ann.total}` : 'All' }}
              />
              <ul className={list}>
                {ann.items.map((a) => (
                  <li key={a.id}>
                    <Link to={`/announcements/${a.id}`} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 py-3">
                      {a.is_pinned ? (
                        <Pin className="mt-1 size-4 text-muted-foreground" strokeWidth={1.5} aria-label="Pinned" />
                      ) : !a.read ? (
                        <span className="pt-2 pl-1">
                          <span className="block size-2 rounded-full bg-primary" role="img" aria-label="Unread" />
                        </span>
                      ) : (
                        <span />
                      )}
                      <div>
                        <div className={a.read || a.is_pinned ? 'font-medium' : 'font-semibold'}>{a.title}</div>
                        <div className="text-sm text-muted-foreground">
                          {[a.is_pinned && 'Pinned', a.from_label, postedAt(new Date(a.publish_at), now)].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="dh-lib">
              <Head id="dh-lib" title="Library loans" link={{ to: '/library', label: 'Library' }} />
              {data.loans.length ? (
                <ul className={list}>
                  {data.loans.map((l) => {
                    const author = l.authors[0]?.split(' ').at(-1)
                    return (
                      <li key={l.id} className="flex items-center gap-3 py-3">
                        <div className="grow">
                          <div className="font-medium">{l.title}</div>
                          {l.overdue ? (
                            <div className="text-sm">
                              {author && <span className="text-muted-foreground">{author} · </span>}
                              <span className="font-medium text-destructive">Overdue since {shortDate(new Date(l.due_at))}</span>
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">
                              {[author, `Due ${shortDate(new Date(l.due_at))}`].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                        {!l.overdue && l.renewals_left > 0 && (
                          <Button variant="outline" size="sm" disabled={renewing} onClick={() => onRenew(l.id)}>
                            Renew
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="pt-3 text-muted-foreground">No books on loan.</p>
              )}
            </section>

            <section aria-labelledby="dh-res" className="flex flex-col gap-1">
              <h2 id="dh-res" className="border-b pb-2 text-lg leading-6 font-semibold">
                Results
              </h2>
              {data.results.published ? (
                <Link to="/results" className="pt-2 font-medium text-primary underline underline-offset-3">
                  {data.results.term_name} results are published
                </Link>
              ) : (
                <p className="pt-2 text-muted-foreground">
                  {data.results.term_name?.replace(/ \d{4}$/, '') ?? 'Semester'} results not yet published
                </p>
              )}
            </section>
          </aside>
        </div>
      </main>
    </>
  )
}
