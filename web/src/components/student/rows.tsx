import { Check, ChevronRight, Clock, Download, Pin } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  calendarDaysBetween,
  fileKind,
  fileSize,
  isUrgent,
  postedAt,
  relativeDue,
  shortDate,
  shortDateTime,
} from '@/lib/format'
import type { AnnouncementItem, DueItem, LoanItem, NoteItem } from '@/api/generated/model'
import { useOnline } from '@/lib/offline'
import { KIND_LABEL } from '@/lib/student'
import { cn } from '@/lib/utils'

// Tests, assignments… (design/Main "Due in the next 7 days", Deadlines).
export function DueRow({ item, now }: { item: DueItem; now: Date }) {
  const due = new Date(item.due_at)
  const rel = relativeDue(due, now)
  const where =
    item.submission_mode === 'online' ? 'submit online' : item.submission_mode === 'physical' ? 'hand in' : item.venue
  const meta = item.submitted
    ? `${shortDateTime(due)} · ${rel}`
    : [shortDateTime(due), where].filter(Boolean).join(' · ')
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="flex min-w-0 grow flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge>{KIND_LABEL[item.kind]}</Badge>
          <span className="font-mono text-sm text-muted-foreground">{item.module_code}</span>
        </div>
        <div className={cn('font-medium', item.submitted && 'text-muted-foreground')}>{item.title}</div>
        <div className="text-sm text-muted-foreground">{meta}</div>
      </div>
      {item.submitted ? (
        <span className="mt-px inline-flex items-center gap-1 text-sm text-muted-foreground">
          <Check className="size-4 text-success" strokeWidth={1.5} aria-hidden />
          Submitted
        </span>
      ) : isUrgent(due, now, false) ? (
        <Badge variant="urgent" className="mt-px">
          <Clock strokeWidth={1.5} aria-hidden />
          {rel}
        </Badge>
      ) : (
        <span className="mt-px text-sm whitespace-nowrap text-muted-foreground">{rel}</span>
      )}
    </li>
  )
}

export function AnnouncementRow({ item, now }: { item: AnnouncementItem; now: Date }) {
  const meta = [item.is_pinned && 'Pinned', item.from_label, postedAt(new Date(item.publish_at), now)]
    .filter(Boolean)
    .join(' · ')
  return (
    <li>
      <Link to={`/announcements/${item.id}`} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 py-3">
        {item.is_pinned ? (
          <Pin className="mt-1 size-4 text-muted-foreground" strokeWidth={1.5} aria-label="Pinned" />
        ) : !item.read ? (
          <span className="pt-2 pl-1">
            <span className="block size-2 rounded-full bg-primary" aria-label="Unread" role="img" />
          </span>
        ) : (
          <span />
        )}
        <div>
          <div className={item.read || item.is_pinned ? 'font-medium' : 'font-semibold'}>{item.title}</div>
          <div className="text-sm text-muted-foreground">{meta}</div>
        </div>
      </Link>
    </li>
  )
}

export function NoteRow({
  item,
  onDownload,
  showModule = true,
  now,
}: {
  item: NoteItem & { downloaded?: boolean }
  onDownload: () => void
  showModule?: boolean
  now?: Date
}) {
  const online = useOnline()
  const kind = fileKind(item.mime_type)
  const size = item.size_bytes ? fileSize(item.size_bytes) : null
  // Offline: notes come from the server, so they wait for the signal (design/StateOffline).
  if (!online)
    return (
      <li className="flex items-center gap-3 py-2">
        <Badge className="w-11 justify-center font-mono">{kind}</Badge>
        <div className="min-w-0 grow">
          <div className="font-medium text-muted-foreground">{item.title}</div>
          <div className="text-sm text-muted-foreground">
            {showModule && <span className="font-mono">{item.module_code}</span>}
            {showModule && ' · '}
            {[size, item.downloaded ? 'downloaded to this phone' : 'download when back online'].filter(Boolean).join(' · ')}
          </div>
        </div>
        <Button variant="ghost" size="icon" disabled aria-label={`${item.title}: download when back online`}>
          <Download strokeWidth={1.5} />
        </Button>
      </li>
    )
  const when = now ? noteAge(new Date(item.published_at), now) : null
  const meta = [item.week && `Week ${item.week}`, size, !item.downloaded && when].filter(Boolean).join(' · ')
  return (
    <li className="flex items-center gap-3 py-2">
      <Badge className="w-11 justify-center font-mono">{kind}</Badge>
      <div className="min-w-0 grow">
        <div className="font-medium">{item.title}</div>
        <div className="text-sm text-muted-foreground">
          {showModule && (
            <>
              <span className="font-mono">{item.module_code}</span>
              {meta && ' · '}
            </>
          )}
          {meta}
          {item.downloaded && (
            <>
              {' · '}
              <span className="text-success">downloaded</span>
            </>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDownload}
        aria-label={
          item.downloaded ? `Open ${item.title}` : `Download ${item.title}, ${kind}${size ? `, ${size}` : ''}`
        }
      >
        {item.downloaded ? <ChevronRight strokeWidth={1.5} /> : <Download strokeWidth={1.5} />}
      </Button>
    </li>
  )
}

// "today", "yesterday", "3 days ago", or a date after a week.
function noteAge(d: Date, now: Date): string {
  const days = calendarDaysBetween(d, now)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return shortDate(d)
}

export function LoanRow({
  item,
  onRenew,
  renewing,
}: {
  item: LoanItem
  onRenew: (id: string) => void
  renewing: boolean
}) {
  const online = useOnline()
  const due = new Date(item.due_at)
  const author = item.authors[0]?.split(' ').at(-1)
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 grow">
        <div className="font-medium">{item.title}</div>
        {item.overdue ? (
          <>
            <div className="text-sm">
              {author && <span className="text-muted-foreground">{author} · </span>}
              <span className="font-medium text-destructive">Overdue since {shortDate(due)}</span>
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">Return it to the library desk, Block A</div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">
            {[author, `Due ${shortDate(due)}`].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      {!item.overdue && item.renewals_left > 0 && (
        <Button variant="outline" onClick={() => onRenew(item.id)} disabled={renewing || !online}>
          Renew
        </Button>
      )}
    </li>
  )
}
