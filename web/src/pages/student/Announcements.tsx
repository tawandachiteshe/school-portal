import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Info } from 'lucide-react'
import { useParams } from 'react-router'
import { Alert } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { SubPage } from '@/components/shell/sub-page'
import { AnnouncementRow } from '@/components/student/rows'
import { Empty, TextLink } from '@/components/student/section'
import { api, ApiError } from '@/lib/api'
import { formatLongDate, time } from '@/lib/format'
import { dashboardKey, type Announcements as AnnouncementList } from '@/lib/student'
import { useNow } from '@/lib/use-now'

type Detail = {
  id: string
  title: string
  body_md: string
  from_label: string | null
  publish_at: string
  is_pinned: boolean
  audience: string
  contact_line: string | null
  affects: string | null
  affects_you: boolean | null
}

export function AnnouncementsList() {
  const now = useNow()
  const { data, isPending, isError } = useQuery({
    queryKey: ['student', 'announcements'],
    queryFn: () => api<AnnouncementList>('/student/announcements'),
  })
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
  const { data, isPending, error } = useQuery({
    queryKey: ['student', 'announcements', id],
    queryFn: async () => {
      const d = await api<Detail>(`/student/announcements/${id}`)
      // Opening it marks it read: refresh the unread dots elsewhere.
      qc.invalidateQueries({ queryKey: dashboardKey })
      qc.invalidateQueries({ queryKey: ['student', 'announcements'], exact: true })
      return d
    },
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  })
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
        {error && <Empty>{error instanceof ApiError ? error.message : "Couldn't load this announcement."}</Empty>}
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
              <TextLink to={`/ask?about=announcement:${data.id}`}>Ask TCFL about this</TextLink>
            </div>
          </>
        )}
      </main>
    </SubPage>
  )
}
