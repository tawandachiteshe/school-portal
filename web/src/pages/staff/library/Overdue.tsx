import { useQueryClient } from '@tanstack/react-query'
import { Download, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StaffTopBar } from '@/components/shell/staff-shell'
import { FilterBar, FilterSearch, FilterSelect } from '@/components/staff/filter-bar'
import {
  getDeskTodayQueryKey,
  getOverdueCsvUrl,
  getOverdueQueryKey,
  useDeskToday,
  useOverdue,
  useRemind,
} from '@/api/generated/library-desk/library-desk'
import { ApiError } from '@/lib/api'
import { formatLongDate, shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from '../teaching/staff-ui'

const PAGE = 25
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const box = 'size-4 cursor-pointer accent-primary'

// design/LibraryOverdue
export default function Overdue() {
  const qc = useQueryClient()
  const { data, isPending } = useOverdue()
  const { data: today } = useDeskToday()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [cls, setCls] = useState('all')
  const [reminded, setReminded] = useState('all')
  const [page, setPage] = useState(0)

  const remind = useRemind({
    mutation: {
      onSuccess: (r) => {
        // SMS go out through the delivery queue, so say queued rather than sent.
        const parts = [`${plural(r.reminded, 'student')} reminded in the portal`]
        if (r.sms_queued) parts.push(`${plural(r.sms_queued, 'SMS', 'SMS')} queued`)
        if (r.no_phone) parts.push(`${r.no_phone} with no phone number`)
        toast(parts.join(' · ') + '.')
        setPicked(new Set())
        void qc.invalidateQueries({ queryKey: getOverdueQueryKey() })
        void qc.invalidateQueries({ queryKey: getDeskTodayQueryKey() })
      },
      onError: (e) => toast(e instanceof ApiError ? e.message : "Couldn't send reminders. Try again."),
    },
  })

  const loans = data?.loans ?? []
  const classes = useMemo(() => [...new Set(loans.map((l) => l.class_group).filter(Boolean) as string[])].sort(), [loans])
  const shown = loans.filter((l) => {
    const needle = q.trim().toLowerCase()
    if (needle && ![l.name, l.number ?? '', l.title, l.author ?? ''].some((s) => s.toLowerCase().includes(needle))) return false
    if (cls !== 'all' && l.class_group !== cls) return false
    if (reminded === 'never' && l.last_reminder_at) return false
    if (reminded === 'sent' && !l.last_reminder_at) return false
    return true
  })
  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const at = Math.min(page, pages - 1)
  const rows = shown.slice(at * PAGE, at * PAGE + PAGE)
  const allOnPage = rows.length > 0 && rows.every((r) => picked.has(r.loan_id))
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const location = today?.location ?? '[LIBRARY LOCATION]'

  return (
    <>
      <StaffTopBar left={formatLongDate(new Date())} />
      <main className="flex flex-col gap-4 px-8 py-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className={staffH1}>Overdue loans</h1>
            {data && (
              <p className="text-sm text-muted-foreground">
                {loans.length
                  ? `${plural(loans.length, 'book')} with ${plural(data.borrowers, 'student')} · longest overdue ${plural(data.longest, 'day')}`
                  : 'Nothing is overdue.'}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api${getOverdueCsvUrl()}`} download>
              <Download strokeWidth={1.5} />
              Export CSV
            </a>
          </Button>
        </div>

        {picked.size > 0 && (
          <div
            role="region"
            aria-label="Selection"
            className="flex items-center gap-4 rounded-md bg-primary-soft px-3 py-2"
          >
            <span className="text-sm font-medium">{picked.size} selected</span>
            <Button size="sm" disabled={remind.isPending} onClick={() => remind.mutate({ data: { loan_ids: [...picked] } })}>
              <Send strokeWidth={1.5} />
              Send SMS reminder
            </Button>
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              “Your library book [title] was due [date]. Please return it to the {location} desk.”
            </span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
          </div>
        )}

        {loans.length > 0 && (
          <FilterBar
            shown={shown.length}
            total={loans.length}
            noun="loans"
            active={!!q || cls !== 'all' || reminded !== 'all'}
            onClear={() => {
              setQ('')
              setCls('all')
              setReminded('all')
            }}
          >
            <FilterSearch value={q} onChange={(v) => (setQ(v), setPage(0))} placeholder="Find a student or book" />
            <FilterSelect
              label="Class"
              value={cls}
              onChange={(v) => (setCls(v), setPage(0))}
              options={[{ value: 'all', label: 'All classes' }, ...classes.map((c) => ({ value: c, label: c }))]}
            />
            <FilterSelect
              label="Reminder"
              value={reminded}
              onChange={(v) => (setReminded(v), setPage(0))}
              options={[
                { value: 'all', label: 'Any reminder' },
                { value: 'never', label: 'Not reminded' },
                { value: 'sent', label: 'Reminded' },
              ]}
            />
          </FilterBar>
        )}

        {isPending ? (
          <Skeleton className="h-80" />
        ) : rows.length ? (
          <>
            <Table
              head={
                <>
                  <th className={cn(th, 'w-9')}>
                    <input
                      type="checkbox"
                      className={box}
                      aria-label="Select all on this page"
                      checked={allOnPage}
                      onChange={() =>
                        setPicked((s) => {
                          const n = new Set(s)
                          rows.forEach((r) => (allOnPage ? n.delete(r.loan_id) : n.add(r.loan_id)))
                          return n
                        })
                      }
                    />
                  </th>
                  <th className={th}>Student</th>
                  <th className={th}>Student no.</th>
                  <th className={th}>Class</th>
                  <th className={th}>Book</th>
                  <th className={th}>Due</th>
                  <th className={cn(th, 'text-right')}>Days late</th>
                  <th className={th}>Last reminder</th>
                </>
              }
            >
              {rows.map((l) => (
                <tr key={l.loan_id} className={cn(picked.has(l.loan_id) && 'bg-primary-soft/40')}>
                  <td className={td}>
                    <input
                      type="checkbox"
                      className={box}
                      aria-label={`Select ${l.name}`}
                      checked={picked.has(l.loan_id)}
                      onChange={() => toggle(l.loan_id)}
                    />
                  </td>
                  <td className={cn(td, 'font-medium whitespace-nowrap')}>{l.name}</td>
                  <td className={cn(td, 'font-mono whitespace-nowrap')}>{l.number ?? '—'}</td>
                  <td className={cn(td, 'font-mono whitespace-nowrap')}>{l.class_group ?? '—'}</td>
                  <td className={td}>
                    {l.title}
                    {l.author && ` · ${l.author}`}
                  </td>
                  <td className={cn(td, 'whitespace-nowrap')}>{shortDate(new Date(l.due_at))}</td>
                  <td className={cn(td, 'text-right font-mono font-semibold text-destructive')}>{l.days_late}</td>
                  <td className={cn(td, 'whitespace-nowrap', !l.last_reminder_at && 'text-muted-foreground')}>
                    {l.last_reminder_at
                      ? `${l.last_reminder_channel === 'sms' ? 'SMS' : 'Portal'}, ${shortDate(new Date(l.last_reminder_at))}`
                      : 'None'}
                    {!l.has_phone && <span className="text-muted-foreground"> · no phone</span>}
                  </td>
                </tr>
              ))}
            </Table>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {at * PAGE + 1}–{at * PAGE + rows.length} of {shown.length} · most overdue first
              </span>
              {pages > 1 && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={at === 0} onClick={() => setPage(at - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
                    Next
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          loans.length > 0 && <p className="text-muted-foreground">No overdue loans match these filters.</p>
        )}
      </main>
    </>
  )
}
