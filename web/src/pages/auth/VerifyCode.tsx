import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { answer, type Challenge, fieldError, generalError } from '@/lib/authentik-flow'
import { cn } from '@/lib/utils'
import { AuthHeading } from './AuthLayout'

const RESEND_AFTER = 60

// design/VerifyPhone and VerifyPhoneError: six boxes, one digit each; pasting fills them all.
function CodeBoxes({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '')
  const set = (i: number, d: string) => {
    const next = digits.slice()
    next[i] = d
    onChange(next.join('').slice(0, 6))
  }
  return (
    <div className="grid grid-cols-6 gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          value={d}
          aria-label={`Digit ${i + 1} of 6`}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={6}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '')
            if (v.length > 1) {
              onChange(v.slice(0, 6))
              refs.current[Math.min(5, v.length - 1)]?.focus()
              return
            }
            set(i, v)
            if (v && i < 5) refs.current[i + 1]?.focus()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus()
          }}
          className={cn(
            'h-14 w-full rounded-sm border border-input bg-card text-center font-mono text-2xl',
            invalid && 'border-2 border-destructive',
          )}
        />
      ))}
    </div>
  )
}

// How each check reads: design/VerifyPhone for SMS, the same screen for email.

// How each check reads: design/VerifyPhone for SMS, the same screen for email.
const CHANNEL = {
  sms: {
    stage: 'ak-stage-authenticator-sms',
    field: 'phone_number',
    title: 'Check your phone',
    legend: 'Code from the SMS',
    wrong: "That code isn't right. Check the SMS, or send a new code.",
    waiting: 'No SMS yet?',
    help: 'Texts can take a minute on busy networks. Check the number is right and that your phone has signal.',
    change: 'Change number',
    mono: true,
  },
  email: {
    stage: 'ak-stage-authenticator-email',
    field: 'email',
    title: 'Check your email',
    legend: 'Code from the email',
    wrong: "That code isn't right. Check the email, or send a new code.",
    waiting: 'No email yet?',
    help: 'Emails can take a few minutes. Look in your spam or promotions folder, and check the address is right.',
    change: 'Change email',
    mono: false,
  },
} as const

// design/VerifyPhone and VerifyPhoneError, and the same screen for an emailed code, for any
// Authentik flow that has an SMS or email authenticator stage.
export function Verify({
  flow,
  channel,
  to,
  shown,
  challenge,
  onAnswer,
  onChange,
}: {
  flow: string
  channel: keyof typeof CHANNEL
  to: string
  shown: string
  challenge: Challenge
  onAnswer: (c: Challenge) => void
  onChange: () => void
}) {
  const t = CHANNEL[channel]
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(RESEND_AFTER)
  const [failed, setFailed] = useState(false)
  const errRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const id = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000)
    return () => clearInterval(id)
  }, [])
  const wrong = generalError(challenge) ?? fieldError(challenge, 'code')
  async function verify() {
    setBusy(true)
    try {
      // As text: a code can start with 0 (Authentik compares strings).
      const c = await answer(flow, { component: t.stage, code })
      setFailed(!!(generalError(c) ?? fieldError(c, 'code')))
      onAnswer(c)
      if (generalError(c) ?? fieldError(c, 'code')) {
        setCode('')
        requestAnimationFrame(() => errRef.current?.focus())
      }
    } finally {
      setBusy(false)
    }
  }
  async function resend() {
    setWait(RESEND_AFTER)
    setFailed(false)
    onAnswer(await answer(flow, { component: t.stage, [t.field]: to }))
  }
  return (
    <>
      {failed && wrong && (
        <div ref={errRef} tabIndex={-1} role="alert" className="flex flex-col gap-1 rounded-md border-2 border-destructive bg-card p-4">
          <h2 className="font-semibold">There's a problem</h2>
          <a href="#code" className="font-medium text-destructive underline underline-offset-2">
            {t.wrong}
          </a>
        </div>
      )}
      <AuthHeading
        eyebrow="Start an application"
        title={t.title}
        lead={
          <>
            We sent a 6-digit code to <span className={cn('whitespace-nowrap text-foreground', t.mono && 'font-mono')}>{shown}</span>.
          </>
        }
      />
      <fieldset id="code" className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t.legend}</legend>
        {failed && wrong && <span className="font-medium text-destructive">Check the code and try again</span>}
        <CodeBoxes value={code} onChange={setCode} invalid={failed} />
      </fieldset>
      <Button block disabled={busy || code.length !== 6} onClick={() => void verify()}>
        {channel === 'sms' ? 'Verify number' : 'Verify email'}
      </Button>
      <div className="flex flex-col items-start gap-2 border-t pt-4">
        <h2 className="font-semibold">{t.waiting}</h2>
        <p className="text-sm text-muted-foreground">{t.help}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={wait > 0} onClick={() => void resend()}>
            {wait > 0 ? (
              <>
                Send again in <span className="font-mono">0:{String(wait).padStart(2, '0')}</span>
              </>
            ) : (
              'Send again'
            )}
          </Button>
          <Button variant="ghost" onClick={onChange}>
            {t.change}
          </Button>
        </div>
      </div>
    </>
  )
}

// Applicant sign-up (no design: in the style of design/SignIn), then design/VerifyPhone.
