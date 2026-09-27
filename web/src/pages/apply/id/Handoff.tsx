import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Info, Link2, TriangleAlert } from 'lucide-react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Wordmark } from '@/components/shell/wordmark'
import type { NationalIdState } from '@/api/generated/model'
import {
  getPhoneStateQueryKey,
  phoneConfirmNationalId,
  phoneUploadNationalId,
  useClaimHandoff,
  useHandoffLanding,
  usePhoneState,
  useReportMismatch,
} from '@/api/generated/apply-id/apply-id'
import { ApiError } from '@/lib/api'
import { PhoneFlow } from './PhoneFlow'

const longDob = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const title = (s?: string | null) => (s ?? '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase())

// A phone joined to a computer: no sign-in, only this application's ID and results (docs/10 §10.10).
function PhoneFrame({ code, linked = true, children }: { code?: string; linked?: boolean; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4">
        <Wordmark />
        {linked && (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Link2 className="size-4" strokeWidth={1.5} aria-hidden />
            {code ? (
              <>
                Linked · <span className="font-mono">{code}</span>
              </>
            ) : (
              'Linked to a computer'
            )}
          </span>
        )}
      </header>
      <main className="flex grow flex-col gap-6 px-4 pt-8 pb-6">{children}</main>
    </div>
  )
}

function h1(text: string) {
  return <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">{text}</h1>
}

// design/PhoneDisconnected
function Disconnected() {
  return (
    <PhoneFrame linked={false}>
      <div role="alert" className="flex flex-col gap-3">
        <CircleAlert className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        {h1('Your computer ended this session')}
        <p>Continue on your computer. Anything you added on this phone has been saved to your application.</p>
      </div>
      <Alert variant="info">
        <Info strokeWidth={1.5} />
        <p className="text-sm">
          This link no longer works. To use your phone again, choose “Continue on your phone” on the computer and scan the
          new code.
        </p>
      </Alert>
    </PhoneFrame>
  )
}

// design/PhoneLanding: check the match code before anything is added.
export function HandoffLanding() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const { data, isPending, error } = useHandoffLanding(code, { query: { retry: false } })
  const claim = useClaimHandoff({
    mutation: {
      onSuccess: () => navigate(`/h/${code}/id`, { replace: true }),
      onError: (e) => toast(e instanceof ApiError ? e.message : "Couldn't connect. Try again."),
    },
  })
  const mismatch = useReportMismatch({ mutation: { onSuccess: () => navigate(`/h/${code}/mismatch`, { replace: true }) } })

  if (isPending) return <Skeleton className="m-4 h-80" />
  if (error || !data)
    return (
      <PhoneFrame linked={false}>
        {h1("This link doesn't work")}
        <p>{error instanceof ApiError ? error.message : 'Check the link, or create a new one on your computer.'}</p>
      </PhoneFrame>
    )
  if (data.state === 'yours') return <Navigate to={`/h/${code}/id`} replace />
  if (data.state === 'expired')
    return (
      <PhoneFrame linked={false}>
        {h1('This link has expired')}
        <p>Links last 15 minutes. On your computer, choose Create a new link, then scan the new code.</p>
      </PhoneFrame>
    )
  if (data.state === 'closed') return <Disconnected />
  return (
    <PhoneFrame>
      <div className="flex flex-col gap-2">
        {h1(`Continuing ${data.first_name}'s application`)}
        <p className="text-muted-foreground">
          {data.programme} · {data.step}
        </p>
      </div>
      <div className="flex flex-col gap-2 border-y py-5">
        <span className="text-sm font-medium">Match code</span>
        <span className="font-mono text-5xl leading-[56px] font-semibold tracking-[0.12em]">{data.match_code}</span>
        <p className="text-sm text-muted-foreground">The computer screen should show the same four characters.</p>
      </div>
      <Alert variant="urgent">
        <TriangleAlert strokeWidth={1.5} />
        <p>Only use this if you started the application yourself. If someone sent you this link, close this page.</p>
      </Alert>
      <div className="mt-auto flex flex-col gap-3">
        <Button block disabled={claim.isPending} onClick={() => claim.mutate({ code })}>
          The codes match, continue
        </Button>
        <Button block variant="outline" disabled={mismatch.isPending} onClick={() => mismatch.mutate({ code })}>
          The codes don't match
        </Button>
      </div>
    </PhoneFrame>
  )
}

// design/CodesMismatch
export function HandoffMismatch() {
  const { data } = useHandoffLanding(useParams().code ?? '', { query: { retry: false } })
  return (
    <PhoneFrame linked={false}>
      <div role="alert" className="flex flex-col gap-3">
        <TriangleAlert className="size-6 text-destructive" strokeWidth={1.5} aria-hidden />
        {h1("Don't continue on this phone")}
        <p>
          If the code on your computer isn't <span className="font-mono font-semibold">{data?.match_code}</span>, this link
          may belong to someone else's application. We've closed it, so nothing can be added through it.
        </p>
      </div>
      <section aria-labelledby="h-do" className="flex flex-col gap-3">
        <h2 id="h-do" className="text-lg font-semibold">
          What to do
        </h2>
        <ol className="flex flex-col gap-3">
          {[
            <>
              On your computer, choose <span className="font-semibold">Create a new link</span>.
            </>,
            "Scan the new code with your phone camera. Don't use a link someone sent you.",
            'Check both screens show the same four characters.',
          ].map((t, i) => (
            <li key={i} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2">
              <span className="font-mono text-muted-foreground">{i + 1}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      </section>
      <p className="mt-auto text-sm text-muted-foreground">
        Someone sent you this link and you didn't start an application? Tell Admissions so they can check. We've let them
        know the link was closed.
      </p>
    </PhoneFrame>
  )
}

function Done({ code, id, onMore }: { code: string; id: NationalIdState; onMore: () => void }) {
  const f = id.fields
  return (
    <PhoneFrame code={code}>
      <div className="-mt-4 flex flex-col gap-2">
        <div className="flex justify-between text-sm">
          <span className="font-medium">Step 2 of 5 · National ID</span>
          <span className="text-muted-foreground">Next: ZIMSEC results</span>
        </div>
        <div className="grid grid-cols-5 gap-1" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={i < 2 ? 'h-1 rounded-full bg-primary' : 'h-1 rounded-full bg-border'} />
          ))}
        </div>
      </div>
      <div role="status" className="flex flex-col gap-3">
        <CircleCheck className="size-6 text-success" strokeWidth={1.5} aria-hidden />
        {h1('National ID added')}
        <p className="text-muted-foreground">You can continue here or go back to your computer. Both show the same application.</p>
      </div>
      <dl className="border-y [&>div+div]:border-t">
        {(
          [
            ['ID number', f.id_number, true],
            ['Name', `${title(f.first_names)} ${title(f.surname)}`, false],
            ['Date of birth', f.date_of_birth ? longDob.format(new Date(`${f.date_of_birth}T12:00:00`)) : '—', false],
          ] as const
        ).map(([k, v, mono]) => (
          <div key={k} className="flex justify-between gap-4 py-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={mono ? 'font-mono' : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto flex flex-col gap-3">
        <Button block onClick={onMore}>
          Continue to ZIMSEC results
        </Button>
        <Button block variant="outline" onClick={() => toast('Carry on on your computer. You can close this page.')}>
          I'll finish on my computer
        </Button>
      </div>
    </PhoneFrame>
  )
}

// /h/:code/id: photograph and check the ID on the linked phone.
export function HandoffId() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data, error, isPending } = usePhoneState({
    query: {
      retry: false,
      refetchInterval: (q) => (q.state.data?.national_id.status === 'reading' ? 1500 : false),
    },
  })
  if (isPending) return <Skeleton className="m-4 h-80" />
  if (error instanceof ApiError && error.status === 410) return <Disconnected />
  if (!data) return <Disconnected />
  const refresh = () => qc.invalidateQueries({ queryKey: getPhoneStateQueryKey() })
  if (data.national_id.status === 'confirmed')
    return <Done code={data.match_code} id={data.national_id} onMore={() => navigate(`/h/${code}/results`)} />
  return (
    <PhoneFlow
      state={data.national_id}
      upload={async (file) => {
        await phoneUploadNationalId({ file })
        await refresh()
      }}
      confirm={async (body) => {
        await phoneConfirmNationalId(body)
        await refresh()
      }}
      onBack={() => navigate(`/h/${code}`)}
      where="on this phone"
      footnote="Saving also updates your computer screen."
      frame={(children) => <PhoneFrame code={data.match_code}>{children}</PhoneFrame>}
    />
  )
}

// /h/:code/results until step 3 is built on the phone.
export function HandoffResultsPending() {
  const { data } = usePhoneState({ query: { retry: false } })
  return (
    <PhoneFrame code={data?.match_code}>
      {h1('ZIMSEC results')}
      <p className="text-muted-foreground">
        Scanning results on the phone isn't available yet. Carry on with your results on your computer.
      </p>
    </PhoneFrame>
  )
}
