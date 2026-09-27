import { useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ApplyShell } from '@/components/shell/apply-shell'
import { getMyApplicationQueryKey, getOfferLetterUrl, useAnswerOffer, useMyApplication } from '@/api/generated/apply/apply'
import { ApiError } from '@/lib/api'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { applyHome, dateOnly, dayText, longDayText } from './common'

const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Harare' })
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' })
const weekdayDayMonth = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Harare' })

// design/OfferReceived
export default function Offer() {
  const desktop = useIsDesktop()
  const qc = useQueryClient()
  const { data: a, isPending } = useMyApplication()
  const [confirmDecline, setConfirmDecline] = useState(false)
  const answer = useAnswerOffer({
    mutation: {
      onSuccess: (x, v) => {
        qc.setQueryData(getMyApplicationQueryKey(), x)
        setConfirmDecline(false)
        toast(v.data.answer === 'accept' ? "You've accepted your place." : "You've declined the offer.")
      },
      onError: (e) => toast(e instanceof ApiError ? e.message : "Couldn't save. Try again."),
    },
  })
  if (isPending) return <Skeleton className="m-4 h-96" />
  if (!a || a.status !== 'accepted' || !a.offer) return <Navigate to={applyHome(a)} replace />
  const o = a.offer
  const acceptBy = dateOnly(o.accept_by)
  const starts = o.starts_on ? dateOnly(o.starts_on) : null
  const reg = o.registration_at ? new Date(o.registration_at) : null
  const accepted = !!o.accepted_at
  const declined = !!o.declined_at

  const steps = [
    {
      title: 'Accept the offer',
      body: accepted ? `Accepted ${dayText(new Date(o.accepted_at!))}` : `Here, before ${dayMonth.format(acceptBy)}`,
      done: accepted,
    },
    {
      title: 'Pay the first fees instalment',
      body: (
        <>
          The invoice appears after you accept. Use <span className="font-mono text-foreground">{a.reference}</span> as
          the reference.
        </>
      ),
    },
    {
      title: reg ? `Register on ${weekdayDayMonth.format(reg).replace(',', '')}, ${hm.format(reg)}` : 'Register',
      body: `${o.registration_place}. Bring your original National ID and ZIMSEC certificate. You'll get your student number and card.`,
    },
  ]

  return (
    <ApplyShell app={a}>
      <main className={cn('flex grow flex-col gap-6', desktop ? 'mx-auto w-full max-w-[560px] px-4 py-10' : 'px-4 py-6')}>
        <div className="flex flex-col gap-2">
          <h1 className={desktop ? 'text-[28px] leading-9 font-semibold tracking-[-0.015em]' : 'text-2xl leading-8 font-semibold tracking-[-0.01em]'}>
            {declined ? 'You declined this offer' : accepted ? "You've accepted your place" : "You've been offered a place"}
          </h1>
          <p>
            {a.programme}
            {starts && `, starting ${longDayText(starts)}`}.
          </p>
          <p className="text-sm text-muted-foreground">
            Reference <span className="font-mono text-foreground">{a.reference}</span>
            {a.decided_at && ` · decided ${dayText(new Date(a.decided_at))}`}
          </p>
        </div>

        {!declined && (
          <>
            {!accepted && (
              <div className="flex items-center justify-between border-y py-3.5">
                <span>Accept by</span>
                <span className="font-semibold">{longDayText(acceptBy)}</span>
              </div>
            )}
            <section aria-labelledby="h-steps" className="flex flex-col gap-2">
              <h2 id="h-steps" className="text-lg leading-6 font-semibold">
                To take up your place
              </h2>
              <ol className="[&>li+li]:border-t">
                {steps.map((s, i) => (
                  <li key={s.title} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2 py-3">
                    <span className="font-mono text-muted-foreground">
                      {s.done ? <Check className="mt-0.5 size-4 text-success" strokeWidth={2} aria-label="Done" /> : i + 1}
                    </span>
                    <span>
                      <span className="block font-medium">{s.title}</span>
                      <span className="text-sm text-muted-foreground">{s.body}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}

        <div className="mt-auto flex flex-col gap-3">
          {!accepted && !declined && (
            <Button block disabled={answer.isPending} onClick={() => answer.mutate({ data: { answer: 'accept' } })}>
              Accept offer
            </Button>
          )}
          <Button variant="outline" block asChild>
            <a href={`/api${getOfferLetterUrl()}`} download>
              Offer letter (PDF)
            </a>
          </Button>
          {!accepted && !declined && (
            <button
              type="button"
              onClick={() => setConfirmDecline(true)}
              className="inline-flex min-h-11 items-center justify-center font-medium text-destructive hover:underline"
            >
              Decline this offer
            </button>
          )}
          <Link to="/apply/status" className="inline-flex min-h-11 items-center justify-center text-primary hover:underline">
            Application history
          </Link>
        </div>
      </main>

      <Dialog open={confirmDecline} onOpenChange={setConfirmDecline}>
        <DialogContent className="max-w-[440px]">
          <DialogTitle>Decline your place?</DialogTitle>
          <DialogDescription>
            The place goes to someone else. You can't accept it again after declining.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDecline(false)}>
              Keep my offer
            </Button>
            <Button variant="destructive" disabled={answer.isPending} onClick={() => answer.mutate({ data: { answer: 'decline' } })}>
              Decline offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ApplyShell>
  )
}
