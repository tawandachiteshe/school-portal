import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Info } from 'lucide-react'
import { useParams } from 'react-router'
import { Alert } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { SubPage } from '@/components/shell/sub-page'
import { AnnouncementRow } from '@/components/student/rows'
import { Empty, TextLink } from '@/components/student/section'
import {
  announcementDetail,
  getAnnouncementDetailQueryKey,
  getDashboardQueryKey,
  getListAnnouncementsQueryKey,
  useListAnnouncements,
} from '@/api/generated/student/student'
import { ApiError, errorMessage } from '@/lib/api'
import { formatLongDate, postedAt, time } from '@/lib/format'
import { useNow } from '@/lib/use-now'
import { useIsDesktop } from '@/lib/use-desktop'
import { DeskPage, deskH1 } from '@/components/shell/student-desktop'
import type { Announcements as AnnouncementList } from '@/api/generated/model'
import { Link } from 'react-router'
import { Pin } from 'lucide-react'

function ListDesk({ data, now }: { data: AnnouncementList; now: Date }) {
  const th = 'py-2 pr-3 text-left text-sm font-medium text-muted-foreground'
  return (
    <DeskPage crumbs={[{ label: 'Announcements' }]}>
      <div className="flex flex-col gap-1">
        <h1 className={deskH1}>Announcements</h1>
        <p className="text-muted-foreground">{data.unread ? `${data.unread} unread` : 'All read'}</p>
      </div>
      {data.items.length ? (
        <table className="w-full border-collapse text-[15px] leading-[22px]">
          <thead>
            <tr className="border-b">
              <th className={`${th} w-8`}>
                <span className="sr-only">Status</span>
              </th>
              <th className={th}>Title</th>
              <th className={`${th} w-[200px]`}>From</th>
              <th className={`${th} w-[140px]`}>Posted</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((a) => (
              <tr key={a.id} className="border-b">
                <td className="py-3 pr-3 align-top">
                  {a.is_pinned ? (
                    <Pin className="mt-1 size-4 text-muted-foreground" strokeWidth={1.5} aria-label="Pinned" />
                  ) : !a.read ? (
                    <span className="mt-2 ml-1 block size-2 rounded-full bg-primary" role="img" aria-label="Unread" />
                  ) : null}
                </td>
                <td className="py-3 pr-3">
                  <Link to={`/announcements/${a.id}`} className={a.read || a.is_pinned ? 'font-medium' : 'font-semibold'}>
                    {a.title}
                  </Link>
                </td>
                <td className="py-3 pr-3 text-muted-foreground">{a.from_label ?? '–'}</td>
                <td className="py-3 text-muted-foreground">{postedAt(new Date(a.publish_at), now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>No announcements.</Empty>
      )}
    </DeskPage>
  )
}

export function AnnouncementsList() {
  const now = useNow()
  const { data, isPending, isError } = useListAnnouncements()
  const desktop = useIsDesktop()
  if (desktop && data) return <ListDesk data={data} now={now} />
  return (
    <SubPage title="Announcements" back="/" backLabel="Back to home">
      <main className="flex flex-col gap-2 px-4 py-6">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">Announcements</h1>
        {data && <p className="text-muted-foreground">{data.unread ? `${data.unread} unread` : 'All read'}</p>}
        {isPending && <Skeleton className="mt-4 h-16" />}
        {isError && <Empty>Couldn't load announcements. Check your connection.</Empty>}
        {data &&
          (data.items.length ? (
            <ul className="mt-2 [&>li+li]:border-t">
              {data.items.map((a) => (
                <AnnouncementRow key={a.id} item={a} now={now} />
              ))}
            </ul>
          ) : (
            <Empty>No announcements.</Empty>
          ))}
      </main>
    </SubPage>
  )
}

export function AnnouncementDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const desktop = useIsDesktop()
  const { data, isPending, error } = useQuery({
    queryKey: getAnnouncementDetailQueryKey(id!),
    queryFn: async ({ signal }) => {
      const d = await announcementDetail(id!, { signal })
      // Opening it marks it read: refresh the unread dots elsewhere.
      void qc.invalidateQueries({ queryKey: getDashboardQueryKey() })
      void qc.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() })
      return d
    },
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  })
  if (desktop && data)
    return (
      <DeskPage crumbs={[{ to: '/announcements', label: 'Announcements' }, { label: data.from_label ?? 'Announcement' }]}>
        <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-12">
          <article className="flex flex-col gap-5">
            <h1 className={deskH1}>{data.title}</h1>
            {data.affects && (
              <Alert variant={data.affects_you ? 'info' : 'success'} className="px-4 py-3">
                {data.affects_you ? <Info strokeWidth={1.5} /> : <CircleCheck strokeWidth={1.5} />}
                <p className="text-sm">{data.affects}</p>
              </Alert>
            )}
            <div className="flex max-w-[65ch] flex-col gap-4">
              {data.body_md.split(/\n{2,}/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </article>
          <aside className="flex flex-col gap-4 border-l pl-6 text-sm">
            <dl className="flex flex-col gap-3">
              {data.from_label && (
                <div>
                  <dt className="text-muted-foreground">From</dt>
                  <dd className="font-medium">{data.from_label}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Posted</dt>
                <dd>
                  {formatLongDate(new Date(data.publish_at))}, {time(new Date(data.publish_at))}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">To</dt>
                <dd>{data.audience}</dd>
              </div>
            </dl>
            <div className="flex flex-col gap-1 border-t pt-4">
              {data.contact_line && <p className="text-muted-foreground">{data.contact_line}</p>}
              <TextLink to={`/ask?about=announcement:${data.id}`}>Ask Campus about this</TextLink>
            </div>
          </aside>
        </div>
      </DeskPage>
    )
  return (
    <SubPage title={<span className="font-semibold">Announcement</span>} back="/" backLabel="Back">
      <main className="flex grow flex-col gap-5 px-4 py-6">
        {isPending && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-8" />
            <Skeleton className="h-24" />
          </div>
        )}
        {error && <Empty>{errorMessage(error, "Couldn't load this announcement.")}</Empty>}
        {data && (
          <>
            <article className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  {[data.from_label, `${formatLongDate(new Date(data.publish_at))}, ${time(new Date(data.publish_at))}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">{data.title}</h1>
                <p className="text-sm text-muted-foreground">To: {data.audience}</p>
              </div>
              {data.affects && (
                <Alert variant={data.affects_you ? 'info' : 'success'} className="px-4 py-3">
                  {data.affects_you ? <Info strokeWidth={1.5} /> : <CircleCheck strokeWidth={1.5} />}
                  <p className="text-sm">{data.affects}</p>
                </Alert>
              )}
              <div className="flex max-w-[60ch] flex-col gap-4">
                {data.body_md.split(/\n{2,}/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </article>
            <div className="flex flex-col gap-1 border-t pt-4">
              {data.contact_line && <p className="text-sm text-muted-foreground">{data.contact_line}</p>}
              <TextLink to={`/ask?about=announcement:${data.id}`}>Ask Campus about this</TextLink>
            </div>
          </>
        )}
      </main>
    </SubPage>
  )
}
