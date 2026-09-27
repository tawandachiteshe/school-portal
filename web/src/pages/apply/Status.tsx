import { useQueryClient } from '@tanstack/react-query'
import { Check, Info } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate } from 'react-router'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ApplyShell } from '@/components/shell/apply-shell'
import type { MyApplication } from '@/api/generated/model'
import { getMyApplicationQueryKey, useMyApplication, useWithdraw } from '@/api/generated/apply/apply'
import { ApiError } from '@/lib/api'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { applyHome, dateOnly, dayText, dayTimeText } from './common'

type State = 'done' | 'current' | 'todo'
type Item = { title: string; state: State; meta?: string; body?: React.ReactNode; now?: boolean }

function timeline(a: MyApplication): Item[] {
  const submitted: Item = {
    title: 'Submitted',
    state: 'done',
    meta: a.submitted_at ? dayTimeText(new Date(a.submitted_at)) : undefined,
    body: a.phone_masked && (
      <>
        A copy was sent to <span className="font-mono">{a.phone_masked}</span>.
      </>
    ),
  }
  const decided = a.status === 'accepted' || a.status === 'rejected'
  const review: Item =
    a.status === 'more_info'
      ? {
          title: 'We need more information',
          state: 'current',
          now: true,
          meta: a.requests.length ? `Since ${dayText(new Date(a.requests[a.requests.length - 1].at))}` : undefined,
          body: 'Admissions sent you a message. Your application waits until you reply.',
        }
      : {
          title: 'In review',
          state: decided ? 'done' : a.review_started_at ? 'current' : 'todo',
          now: !decided && !!a.review_started_at,
          meta: a.review_started_at ? `Since ${dayText(new Date(a.review_started_at))}` : 'Waiting for an admissions officer',
          body: !decided && 'An admissions officer is checking your ID and your results against ZIMSEC records.',
        }
  const decision: Item = decided
    ? {
        title: a.status === 'accepted' ? 'Offered a place' : 'Not successful',
        state: 'done',
        meta: a.decided_at ? dayText(new Date(a.decided_at)) : undefined,
        body:
          a.status === 'accepted' ? (
            <Link to="/apply/offer" className="font-medium text-primary underline underline-offset-2">
              See your offer
            </Link>
          ) : (
            a.decision_reason
          ),
      }
    : {
        title: 'Decision',
        state: 'todo',
        meta: a.decision_expected_by ? `Expected by ${dayText(dateOnly(a.decision_expected_by))}` : undefined,
      }
  return [submitted, review, decision]
}

function Timeline({ items, desktop }: { items: Item[]; desktop: boolean }) {
  return (
    <ol>
      {items.map((it, i) => {
        const last = i === items.length - 1
        return (
          <li
            key={it.title}
            aria-current={it.state === 'current' ? 'step' : undefined}
            className={cn('grid grid-cols-[24px_minmax(0,1fr)]', desktop ? 'gap-x-4' : 'gap-x-3')}
          >
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full',
                  !desktop && 'mt-3',
                  it.state === 'done' && 'bg-primary text-primary-foreground',
                  it.state === 'current' && 'border-2 border-primary bg-card',
                  it.state === 'todo' && 'border-[1.5px] border-input bg-card',
                )}
              >
                {it.state === 'done' && <Check className="size-3.5" strokeWidth={2} aria-hidden />}
                {it.state === 'current' && <span className="size-2 rounded-full bg-primary" />}
              </span>
              {!last && (
                <span className={cn('w-0.5 grow', it.state === 'done' ? 'bg-primary' : 'bg-border')} />
              )}
            </div>
            <div className={cn('flex flex-col gap-0.5', desktop ? (last ? '' : 'pb-6') : last ? 'py-3' : 'pt-3 pb-5')}>
              <span className="flex items-center gap-2">
                <span className={it.state === 'todo' ? 'font-medium' : 'font-semibold'}>{it.title}</span>
                {it.now && <Badge variant="info">Now</Badge>}
              </span>
              {it.meta && <span className="text-sm text-muted-foreground">{it.meta}</span>}
              {it.body && <span className="text-sm">{it.body}</span>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

const NEXT = [
  "If anything is missing, we'll send an SMS and list it on this page. You won't need to start again.",
  "If you're offered a place, you'll get an offer letter, your first fees invoice and a date to register.",
  'Bring your original National ID and ZIMSEC certificate to registration.',
]

// design/Status, StatusDesktop
export default function Status() {
  const desktop = useIsDesktop()
  const qc = useQueryClient()
  const { data: a, isPending } = useMyApplication()
  const [confirm, setConfirm] = useState(false)
  const withdraw = useWithdraw({
    mutation: {
      onSuccess: () => {
        setConfirm(false)
        void qc.invalidateQueries({ queryKey: getMyApplicationQueryKey() })
        toast('Application withdrawn.')
      },
      onError: (e) => toast(e instanceof ApiError ? e.message : "Couldn't withdraw. Try again."),
    },
  })
  if (isPending) return <Skeleton className="m-4 h-96" />
  if (!a || a.status === 'draft') return <Navigate to={applyHome(a)} replace />
  const open = ['submitted', 'in_review', 'more_info'].includes(a.status)

  const heading = (
    <div className="flex flex-col gap-1">
      <h1 className={desktop ? 'text-[28px] leading-9 font-semibold tracking-[-0.015em]' : 'text-2xl leading-8 font-semibold tracking-[-0.01em]'}>
        Your application
      </h1>
      <p>
        {a.programme} · {a.intake}
      </p>
      <p className="text-sm text-muted-foreground">
        Reference <span className="font-mono text-foreground">{a.reference}</span>
      </p>
    </div>
  )
  const requests = a.status === 'more_info' && a.requests.length > 0 && (
    <Alert variant="info">
      <Info strokeWidth={1.5} />
      <div className="flex flex-col gap-1">
        <p className="font-semibold">Message from Admissions, {dayText(new Date(a.requests[a.requests.length - 1].at))}</p>
        <p>{a.requests[a.requests.length - 1].message}</p>
      </div>
    </Alert>
  )
  const actions = (
    <div className={cn('flex border-t pt-4', desktop ? 'items-center gap-6' : 'mt-auto flex-col items-start gap-1')}>
      <Link to="/apply/review" className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
        View what you submitted
      </Link>
      {open && (
        <Button variant="ghost" className="px-0 text-destructive hover:bg-transparent" onClick={() => setConfirm(true)}>
          Withdraw application
        </Button>
      )}
    </div>
  )

  return (
    <ApplyShell app={a}>
      {desktop ? (
        <main className="grid grid-cols-[minmax(0,560px)_360px] items-start gap-20 px-20 py-10">
          <div className="flex flex-col gap-7">
            {heading}
            {requests}
            <Timeline items={timeline(a)} desktop />
            {actions}
          </div>
          <aside className="flex flex-col gap-3 pt-2">
            <h2 className="text-lg leading-6 font-semibold">What happens next</h2>
            <ul className="border-t [&>li+li]:border-t">
              {NEXT.map((t) => (
                <li key={t} className="py-3">
                  {t}
                </li>
              ))}
            </ul>
          </aside>
        </main>
      ) : (
        <main className="flex grow flex-col gap-8 px-4 py-6">
          {heading}
          {requests}
          <section aria-labelledby="h-prog">
            <h2 id="h-prog" className="mb-2 text-lg leading-6 font-semibold">
              Progress
            </h2>
            <Timeline items={timeline(a)} desktop={false} />
          </section>
          <section aria-labelledby="h-next" className="flex flex-col gap-2">
            <h2 id="h-next" className="text-lg leading-6 font-semibold">
              What happens next
            </h2>
            <ul className="flex flex-col gap-3">
              {NEXT.map((t) => (
                <li key={t} className="grid grid-cols-[12px_minmax(0,1fr)] gap-x-2">
                  <span aria-hidden className="mt-2.5 size-1 rounded-full bg-foreground" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </section>
          {actions}
        </main>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-[440px]">
          <DialogTitle>Withdraw your application?</DialogTitle>
          <DialogDescription>
            Admissions stops reviewing it. To study at TCFL later, you'd need to apply again.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Keep my application
            </Button>
            <Button variant="destructive" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
              Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ApplyShell>
  )
}
