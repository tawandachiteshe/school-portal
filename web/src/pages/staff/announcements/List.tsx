import { Pin } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StaffTopBar } from '@/components/shell/staff-shell'
import { FilterBar, FilterSearch, FilterSelect } from '@/components/staff/filter-bar'
import type { AnnouncementStatus } from '@/api/generated/model'
import { useListStaffAnnouncements } from '@/api/generated/staff-announcements/staff-announcements'
import { useMe } from '@/lib/auth'
import { formatLongDate, shortDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from '../teaching/staff-ui'

const STATUS: Record<AnnouncementStatus, { label: string; variant: 'neutral' | 'info' | 'success' }> = {
  draft: { label: 'Draft', variant: 'neutral' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  published: { label: 'Published', variant: 'success' },
  expired: { label: 'Ended', variant: 'neutral' },
}

// No design for the list; dense table in the staff style. Student Affairs and admins write.
export default function AnnouncementsStaff() {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const writer = !!me?.roles.some((r) => r === 'student_affairs' || r === 'admin')
  const { data, isPending } = useListStaffAnnouncements()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const all = data ?? []
  const shown = all.filter(
    (a) =>
      (status === 'all' || a.status === status) &&
      (!q.trim() || `${a.title} ${a.from_label ?? ''} ${a.audience}`.toLowerCase().includes(q.trim().toLowerCase())),
  )
  return (
    <>
      <StaffTopBar left={formatLongDate(new Date())} />
      <main className="flex flex-col gap-4 px-8 py-6">
        <div className="flex items-end justify-between gap-4">
          <h1 className={staffH1}>Announcements</h1>
          {writer && (
            <Button asChild>
              <Link to="/staff/announcements/new">Write an announcement</Link>
            </Button>
          )}
        </div>
        {all.length > 0 && (
          <FilterBar
            shown={shown.length}
            total={all.length}
            noun="announcements"
            active={!!q || status !== 'all'}
            onClear={() => {
              setQ('')
              setStatus('all')
            }}
          >
            <FilterSearch value={q} onChange={setQ} placeholder="Find an announcement" />
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'Any status' },
                ...(writer ? [{ value: 'draft', label: 'Drafts' }] : []),
                { value: 'scheduled', label: 'Scheduled' },
                { value: 'published', label: 'Published' },
                { value: 'expired', label: 'Ended' },
              ]}
            />
          </FilterBar>
        )}
        {isPending ? (
          <Skeleton className="h-80" />
        ) : shown.length ? (
          <Table
            head={
              <>
                <th className={th}>Title</th>
                <th className={th}>From</th>
                <th className={th}>Audience</th>
                <th className={th}>Status</th>
                <th className={th}>Publish time</th>
                <th className={cn(th, 'text-right')}>Read by</th>
              </>
            }
          >
            {shown.map((a) => {
              const s = STATUS[a.status]
              const open = writer ? () => navigate(`/staff/announcements/${a.id}`) : undefined
              return (
                <tr key={a.id} className={cn(open && 'cursor-pointer hover:bg-muted/50')} onClick={open}>
                  <td className={td}>
                    <div className="flex max-w-[280px] items-center gap-1.5">
                      {a.pinned && <Pin className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-label="Pinned" />}
                      {writer ? (
                        <Link
                          to={`/staff/announcements/${a.id}`}
                          className={cn('truncate font-medium hover:underline', !a.title && 'text-muted-foreground')}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {a.title || 'Untitled draft'}
                        </Link>
                      ) : (
                        <span className="truncate font-medium">{a.title}</span>
                      )}
                    </div>
                  </td>
                  <td className={cn(td, 'whitespace-nowrap')}>{a.from_label ?? '—'}</td>
                  <td className={cn(td, 'whitespace-nowrap first-letter:uppercase')}>
                    {a.audience}
                    {a.sms && <span className="text-muted-foreground"> · SMS</span>}
                  </td>
                  <td className={td}>
                    <Badge variant={s.variant}>{s.label}</Badge>
                  </td>
                  <td className={cn(td, 'whitespace-nowrap')}>
                    {a.status === 'draft' ? (
                      <span className="text-muted-foreground">Edited {shortDateTime(new Date(a.updated_at))}</span>
                    ) : (
                      shortDateTime(new Date(a.publish_at))
                    )}
                  </td>
                  <td className={cn(td, 'text-right font-mono')}>{a.status === 'draft' ? '' : a.reads}</td>
                </tr>
              )
            })}
          </Table>
        ) : (
          <p className="text-muted-foreground">{all.length ? 'No announcements match these filters.' : 'No announcements yet.'}</p>
        )}
      </main>
    </>
  )
}
