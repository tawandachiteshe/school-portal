import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { Register as RegisterData } from '@/api/generated/model'
import {
  getOpenRegisterQueryKey,
  getOverviewQueryKey,
  markAttendance,
  useFinishRegister,
  useMarkRestPresent,
  useOpenRegister,
} from '@/api/generated/teaching/teaching'
import { ApiError } from '@/lib/api'
import { formatLongDate, time } from '@/lib/format'
import { cn } from '@/lib/utils'

type Status = 'present' | 'late' | 'absent'

const OPTIONS: { value: Status; label: string; on: string }[] = [
  { value: 'present', label: 'Present', on: 'border-success bg-success-soft font-semibold text-success' },
  { value: 'late', label: 'Late', on: 'border-urgent-line bg-urgent-soft font-semibold text-urgent' },
  { value: 'absent', label: 'Absent', on: 'border-destructive bg-destructive-soft font-semibold text-destructive' },
]

// design/Register: a phone screen, taken in class. Each tap saves.
function RegisterView({ reg, slotId, date }: { reg: RegisterData; slotId: string; date: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [marks, setMarks] = useState<Record<string, Status | null>>(() =>
    Object.fromEntries(reg.rows.map((r) => [r.student_id, (r.status as Status | null) ?? null])),
  )
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState(false)
  const key = getOpenRegisterQueryKey(slotId, date)

  async function mark(studentId: string, status: Status) {
    const before = marks[studentId]
    setMarks((m) => ({ ...m, [studentId]: status }))
    setPending((n) => n + 1)
    try {
      await markAttendance(reg.session_id, studentId, { status })
      setFailed(false)
    } catch {
      setMarks((m) => ({ ...m, [studentId]: before }))
      setFailed(true)
      toast("Couldn't save. Check your signal and tap again.")
    } finally {
      setPending((n) => n - 1)
    }
  }

  const rest = useMarkRestPresent({
    mutation: {
      onSuccess: () => {
        setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v ?? 'present'])))
        void qc.invalidateQueries({ queryKey: key })
      },
      onError: () => toast("Couldn't save. Check your signal and try again."),
    },
  })
  const finish = useFinishRegister({
    mutation: {
      onSuccess: (r) => {
        toast(
          r.absent
            ? `Register saved. ${r.absent} absent ${r.absent === 1 ? 'student gets' : 'students get'} a message to see you.`
            : 'Register saved.',
        )
        void qc.invalidateQueries({ queryKey: getOverviewQueryKey() })
        void qc.invalidateQueries({ queryKey: key })
        navigate('/staff/teaching')
      },
      onError: (e) => toast(e instanceof ApiError ? e.message : "Couldn't finish. Try again."),
    },
  })

  const values = Object.values(marks)
  const count = (s: Status) => values.filter((v) => v === s).length
  const unmarked = values.filter((v) => v === null).length
  const start = new Date(reg.starts_at)
  const saved = failed ? 'Not saved' : pending ? 'Saving…' : 'Saved'

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col bg-background">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-1 border-b bg-card pr-4 pl-1">
        <Link to="/staff/teaching" aria-label="Back" className="inline-flex size-11 items-center justify-center rounded-md">
          <ArrowLeft className="size-5" strokeWidth={1.5} />
        </Link>
        <span className="grow font-semibold">Register</span>
        <span role="status" className={cn('text-sm text-muted-foreground', failed && 'text-destructive')}>
          {saved}
        </span>
      </header>
      <main className="flex grow flex-col gap-4 px-4 py-5">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg leading-6 font-semibold">
            <span className="font-mono">{reg.module_code}</span> {reg.title} · <span className="font-mono">{reg.class_group}</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatLongDate(start).replace(/^(\w{3})\w*/, '$1')}, {time(start)}
            {reg.venue && ` · ${reg.venue}`}
          </p>
        </div>
        <div className="flex gap-4 border-y py-2.5 text-sm">
          <span>
            Present <span className="font-mono font-semibold">{count('present')}</span>
          </span>
          <span>
            Late <span className="font-mono font-semibold">{count('late')}</span>
          </span>
          <span>
            Absent <span className="font-mono font-semibold">{count('absent')}</span>
          </span>
          <span className="text-muted-foreground">
            Not marked <span className="font-mono font-semibold text-foreground">{unmarked}</span>
          </span>
        </div>
        {unmarked > 0 && (
          <Button variant="outline" block disabled={rest.isPending} onClick={() => rest.mutate({ sessionId: reg.session_id })}>
            Mark the other {unmarked} present
          </Button>
        )}
        <ul className="[&>li+li]:border-t">
          {reg.rows.map((r) => (
            <li key={r.student_id} className="flex flex-col gap-2 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{r.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{r.student_number}</span>
              </div>
              <div role="radiogroup" aria-label={`Attendance for ${r.name}`} className="grid grid-cols-3 gap-1">
                {OPTIONS.map((o) => {
                  const on = marks[r.student_id] === o.value
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => !on && void mark(r.student_id, o.value)}
                      className={cn(
                        'h-11 rounded-md border bg-card text-sm font-medium text-muted-foreground',
                        on && o.on,
                      )}
                    >
                      {o.label}
                    </button>
                  )
                })}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">Students marked absent get a message asking them to see you.</p>
      </main>
      <div className="sticky bottom-0 border-t bg-card px-4 pt-3 pb-4">
        <Button
          block
          disabled={unmarked > 0 || pending > 0 || finish.isPending}
          onClick={() => finish.mutate({ sessionId: reg.session_id })}
        >
          {reg.finished_at ? 'Save changes' : 'Finish register'}
        </Button>
      </div>
    </div>
  )
}

export default function Register() {
  const { slotId = '', date = '' } = useParams()
  const { data, isPending, error } = useOpenRegister(slotId, date, { query: { staleTime: Infinity } })
  if (isPending)
    return (
      <div className="mx-auto flex max-w-[480px] flex-col gap-3 p-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-64" />
      </div>
    )
  if (error || !data)
    return (
      <p className="mx-auto max-w-[480px] p-4 text-muted-foreground">
        {error instanceof ApiError ? error.message : "Couldn't open the register."}{' '}
        <Link to="/staff/teaching" className="text-primary underline">
          Back to today
        </Link>
      </p>
    )
  return <RegisterView key={data.session_id} reg={data} slotId={slotId} date={date} />
}
