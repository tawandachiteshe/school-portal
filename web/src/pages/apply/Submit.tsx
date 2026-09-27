import { useQueryClient } from '@tanstack/react-query'
import { Check, CircleAlert, CircleCheck, Info, Loader2, Smartphone } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ApplyShell } from '@/components/shell/apply-shell'
import type { MyApplication, PayMethod, SubmitState } from '@/api/generated/model'
import { getMyApplicationQueryKey, useMyApplication } from '@/api/generated/apply/apply'
import {
  cancelPayment,
  declare,
  getApplicationCopyUrl,
  getSubmitStateQueryKey,
  startPayment,
  uploadProof,
  useSubmitState,
} from '@/api/generated/apply-submit/apply-submit'
import { ApiError } from '@/lib/api'
import { useSignOut } from '@/lib/auth'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { applyHome, dayTimeText, STEP_PATH } from './common'

const LABEL: Record<PayMethod, string> = { ecocash: 'EcoCash', onemoney: 'OneMoney', bank: 'Bank transfer', cash: 'Cash at the Accounts Office' }
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)
const h1Class = (desktop: boolean) =>
  desktop ? 'text-[28px] leading-9 font-semibold tracking-[-0.015em]' : 'text-2xl leading-8 font-semibold tracking-[-0.01em]'

function useSubmit() {
  const qc = useQueryClient()
  const q = useSubmitState({
    query: { refetchInterval: (x) => (x.state.data?.payment?.status === 'awaiting_approval' ? 2000 : false) },
  })
  const put = (s: SubmitState) => {
    qc.setQueryData(getSubmitStateQueryKey(), s)
    void qc.invalidateQueries({ queryKey: getMyApplicationQueryKey() })
  }
  return { ...q, put }
}

function Frame({ app, step, children }: { app: MyApplication; step?: number; children: React.ReactNode }) {
  const desktop = useIsDesktop()
  return (
    <ApplyShell step={step} app={app}>
      <main className={cn('flex grow flex-col', desktop ? 'max-w-[880px] gap-7 px-20 py-10' : 'gap-6 px-4 py-6')}>{children}</main>
    </ApplyShell>
  )
}

// --- design/Submit, SubmitError, SubmitDesktop -----------------------------------------------------

export function Submit() {
  const desktop = useIsDesktop()
  const navigate = useNavigate()
  const { data: app, isPending } = useMyApplication()
  const { data: s, put } = useSubmit()
  const [agree, setAgree] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const errRef = useRef<HTMLDivElement>(null)
  const boxId = useId()
  if (isPending) return <div className="min-h-dvh bg-background" aria-busy="true" />
  if (!app || app.status !== 'draft') return <Navigate to={applyHome(app)} replace />
  if (!s) return <Frame app={app} step={6}><Skeleton className="h-80" /></Frame>
  if (!s.ready) return <Navigate to={STEP_PATH.review} replace />
  const checked = agree ?? s.declared

  async function go() {
    setError(null)
    if (!checked) {
      setError('Tick the box to confirm your details are true')
      requestAnimationFrame(() => errRef.current?.focus())
      return
    }
    setBusy(true)
    try {
      put(await declare({ agree: true }))
      navigate('/apply/pay')
    } catch (e) {
      setError(errText(e, "Couldn't save. Try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame app={app} step={6}>
      {error && (
        <div ref={errRef} tabIndex={-1} role="alert" className="flex flex-col gap-1 rounded-md border-2 border-destructive bg-card p-4">
          <h2 className="font-semibold">There's a problem</h2>
          <a href={`#${boxId}`} className="font-medium text-destructive underline underline-offset-2">
            {error}
          </a>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h1 className={h1Class(desktop)}>Submit your application</h1>
        <p className="text-muted-foreground">After you submit, you can't change your answers. Admissions can reopen it if something needs fixing.</p>
      </div>
      <dl className="border-y [&>div+div]:border-t">
        {s.summary.map((r) => (
          <div
            key={r.label}
            className={desktop ? 'grid grid-cols-[180px_minmax(0,1fr)_auto] items-center py-2' : 'flex items-center justify-between gap-3 py-3'}
          >
            {desktop ? (
              <>
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className={cn(r.mono && 'font-mono')}>{r.value}</dd>
              </>
            ) : (
              <div>
                <dt className="text-sm text-muted-foreground">{r.label}</dt>
                <dd className={cn(r.mono && 'font-mono')}>{r.value}</dd>
              </div>
            )}
            <Link to={STEP_PATH.review} aria-label={`Change ${r.label}`} className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
              Change
            </Link>
          </div>
        ))}
      </dl>
      <fieldset className={cn('flex flex-col gap-3', error && !checked && 'border-l-4 border-destructive pl-3.5')}>
        <legend className="mb-3 text-lg leading-6 font-semibold">Declaration</legend>
        {error && !checked && <span className="font-medium text-destructive">Tick the box to confirm your details are true</span>}
        <label htmlFor={boxId} className="grid max-w-[720px] cursor-pointer grid-cols-[28px_minmax(0,1fr)] items-start gap-3">
          <input id={boxId} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => setAgree(e.target.checked)} />
          <span
            aria-hidden
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-sm border-2 bg-card text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
              checked ? 'border-primary bg-primary' : error ? 'border-destructive' : 'border-input',
            )}
          >
            {checked && <Check className="size-4" strokeWidth={2.5} />}
          </span>
          <span>
            I confirm that the information and documents in this application are true and are mine. I understand TCFL may
            check my results with ZIMSEC and cancel an offer if anything is false.
          </span>
        </label>
      </fieldset>
      <div className={cn('flex gap-2', desktop ? 'items-center gap-6' : 'mt-auto flex-col')}>
        <Button block={!desktop} disabled={busy} onClick={() => void go()}>
          Continue to payment · US$ {s.fee}
        </Button>
        <span className={cn('text-sm text-muted-foreground', !desktop && 'text-center')}>
          Your application is sent when the fee is paid.
        </span>
      </div>
    </Frame>
  )
}

// --- design/Payment, PayWaiting, PayFailed, PayOffice ---------------------------------------------

function useCountdown(until?: string | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = until ? Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000)) : 0
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

function Waiting({ s, onResend, onOther }: { s: SubmitState; onResend: () => void; onOther: () => void }) {
  const p = s.payment!
  const left = useCountdown(p.expires_at)
  return (
    <>
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        <Smartphone className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        <h1 className="text-2xl leading-8 font-semibold">Approve the payment on your phone</h1>
        <p>
          {LABEL[p.method]} has sent a prompt to <span className="font-mono font-semibold whitespace-nowrap">{p.phone_masked}</span>.
          Enter your PIN there to pay <span className="font-semibold">US$ {p.amount}</span> to TelOne Centre for Learning.
        </p>
      </div>
      <dl className="border-y text-sm [&>div+div]:border-t">
        {[
          ['Amount', `US$ ${p.amount}`],
          ['Reference', s.reference],
          ['Prompt expires in', left],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between py-2.5">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={cn('font-mono', k === 'Prompt expires in' && 'font-medium')}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.5} aria-hidden />
        Keep this page open. It moves on by itself when the payment goes through.
      </p>
      <div className="flex flex-col items-start gap-2 border-t pt-4">
        <h2 className="font-semibold">No prompt?</h2>
        <p className="text-sm text-muted-foreground">Check your phone is on and has signal, then send it again.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onResend}>
            Send the prompt again
          </Button>
          <Button variant="ghost" onClick={onOther}>
            Pay another way
          </Button>
        </div>
      </div>
    </>
  )
}

function Failed({ s, onRetry, onOther }: { s: SubmitState; onRetry: () => void; onOther: () => void }) {
  const signOut = useSignOut()
  const p = s.payment!
  return (
    <>
      <div role="alert" className="flex flex-col gap-3">
        <CircleAlert className="size-6 text-destructive" strokeWidth={1.5} aria-hidden />
        <h1 className="text-2xl leading-8 font-semibold">Payment didn't go through</h1>
        <p>
          {LABEL[p.method]} said {p.failure ?? 'the payment was declined'} for <span className="font-mono font-semibold">US$ {p.amount}</span>.
          No money was taken.
        </p>
      </div>
      <Alert variant="info">
        <Info strokeWidth={1.5} />
        <p className="text-sm">Your application is saved, but it hasn't been sent to Admissions yet. It will be sent when the fee is paid.</p>
      </Alert>
      <div className="mt-auto flex flex-col gap-3">
        <Button block onClick={onRetry}>
          Try {LABEL[p.method]} again
        </Button>
        <Button block variant="outline" onClick={onOther}>
          Pay another way
        </Button>
        <button type="button" onClick={() => void signOut()} className="min-h-11 font-medium text-primary hover:underline">
          Save and pay later
        </button>
      </div>
    </>
  )
}

function CopyRef({ reference }: { reference: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border-2 border-primary bg-card px-4 py-3">
      <div>
        <div className="text-sm text-muted-foreground">Use this exact reference</div>
        <div className="font-mono text-xl font-semibold">{reference}</div>
      </div>
      <Button
        variant="outline"
        className="h-11"
        onClick={() =>
          navigator.clipboard
            .writeText(reference)
            .then(() => toast('Reference copied.'))
            .catch(() => toast('Copy it by hand.'))
        }
      >
        Copy
      </Button>
    </div>
  )
}

// Bank transfer or cash: details, then "I've paid" for Accounts to confirm.
function Office({ s, method, app, onPaid, onBack }: { s: SubmitState; method: 'bank' | 'cash'; app: MyApplication; onPaid: () => void; onBack: () => void }) {
  const bank = s.bank
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl leading-8 font-semibold">{method === 'bank' ? 'Pay by bank transfer' : 'Pay at the Accounts Office'}</h1>
        <p className="text-muted-foreground">
          Your application is saved. It goes to Admissions once Accounts confirm the payment
          {method === 'bank' ? `, usually within ${s.confirm_days} working days` : ''}.
        </p>
      </div>
      <section aria-labelledby="h-to">
        <h2 id="h-to" className="border-b pb-2 text-lg font-semibold">
          {method === 'bank' ? 'Transfer to' : 'Where to pay'}
        </h2>
        <dl className="[&>div+div]:border-t">
          {(method === 'bank' && bank
            ? [
                ['Account name', bank.account_name],
                ['Bank', bank.bank],
                ...(bank.branch ? [['Branch', bank.branch]] : []),
                ['Account number', bank.account_number, 'mono'],
                ['Amount', `US$ ${s.fee}`, 'mono'],
              ]
            : [
                ['Accounts Office', s.accounts_office],
                ['Amount', `US$ ${s.fee}`, 'mono'],
              ]
          ).map(([k, v, mono]) => (
            <div key={k} className="flex justify-between gap-3 py-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className={cn(mono && 'font-mono', k === 'Amount' && 'font-semibold')}>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-2">
          <CopyRef reference={s.reference} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {method === 'bank'
            ? "Without the reference, Accounts can't match your payment to your application."
            : 'Give the reference when you pay, and keep the receipt.'}
        </p>
      </section>
      <div className="mt-auto flex flex-col gap-2">
        <Button block onClick={onPaid}>
          {method === 'bank' ? "I've paid" : "I'll pay at the office"}
        </Button>
        {app.phone_masked && (
          <p className="text-center text-sm text-muted-foreground">
            We'll text <span className="font-mono">{app.phone_masked}</span> when Accounts confirm it.
          </p>
        )}
        <Button variant="ghost" block onClick={onBack}>
          Pay another way
        </Button>
      </div>
    </>
  )
}

function Confirming({ s, onProof, onOther }: { s: SubmitState; onProof: (f: File) => void; onOther: () => void }) {
  const p = s.payment!
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <div role="status" className="flex flex-col gap-3">
        <CircleCheck className="size-6 text-success" strokeWidth={1.5} aria-hidden />
        <h1 className="text-2xl leading-8 font-semibold">Waiting for Accounts to confirm your payment</h1>
        <p className="text-muted-foreground">
          {p.method === 'bank'
            ? `Your application goes to Admissions as soon as they find the transfer, usually within ${s.confirm_days} working days.`
            : 'Pay at the Accounts Office with your reference. Your application goes to Admissions as soon as they record it.'}
        </p>
      </div>
      <CopyRef reference={s.reference} />
      {p.method === 'bank' && (
        <section className="flex flex-col items-start gap-2">
          <h2 className="text-lg font-semibold">
            Proof of payment <span className="text-sm font-medium text-muted-foreground">(speeds things up)</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            {p.has_proof ? 'Received. Thank you.' : 'A screenshot or photo of the bank confirmation.'}
          </p>
          <input
            ref={input}
            type="file"
            accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) onProof(f)
            }}
          />
          <Button variant="outline" onClick={() => input.current?.click()}>
            {p.has_proof ? 'Replace proof of payment' : 'Upload proof of payment'}
          </Button>
        </section>
      )}
      <Button variant="ghost" className="mt-auto self-start px-1" onClick={onOther}>
        Pay another way instead
      </Button>
    </>
  )
}

export function Pay() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: app, isPending } = useMyApplication()
  const { data: s, put } = useSubmit()
  const [method, setMethod] = useState<PayMethod | null>(null)
  const [chosen, setChosen] = useState<'bank' | 'cash' | null>(null)
  const [phone, setPhone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const paid = s?.payment?.status === 'paid'
  // Paid: the application is now submitted. Fetch it before moving on, or the next page sees a draft.
  useEffect(() => {
    if (paid)
      void qc
        .refetchQueries({ queryKey: getMyApplicationQueryKey() })
        .then(() => navigate('/apply/submitted', { replace: true }))
  }, [paid, navigate, qc])
  if (isPending) return <div className="min-h-dvh bg-background" aria-busy="true" />
  if (!app || (app.status !== 'draft' && !paid)) return <Navigate to={applyHome(app)} replace />
  if (!s) return <Frame app={app} step={6}><Skeleton className="h-80" /></Frame>
  if (!s.declared) return <Navigate to={STEP_PATH.submit} replace />

  const run = async (f: () => Promise<SubmitState>) => {
    setBusy(true)
    setError(null)
    try {
      put(await f())
    } catch (e) {
      setError(errText(e, "Couldn't start the payment. Try again."))
    } finally {
      setBusy(false)
    }
  }
  const other = () =>
    void run(async () => {
      setChosen(null)
      return cancelPayment()
    })
  const p = s.payment
  const pick = method ?? s.methods.find((m) => m.available)?.method ?? 'cash'
  const number = phone ?? s.phone ?? ''

  if (p?.status === 'awaiting_approval')
    return (
      <Frame app={app} step={6}>
        <Waiting s={s} onOther={other} onResend={() => void run(() => startPayment({ method: p.method, phone: number }))} />
      </Frame>
    )
  if (p && (p.status === 'failed' || p.status === 'expired') && (p.method === 'ecocash' || p.method === 'onemoney') && !method)
    return (
      <Frame app={app} step={6}>
        <Failed s={s} onRetry={() => void run(() => startPayment({ method: p.method, phone: number }))} onOther={() => setMethod(p.method)} />
      </Frame>
    )
  if (p?.status === 'awaiting_confirmation')
    return (
      <Frame app={app} step={6}>
        <Confirming s={s} onOther={other} onProof={(f) => void run(() => uploadProof({ file: f }))} />
      </Frame>
    )
  if (chosen)
    return (
      <Frame app={app} step={6}>
        <Office s={s} method={chosen} app={app} onBack={() => setChosen(null)} onPaid={() => void run(() => startPayment({ method: chosen }))} />
      </Frame>
    )

  const mobile = pick === 'ecocash' || pick === 'onemoney'
  return (
    <Frame app={app} step={6}>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl leading-8 font-semibold">Pay the application fee</h1>
        <div className="flex items-baseline justify-between border-y py-3">
          <span>Application fee</span>
          <span className="font-mono text-xl font-semibold">US$ {s.fee}</span>
        </div>
        <p className="text-sm text-muted-foreground">Not refundable. Your application is sent to Admissions as soon as the payment goes through.</p>
      </div>
      {error && (
        <p role="alert" className="font-medium text-destructive">
          {error}
        </p>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-3 text-lg leading-6 font-semibold">How do you want to pay?</legend>
        <div role="radiogroup" aria-label="How do you want to pay?" className="flex flex-col gap-2">
          {s.methods.map((m) => {
            const on = pick === m.method
            return (
              <div
                key={m.method}
                className={cn('flex flex-col gap-3 rounded-md border bg-card p-4', on && 'border-primary bg-primary-soft', !m.available && 'opacity-60')}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!m.available}
                  onClick={() => setMethod(m.method)}
                  className="grid grid-cols-[20px_minmax(0,1fr)] gap-3 text-left disabled:cursor-not-allowed"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 inline-flex size-5 items-center justify-center rounded-full border-[1.5px] border-input bg-card',
                      on && 'border-primary after:size-2.5 after:rounded-full after:bg-primary',
                    )}
                  />
                  <span>
                    <span className={cn('block', on ? 'font-semibold' : 'font-medium')}>{LABEL[m.method]}</span>
                    <span className="text-sm text-muted-foreground">{m.available ? m.note : 'Not available yet'}</span>
                  </span>
                </button>
                {on && (m.method === 'ecocash' || m.method === 'onemoney') && (
                  <label className="flex flex-col gap-1.5 pl-8 text-sm font-medium">
                    {LABEL[m.method]} number
                    <Input className="font-mono" inputMode="tel" autoComplete="tel" value={number} onChange={(e) => setPhone(e.target.value)} />
                  </label>
                )}
              </div>
            )
          })}
        </div>
      </fieldset>
      <div className="mt-auto flex flex-col gap-2">
        <Button
          block
          disabled={busy}
          onClick={() => (mobile ? void run(() => startPayment({ method: pick, phone: number })) : setChosen(pick as 'bank' | 'cash'))}
        >
          {mobile ? `Pay US$ ${s.fee} with ${LABEL[pick]}` : 'Continue'}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          {s.provider ? `Mobile payments are processed by ${s.provider}. ` : ''}TCFL never asks for your PIN.
        </p>
      </div>
    </Frame>
  )
}

// --- design/Submitted -------------------------------------------------------------------------------

export function Submitted() {
  const desktop = useIsDesktop()
  const { data: app, isPending } = useMyApplication()
  if (isPending) return <div className="min-h-dvh bg-background" aria-busy="true" />
  if (!app || app.status === 'draft') return <Navigate to={applyHome(app)} replace />
  return (
    <ApplyShell app={app}>
      <main className={cn('flex grow flex-col gap-6', desktop ? 'mx-auto w-full max-w-[560px] px-4 py-10' : 'px-4 pt-8 pb-6')}>
        <div role="status" className="flex flex-col gap-3">
          <CircleCheck className="size-7 text-success" strokeWidth={1.5} aria-hidden />
          <h1 className={h1Class(desktop)}>Application submitted</h1>
          <p className="text-muted-foreground">
            {app.programme}
            {app.submitted_at && ` · ${dayTimeText(new Date(app.submitted_at))}`}
          </p>
        </div>
        <div className="flex flex-col gap-1 border-y py-5">
          <span className="text-sm font-medium">Your reference</span>
          <span className="font-mono text-[28px] leading-9 font-semibold tracking-[0.04em]">{app.reference}</span>
          <span className="text-sm text-muted-foreground">
            {app.phone_masked ? (
              <>
                Sent by SMS to <span className="font-mono">{app.phone_masked}</span>.{' '}
              </>
            ) : null}
            Quote it if you contact Admissions.
          </span>
        </div>
        {app.fee && (
          <div className="-mt-2 flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Fee paid</span>
            <span>
              <span className="font-mono">US$ {app.fee.amount}</span> · {app.fee.method}
              {app.fee.receipt && (
                <>
                  {' '}
                  · receipt <span className="font-mono">{app.fee.receipt}</span>
                </>
              )}
            </span>
          </div>
        )}
        <section aria-labelledby="h-next" className="flex flex-col gap-2">
          <h2 id="h-next" className="text-lg leading-6 font-semibold">
            What happens next
          </h2>
          <p>An admissions officer checks your ID and results. We'll text you when there's a decision, or if we need anything else.</p>
        </section>
        <div className="mt-auto flex flex-col gap-3">
          <Button block asChild>
            <Link to="/apply/status">Track your application</Link>
          </Button>
          <Button block variant="outline" asChild>
            <a href={`/api${getApplicationCopyUrl()}`} download>
              Download a copy (PDF)
            </a>
          </Button>
        </div>
      </main>
    </ApplyShell>
  )
}
