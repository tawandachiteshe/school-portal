import { Search } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StaffTopBar } from '@/components/shell/staff-shell'
import { useFindStudents, useStudentProfile } from '@/api/generated/students/students'
import { shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from './teaching/staff-ui'

// No design: for Admissions and Student Affairs. Contact details, programme, class and library
// loans; never the National ID, date of birth or results. Opening a student is audited.
const STATUS: Record<string, string> = { active: 'Active', suspended: 'Suspended', withdrawn: 'Withdrawn', graduated: 'Graduated', deferred: 'Deferred' }
const MODE: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', block_release: 'Block release', online: 'Online' }

function Profile({ number }: { number: string }) {
  const { data: s, isPending, error } = useStudentProfile(number)
  if (isPending) return <Skeleton className="h-72" />
  if (error || !s) return <p className="text-muted-foreground">Couldn't open that student.</p>
  const rows: [string, React.ReactNode][] = [
    ['Student number', <span key="n" className="font-mono">{s.student_number}</span>],
    ['Programme', s.programme],
    ['Class', s.class_group ? <span key="c" className="font-mono">{s.class_group}</span> : '—'],
    ['Year of study', `Year ${s.year_of_study} · ${MODE[s.study_mode] ?? s.study_mode}`],
    ['Intake', s.intake ?? '—'],
    ['Status', STATUS[s.status] ?? s.status],
    ['Mobile', s.phone ? <span key="p" className="font-mono">{s.phone}</span> : '—'],
    ['Email', s.email ?? '—'],
    ['Fees', s.fees_cleared ? 'Cleared' : 'Not cleared'],
  ]
  return (
    <section aria-labelledby="st-name" className="flex flex-col gap-4 rounded-md border bg-card p-6">
      <h2 id="st-name" className="text-lg leading-6 font-semibold">
        {s.name}
      </h2>
      <dl className="divide-y border-y text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 py-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">Library books out</h3>
        {s.loans.length ? (
          <ul className="text-sm">
            {s.loans.map((l, i) => (
              <li key={i} className="flex justify-between gap-3 py-1">
                <span>{l.title}</span>
                <span className={cn('whitespace-nowrap', l.overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                  {l.overdue ? 'Overdue since ' : 'Due '}
                  {shortDate(new Date(l.due_at))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None.</p>
        )}
      </div>
    </section>
  )
}

export default function Students() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const query = useDeferredValue(q.trim())
  const open = params.get('student')
  const found = useFindStudents({ q: query }, { query: { enabled: query.length >= 2 } })
  const choose = (n: string) => setParams((p) => ({ ...Object.fromEntries(p), q: query, student: n }))
  return (
    <>
      <StaffTopBar left="College · find a student" />
      <main className="flex flex-col gap-4 px-8 py-6">
        <div>
          <h1 className={staffH1}>Find a student</h1>
          <p className="text-sm text-muted-foreground">By name or student number. Opening a student's details is recorded.</p>
        </div>
        <div role="search" className="relative w-[420px]">
          <label htmlFor="st-q" className="sr-only">
            Name or student number
          </label>
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <Input id="st-q" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tariro Moyo, or 0142" className="pl-9" />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-6">
          <div>
            {query.length < 2 ? (
              <p className="text-sm text-muted-foreground">Type at least two letters or digits.</p>
            ) : found.isPending ? (
              <Skeleton className="h-40" />
            ) : found.data && found.data.length ? (
              <Table
                head={
                  <>
                    <th className={th}>Student number</th>
                    <th className={th}>Name</th>
                    <th className={th}>Programme</th>
                    <th className={th}>Class</th>
                    <th className={th}>Status</th>
                  </>
                }
              >
                {found.data.map((s) => (
                  <tr key={s.student_number} className={cn('cursor-pointer hover:bg-muted', open === s.student_number && 'bg-primary-soft')} onClick={() => choose(s.student_number)}>
                    <td className={cn(td, 'font-mono whitespace-nowrap')}>
                      <button type="button" className="text-primary underline underline-offset-2" onClick={() => choose(s.student_number)}>
                        {s.student_number}
                      </button>
                    </td>
                    <td className={cn(td, 'font-medium whitespace-nowrap')}>{s.name}</td>
                    <td className={td}>{s.programme}</td>
                    <td className={cn(td, 'font-mono whitespace-nowrap')}>{s.class_group ?? '—'}</td>
                    <td className={td}>{STATUS[s.status] ?? s.status}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <p className="text-muted-foreground">No student matches “{query}”.</p>
            )}
          </div>
          {open && <Profile number={open} />}
        </div>
      </main>
    </>
  )
}
