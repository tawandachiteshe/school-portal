import { Download } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StaffTopBar } from '@/components/shell/staff-shell'
import { FilterBar, FilterSearch, FilterSelect } from '@/components/staff/filter-bar'
import type { QueueRow, QueueTab } from '@/api/generated/model'
import { getQueueCsvUrl, useQueue, useQueueSummary } from '@/api/generated/admissions/admissions'
import { shortDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from '../teaching/staff-ui'

const PAGE = 25
const TABS: { value: QueueTab; label: string }[] = [
  { value: 'to_review', label: 'To review' },
  { value: 'needs_checking', label: 'Needs checking' },
  { value: 'waiting', label: 'Waiting for applicant' },
  { value: 'decided', label: 'Decided' },
]
const today = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  timeZone: 'Africa/Harare',
})

function Owner({ r }: { r: QueueRow }) {
  if (!r.owner_initials) return <span className="text-muted-foreground">—</span>
  return (
    <span
      title={r.owner_is_me ? 'You' : (r.owner_name ?? undefined)}
      aria-label={r.owner_is_me ? 'You' : (r.owner_name ?? undefined)}
      className="inline-flex size-6 items-center justify-center rounded-full border bg-muted text-[11px] font-semibold"
    >
      {r.owner_initials}
    </span>
  )
}

const decision = (r: QueueRow) =>
  r.status === 'accepted' ? 'Offered a place' : r.status === 'rejected' ? 'Declined' : 'Withdrawn'

// design/StaffQueue. `decided` is the "Decisions sent" page: the same list without the tabs.
export default function Queue({ decided = false }: { decided?: boolean }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: QueueTab = decided ? 'decided' : ((params.get('tab') as QueueTab | null) ?? 'to_review')
  const { data: summary } = useQueueSummary()
  const { data, isPending } = useQueue({ tab })
  const [q, setQ] = useState('')
  const [programme, setProgramme] = useState('all')
  const [elig, setElig] = useState('all')
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(0)

  const rows = data ?? []
  const programmes = [...new Map(rows.map((r) => [r.programme_id, r.programme])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  )
  const needle = q.trim().toLowerCase().replace(/[\s-]/g, '')
  const shown = rows.filter(
    (r) =>
      (!needle ||
        [r.name, r.reference, r.national_id ?? ''].some((s) => s.toLowerCase().replace(/[\s-]/g, '').includes(needle))) &&
      (programme === 'all' || r.programme_id === programme) &&
      (elig === 'all' || (elig === 'meets') === r.eligible) &&
      (!mine || r.owner_is_me),
  )
  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const at = Math.min(page, pages - 1)
  const visible = shown.slice(at * PAGE, at * PAGE + PAGE)
  const reset = () => setPage(0)
  const count = (t: QueueTab) => summary?.[t]

  const filters = (
    <FilterBar
      className={cn('py-3', !decided && 'border-b')}
      shown={shown.length}
      total={rows.length}
      noun="applications"
      active={!!q || programme !== 'all' || elig !== 'all' || mine}
      onClear={() => {
        setQ('')
        setProgramme('all')
        setElig('all')
        setMine(false)
        reset()
      }}
    >
      <FilterSearch value={q} onChange={(v) => (setQ(v), reset())} placeholder="Name, National ID or reference" className="w-[320px]" />
      <FilterSelect
        label="Programme"
        value={programme}
        onChange={(v) => (setProgramme(v), reset())}
        options={[{ value: 'all', label: 'All programmes' }, ...programmes.map(([value, label]) => ({ value, label }))]}
      />
      <FilterSelect
        label="Eligibility"
        value={elig}
        onChange={(v) => (setElig(v), reset())}
        options={[
          { value: 'all', label: 'Any eligibility' },
          { value: 'meets', label: 'Meets requirements' },
          { value: 'not', label: "Doesn't meet" },
        ]}
      />
      <Button
        variant="outline"
        size="sm"
        aria-pressed={mine}
        onClick={() => (setMine((m) => !m), reset())}
        className={cn('h-9', mine && 'border-primary bg-primary-soft text-primary hover:bg-primary-soft')}
      >
        Assigned to me
      </Button>
      <span className="ml-auto text-sm text-muted-foreground">{decided || tab === 'decided' ? 'Newest decision first' : 'Oldest first'}</span>
    </FilterBar>
  )

  return (
    <>
      <StaffTopBar
        left={`Admissions${summary?.intake ? ` · ${summary.intake}` : ''}`}
        right={
          <>
            {today.format(new Date()).replace(',', '')}
            {summary?.oldest_waiting_days != null &&
              ` · oldest application waiting ${summary.oldest_waiting_days} ${summary.oldest_waiting_days === 1 ? 'day' : 'days'}`}
          </>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(t) => {
          const p = new URLSearchParams(params)
          p.set('tab', t)
          setParams(p, { replace: true })
          reset()
        }}
        className="gap-0"
      >
        <div className="flex items-end justify-between px-8 pt-6 pb-4">
          <h1 className={staffH1}>{decided ? 'Decisions sent' : 'Applications'}</h1>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api${getQueueCsvUrl({ tab })}`} download>
              <Download strokeWidth={1.5} />
              Export CSV
            </a>
          </Button>
        </div>
        <div className="sticky top-14 z-[5] flex flex-col bg-background px-8">
          {!decided && (
            <TabsList aria-label="Queue">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}{' '}
                  <span className={cn('font-mono text-sm', t.value === 'needs_checking' && !!count(t.value) && 'text-urgent')}>
                    {count(t.value) ?? ''}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          )}
          {filters}
        </div>
      </Tabs>
      <main className="flex flex-col gap-4 px-8 pt-2 pb-6">
        {isPending ? (
          <Skeleton className="h-96" />
        ) : visible.length ? (
          <>
            <Table
              head={
                <>
                  <th className={th}>Reference</th>
                  <th className={th}>Applicant</th>
                  <th className={th}>National ID</th>
                  <th className={th}>Programme</th>
                  <th className={th}>Submitted</th>
                  <th className={th}>Eligibility</th>
                  {tab === 'decided' ? (
                    <>
                      <th className={th}>Decision</th>
                      <th className={th}>Decided</th>
                    </>
                  ) : (
                    <th className={th}>Needs attention</th>
                  )}
                  <th className={th}>Owner</th>
                </>
              }
            >
              {visible.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/staff/admissions/${r.reference}`)}
                >
                  <td className={cn(td, 'font-mono whitespace-nowrap')}>
                    <Link
                      to={`/staff/admissions/${r.reference}`}
                      className="text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.reference}
                    </Link>
                  </td>
                  <td className={cn(td, 'font-medium whitespace-nowrap')}>{r.name}</td>
                  <td className={cn(td, 'font-mono whitespace-nowrap')}>{r.national_id ?? '—'}</td>
                  <td className={cn(td, 'whitespace-nowrap')}>{r.programme}</td>
                  <td className={cn(td, 'whitespace-nowrap')}>{r.submitted_at ? shortDateTime(new Date(r.submitted_at)) : '—'}</td>
                  <td className={cn(td, 'whitespace-nowrap', r.eligible ? 'text-success' : 'font-medium text-destructive')}>{r.eligibility}</td>
                  {tab === 'decided' ? (
                    <>
                      <td className={cn(td, r.status === 'accepted' ? 'text-success' : 'text-muted-foreground')}>
                        {decision(r)}
                      </td>
                      <td className={cn(td, 'whitespace-nowrap')}>
                        {r.decided_at ? shortDateTime(new Date(r.decided_at)) : '—'}
                      </td>
                    </>
                  ) : (
                    <td
                      className={cn(
                        td,
                        r.attention_level === 'amber' ? 'font-medium text-urgent' : 'text-muted-foreground',
                      )}
                    >
                      {r.attention ?? '—'}
                    </td>
                  )}
                  <td className={td}>
                    <Owner r={r} />
                  </td>
                </tr>
              ))}
            </Table>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {at * PAGE + 1}–{at * PAGE + visible.length} of {shown.length}
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
          <p className="text-muted-foreground">
            {rows.length ? 'No applications match these filters.' : EMPTY[tab]}
          </p>
        )}
      </main>
    </>
  )
}

const EMPTY: Record<QueueTab, string> = {
  to_review: 'Nothing waiting for review.',
  needs_checking: 'Nothing needs checking.',
  waiting: 'No applications are waiting for the applicant.',
  decided: 'No decisions yet.',
}
