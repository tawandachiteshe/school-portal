import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StaffTopBar } from '@/components/shell/staff-shell'
import { Initials } from '@/components/shell/wordmark'
import type { Borrower, DeskCopy, Returned } from '@/api/generated/model'
import {
  findBorrower,
  findCopy,
  getDeskTodayQueryKey,
  getOverdueQueryKey,
  getReservationsQueryKey,
  useDeskRenew,
  useDeskToday,
  useIssueBook,
  useReturnBook,
} from '@/api/generated/library-desk/library-desk'
import { errorMessage } from '@/lib/api'
import { formatLongDate, shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from '../teaching/staff-ui'

const dueDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Africa/Harare' })

function useRefreshDesk() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: getDeskTodayQueryKey() })
    void qc.invalidateQueries({ queryKey: getOverdueQueryKey() })
    void qc.invalidateQueries({ queryKey: getReservationsQueryKey() })
  }
}

// --- Issue --------------------------------------------------------------------------------------

function BorrowerPanel({ b, onChanged }: { b: Borrower; onChanged: () => void }) {
  const refresh = useRefreshDesk()
  const renew = useDeskRenew({
    mutation: {
      onSuccess: (r) => {
        toast(`Renewed. Due back ${shortDate(new Date(r.due_at))}.`)
        onChanged()
      },
      onError: (e) => toast(errorMessage(e, "Couldn't renew.")),
    },
  })
  const ret = useReturnBook({
    mutation: {
      onSuccess: (r) => {
        toast(r.hold_for ? `Returned. Keep it at the desk for ${r.hold_for}.` : 'Returned.')
        refresh()
        onChanged()
      },
      onError: (e) => toast(errorMessage(e, "Couldn't return.")),
    },
  })
  const overdue = b.loans.filter((l) => l.days_late > 0)
  return (
    <section aria-labelledby="desk-borrower" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Initials initials={b.initials} className="size-11 text-[15px]" />
        <div>
          <h2 id="desk-borrower" className="text-lg leading-6 font-semibold">
            {b.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{b.number}</span>
            {b.programme && ` · ${b.programme}`}
            {b.class_group && (
              <>
                {' · '}
                <span className="font-mono">{b.class_group}</span>
              </>
            )}
          </p>
        </div>
      </div>
      {overdue.length > 0 && (
        <Alert variant="destructive">
          <CircleAlert strokeWidth={1.5} />
          <p>
            <span className="font-semibold">
              {overdue.length} overdue {overdue.length === 1 ? 'book' : 'books'}.
            </span>{' '}
            {overdue.map((l) => `${l.title} was due ${shortDate(new Date(l.due_at))}`).join('; ')}. Ask for{' '}
            {overdue.length === 1 ? 'it' : 'them'} back before issuing more.
          </p>
        </Alert>
      )}
      {b.loans.length ? (
        <Table
          head={
            <>
              <th className={th}>On loan</th>
              <th className={th}>Barcode</th>
              <th className={th}>Due</th>
              <th className={th}>
                <span className="sr-only">Action</span>
              </th>
            </>
          }
        >
          {b.loans.map((l) => (
            <tr key={l.id}>
              <td className={td}>
                <div className="font-medium">{l.title}</div>
                {l.author && <div className="text-xs text-muted-foreground">{l.author}</div>}
              </td>
              <td className={cn(td, 'font-mono whitespace-nowrap')}>{l.barcode}</td>
              <td className={cn(td, 'whitespace-nowrap', l.days_late > 0 && 'font-medium text-destructive')}>
                {shortDate(new Date(l.due_at))}
                {l.days_late > 0 && ` · ${l.days_late} ${l.days_late === 1 ? 'day' : 'days'} late`}
              </td>
              <td className={cn(td, 'text-right')}>
                {l.days_late > 0 || l.renewals_left === 0 ? (
                  <Button variant="outline" size="sm" disabled={ret.isPending} onClick={() => ret.mutate({ data: { barcode: l.barcode } })}>
                    Return
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled={renew.isPending} onClick={() => renew.mutate({ loanId: l.id })}>
                    Renew
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="text-muted-foreground">Nothing on loan.</p>
      )}
    </section>
  )
}

function IssueCard({ b, onIssued }: { b: Borrower; onIssued: () => void }) {
  const refresh = useRefreshDesk()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [barcode, setBarcode] = useState('')
  const [copy, setCopy] = useState<DeskCopy | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [override, setOverride] = useState(false)
  const { data: today } = useDeskToday()
  const issue = useIssueBook({
    mutation: {
      onSuccess: (r) => {
        toast(`${r.title} issued. Due back ${shortDate(new Date(r.due_at))}.`)
        setBarcode('')
        setCopy(null)
        setOverride(false)
        refresh()
        onIssued()
        inputRef.current?.focus()
      },
      onError: (e) => setProblem(errorMessage(e, "Couldn't issue this book.")),
    },
  })

  async function lookUp(code: string) {
    setProblem(null)
    setCopy(null)
    if (!code.trim()) return
    try {
      setCopy(await findCopy(code.trim()))
    } catch (e) {
      setProblem(errorMessage(e, "Couldn't find that book."))
    }
  }

  const heldForOther = copy?.held_for_person_id && copy.held_for_person_id !== b.person_id
  const heldForThem = copy?.held_for_person_id === b.person_id
  const blocked = !copy || copy.status !== 'available' || !!heldForOther
  const needsOverride = b.overdue > 0
  const due = new Date()
  due.setDate(due.getDate() + (today?.loan_days ?? 14))
  const weeks = (today?.loan_days ?? 14) / 7

  return (
    <section aria-labelledby="desk-book" className="flex flex-col gap-4 rounded-md border bg-card p-5">
      <h2 id="desk-book" className="font-semibold">
        Book to issue
      </h2>
      {b.held.length > 0 && !copy && (
        <p className="text-sm">
          Kept for {b.name.split(' ')[0]}:{' '}
          {b.held.map((h) => (
            <button
              key={h.reservation_id}
              type="button"
              className="text-primary underline underline-offset-2"
              onClick={() => {
                if (!h.barcode) return
                setBarcode(h.barcode)
                void lookUp(h.barcode)
              }}
            >
              {h.title}
              {h.barcode && <span className="font-mono"> ({h.barcode})</span>}
            </button>
          ))}
        </p>
      )}
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          void lookUp(barcode)
        }}
      >
        <Label htmlFor={inputId}>Book barcode</Label>
        <input
          ref={inputRef}
          id={inputId}
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          placeholder="Scan the book"
          autoComplete="off"
          className="h-11 rounded-sm border border-input bg-card px-3 font-mono"
        />
      </form>
      {problem && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {problem}
        </p>
      )}
      {copy && (
        <>
          <div className="flex flex-col gap-1 border-y py-3">
            <div className="font-semibold">{copy.title}</div>
            <div className="text-sm text-muted-foreground">
              {[copy.authors[0], copy.edition].filter(Boolean).join(' · ')}
              {copy.call_number && (
                <>
                  {' · shelf '}
                  <span className="font-mono">{copy.call_number}</span>
                </>
              )}
            </div>
            <div className="mt-1.5">
              {heldForThem ? (
                <Badge variant="success">Reserved for this student</Badge>
              ) : heldForOther ? (
                <Badge variant="destructive">Kept for {copy.held_for}</Badge>
              ) : copy.status === 'on_loan' ? (
                <Badge variant="destructive">On loan to {copy.on_loan_to}</Badge>
              ) : copy.status !== 'available' ? (
                <Badge variant="destructive">Not for loan</Badge>
              ) : null}
            </div>
          </div>
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Loan period</dt>
            <dd>{weeks === Math.round(weeks) ? `${weeks} ${weeks === 1 ? 'week' : 'weeks'}` : `${today?.loan_days} days`}</dd>
            <dt className="text-muted-foreground">Due back</dt>
            <dd className="font-medium">{dueDate.format(due).replace(',', '')}</dd>
          </dl>
        </>
      )}
      {needsOverride && copy && !blocked && (
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
          />
          Issue anyway. I've spoken to the student about the overdue book.
        </label>
      )}
      <Button
        block
        disabled={blocked || (needsOverride && !override) || issue.isPending}
        onClick={() =>
          copy &&
          issue.mutate({ data: { person_id: b.person_id, barcode: copy.barcode, allow_with_overdue: override } })
        }
      >
        Issue book
      </Button>
      <p className="text-xs text-muted-foreground">The student gets a message with the due date.</p>
    </section>
  )
}

function IssueMode() {
  const inputId = useId()
  const hintId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [number, setNumber] = useState('')
  const [b, setB] = useState<Borrower | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => inputRef.current?.focus(), [])

  async function lookUp(n: string) {
    setProblem(null)
    if (!n.trim()) return
    try {
      setB(await findBorrower(n.trim()))
    } catch (e) {
      setB(null)
      setProblem(errorMessage(e, "Couldn't find that card."))
    }
  }
  const reload = () => b && void lookUp(b.number)

  return (
    <>
      <form
        className="flex max-w-[560px] flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          void lookUp(number)
        }}
      >
        <Label htmlFor={inputId}>Student card or student number</Label>
        <input
          ref={inputRef}
          id={inputId}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          aria-describedby={hintId}
          autoComplete="off"
          className="h-12 rounded-sm border border-input bg-card px-3 font-mono text-lg"
        />
        <span id={hintId} className="text-sm text-muted-foreground">
          Scan the barcode on the card, or type the number and press Enter
        </span>
        {problem && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {problem}
          </p>
        )}
      </form>
      {b && (
        <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-8">
          <BorrowerPanel key={b.person_id + b.loans.length} b={b} onChanged={reload} />
          <IssueCard key={b.person_id} b={b} onIssued={reload} />
        </div>
      )}
    </>
  )
}

// --- Return -------------------------------------------------------------------------------------

function ReturnMode() {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const refresh = useRefreshDesk()
  const [barcode, setBarcode] = useState('')
  const [done, setDone] = useState<(Returned & { barcode: string; at: Date })[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => inputRef.current?.focus(), [])
  const ret = useReturnBook({
    mutation: {
      onSuccess: (r, vars) => {
        setDone((d) => [{ ...r, barcode: vars.data.barcode, at: new Date() }, ...d])
        setBarcode('')
        refresh()
        inputRef.current?.focus()
      },
      onError: (e) => setProblem(errorMessage(e, "Couldn't return this book.")),
    },
  })
  return (
    <>
      <form
        className="flex max-w-[560px] flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          setProblem(null)
          if (barcode.trim()) ret.mutate({ data: { barcode: barcode.trim() } })
        }}
      >
        <Label htmlFor={inputId}>Book barcode</Label>
        <input
          ref={inputRef}
          id={inputId}
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          autoComplete="off"
          placeholder="Scan the book"
          className="h-12 rounded-sm border border-input bg-card px-3 font-mono text-lg"
        />
        <span className="text-sm text-muted-foreground">Each scan returns the book straight away</span>
        {problem && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {problem}
          </p>
        )}
      </form>
      {done[0]?.hold_for && (
        <Alert variant="info" className="max-w-[560px]">
          <Info strokeWidth={1.5} />
          <p>
            <span className="font-semibold">Keep {done[0].title} at the desk</span> for {done[0].hold_for}, who reserved
            it. They've been told it's ready.
          </p>
        </Alert>
      )}
      {done.length > 0 && (
        <section aria-labelledby="desk-returned" className="flex flex-col gap-2">
          <h2 id="desk-returned" className="font-semibold">
            Returned this session
          </h2>
          <Table
            head={
              <>
                <th className={th}>Book</th>
                <th className={th}>Barcode</th>
                <th className={th}>Borrower</th>
                <th className={th}>Late</th>
                <th className={th}>Next</th>
              </>
            }
          >
            {done.map((r) => (
              <tr key={r.barcode + r.at.getTime()}>
                <td className={cn(td, 'font-medium')}>{r.title}</td>
                <td className={cn(td, 'font-mono')}>{r.barcode}</td>
                <td className={td}>{r.borrower}</td>
                <td className={cn(td, r.days_late > 0 && 'font-medium text-destructive')}>
                  {r.days_late > 0 ? `${r.days_late} ${r.days_late === 1 ? 'day' : 'days'}` : 'On time'}
                </td>
                <td className={td}>
                  {r.hold_for ? (
                    <Badge variant="info">Keep for {r.hold_for}</Badge>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <CircleCheck className="size-4 text-success" strokeWidth={1.5} aria-hidden />
                      Back to the shelf
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </section>
      )}
    </>
  )
}

// design/LibraryDesk
export default function Desk() {
  const { data: today } = useDeskToday()
  const [mode, setMode] = useState<'issue' | 'return'>('issue')
  const now = new Date()
  return (
    <>
      <StaffTopBar
        left={`${formatLongDate(now)} · ${today?.closes ? `desk open until ${today.closes}` : 'desk closed today'}`}
        right={
          today && (
            <span>
              Issued today <span className="font-mono text-foreground">{today.issued_today}</span> · Returned today{' '}
              <span className="font-mono text-foreground">{today.returned_today}</span>
            </span>
          )
        }
      />
      <main className="flex flex-col gap-6 px-8 py-6">
        <div className="flex items-end justify-between">
          <h1 className={staffH1}>Issue and return</h1>
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList variant="segmented" className="w-60">
              <TabsTrigger value="issue">Issue</TabsTrigger>
              <TabsTrigger value="return">Return</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {mode === 'issue' ? <IssueMode /> : <ReturnMode />}
      </main>
    </>
  )
}
