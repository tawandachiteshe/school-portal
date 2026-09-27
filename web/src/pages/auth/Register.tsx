import { Check, CircleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { answer, authentikUser, type Challenge, e164, fallbackUrl, fieldError, finishSignIn, generalError, startFlow } from '@/lib/authentik-flow'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { AUTH_DESKTOP, AuthHeading, AuthLayout, Checklist } from './AuthLayout'
import { type AuthentikUser, SignedInAs } from './SignedInAs'

const FLOW = 'tcfl-enrollment'
const RESEND_AFTER = 60

const masked = (p: string) => `${p.slice(0, 4)} ${p.slice(4, 6)} ••• ${p.slice(-4)}`

// design/Landing "Have these ready", with the birth certificate the application now asks for.
const READY = [
  'Your National ID, metal or plastic',
  'Your birth certificate',
  'Your ZIMSEC O-Level result slip or certificate',
  'A phone with a camera, or scans of your documents',
  'The application fee, paid at the end',
]

function Ready({ card }: { card: boolean }) {
  return (
    <section aria-labelledby="h-ready" className={card ? 'flex flex-col gap-4' : 'flex flex-col gap-3 border-t pt-6'}>
      <h2 id="h-ready" className={card ? 'text-lg leading-6 font-semibold' : 'font-semibold'}>
        Have these ready
      </h2>
      <Checklist items={READY} mark={<Check className="size-5 text-success" strokeWidth={1.5} />} />
      <p className={cn('text-sm text-muted-foreground', card && 'border-t pt-3')}>
        No smartphone? Use a college lab computer and upload scans, or ask at the Admissions Office in Block A.
      </p>
    </section>
  )
}

function Problem({ text }: { text?: string | null }) {
  if (!text) return null
  return (
    <Alert variant="destructive">
      <CircleAlert strokeWidth={1.5} />
      <p>{text}</p>
    </Alert>
  )
}

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

function Verify({ phone, challenge, onAnswer, onChangeNumber }: { phone: string; challenge: Challenge; onAnswer: (c: Challenge) => void; onChangeNumber: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(RESEND_AFTER)
  const [failed, setFailed] = useState(false)
  const errRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  const wrong = generalError(challenge) ?? fieldError(challenge, 'code')
  async function verify() {
    setBusy(true)
    try {
      const c = await answer(FLOW, { component: 'ak-stage-authenticator-sms', code: Number(code) })
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
    onAnswer(await answer(FLOW, { component: 'ak-stage-authenticator-sms', phone_number: phone }))
  }
  return (
    <>
      {failed && wrong && (
        <div ref={errRef} tabIndex={-1} role="alert" className="flex flex-col gap-1 rounded-md border-2 border-destructive bg-card p-4">
          <h2 className="font-semibold">There's a problem</h2>
          <a href="#code" className="font-medium text-destructive underline underline-offset-2">
            That code isn't right. Check the SMS, or send a new code.
          </a>
        </div>
      )}
      <AuthHeading
        eyebrow="Start an application"
        title="Check your phone"
        lead={
          <>
            We sent a 6-digit code to <span className="font-mono whitespace-nowrap text-foreground">{masked(phone)}</span>.
          </>
        }
      />
      <fieldset id="code" className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Code from the SMS</legend>
        {failed && wrong && <span className="font-medium text-destructive">Check the code and try again</span>}
        <CodeBoxes value={code} onChange={setCode} invalid={failed} />
      </fieldset>
      <Button block disabled={busy || code.length !== 6} onClick={() => void verify()}>
        Verify number
      </Button>
      <div className="flex flex-col items-start gap-2 border-t pt-4">
        <h2 className="font-semibold">No SMS yet?</h2>
        <p className="text-sm text-muted-foreground">Texts can take a minute on busy networks. Check the number is right and that your phone has signal.</p>
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
          <Button variant="ghost" onClick={onChangeNumber}>
            Change number
          </Button>
        </div>
      </div>
    </>
  )
}

// Applicant sign-up (no design: in the style of design/SignIn), then design/VerifyPhone.
export default function Register() {
  const navigate = useNavigate()
  const desktop = useIsDesktop(AUTH_DESKTOP)
  const ids = { name: useId(), mobile: useId(), pw: useId(), pw2: useId() }
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [down, setDown] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', mobile: '', password: '', repeat: '' })
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState<string | null>(null)
  const [already, setAlready] = useState<AuthentikUser | null>(null)
  const phone = e164(form.mobile)

  const begin = () =>
    startFlow(FLOW)
      .then(setChallenge)
      .catch((e: Error) => setDown(e.message))
  const restart = () => {
    setChallenge(null)
    void begin()
  }
  useEffect(() => {
    void authentikUser().then((u) => (u ? setAlready(u) : begin()))
  }, [])

  async function handle(c: Challenge): Promise<void> {
    if (c.component === 'xak-flow-redirect') return finishSignIn('/apply')
    if (c.component === 'ak-stage-user-login') return handle(await answer(FLOW, { component: 'ak-stage-user-login', remember_me: true }))
    if (c.component === 'ak-stage-authenticator-sms' && 'phone_number_required' in c && c.phone_number_required && phone)
      return handle(await answer(FLOW, { component: 'ak-stage-authenticator-sms', phone_number: phone }))
    const known = ['ak-stage-prompt', 'ak-stage-authenticator-sms', 'ak-stage-access-denied', 'ak-stage-flow-error']
    if (!known.includes(c.component)) return window.location.assign(fallbackUrl(FLOW))
    setChallenge(c)
  }

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault()
    setLocal(null)
    if (!phone) return setLocal('Enter a Zimbabwe mobile number, like 077 318 4521.')
    if (form.password !== form.repeat) return setLocal("The two passwords don't match.")
    setBusy(true)
    try {
      await handle(
        await answer(FLOW, {
          component: 'ak-stage-prompt',
          name: form.name.trim(),
          username: phone.slice(1),
          password: form.password,
          password_repeat: form.repeat,
        }),
      )
    } catch (err) {
      setDown((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const frame = (onBack: () => void, children: React.ReactNode) => (
    <AuthLayout
      onBack={onBack}
      action={
        <Button variant="outline" size="sm" asChild>
          <Link to="/login">Sign in</Link>
        </Button>
      }
      aside={<Ready card />}
      phoneExtra={<Ready card={false} />}
    >
      {children}
    </AuthLayout>
  )

  if (challenge?.component === 'ak-stage-authenticator-sms' && phone)
    return frame(restart, <Verify phone={phone} challenge={challenge} onAnswer={(c) => void handle(c)} onChangeNumber={restart} />)

  const denied = challenge?.component === 'ak-stage-access-denied'
  const err = (k: string) => fieldError(challenge, k)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return frame(
    () => navigate('/login'),
    <>
      <AuthHeading
        eyebrow="New applicants"
        title="Start an application"
        lead="Create an account with your mobile number. You'll sign in with it, and can leave and come back to your application at any time."
      />
      {already && (
        <SignedInAs
          user={already}
          onContinue={() => finishSignIn('/apply')}
          onSignedOut={() => {
            setAlready(null)
            void begin()
          }}
        />
      )}
      <Problem
        text={
          local ??
          (denied ? 'There’s already an account with this number. Sign in instead, or reset your password.' : generalError(challenge)) ??
          down
        }
      />
      {already || (!challenge && !down) ? null : denied ? (
        <div className="flex flex-col gap-3">
          <Button block asChild>
            <Link to="/login">Sign in</Link>
          </Button>
          <Button block variant="outline" onClick={restart}>
            Use a different number
          </Button>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.name}>Full name</Label>
            <span className="text-sm text-muted-foreground">As it is on your National ID</span>
            {err('name') && <span className="font-medium text-destructive">{err('name')}</span>}
            <Input id={ids.name} value={form.name} autoComplete="name" onChange={set('name')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.mobile}>Mobile number</Label>
            <span className="text-sm text-muted-foreground">You'll sign in with this number</span>
            {err('username') && <span className="font-medium text-destructive">{err('username')}</span>}
            <Input id={ids.mobile} value={form.mobile} inputMode="tel" autoComplete="tel" placeholder="077 318 4521" onChange={set('mobile')} className="font-mono" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.pw}>Password</Label>
            <span className="text-sm text-muted-foreground">At least 10 characters. A few words together is easy to remember.</span>
            {err('password') && <span className="font-medium text-destructive">{err('password')}</span>}
            <Input id={ids.pw} type="password" value={form.password} autoComplete="new-password" onChange={set('password')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.pw2}>Password again</Label>
            <Input id={ids.pw2} type="password" value={form.repeat} autoComplete="new-password" onChange={set('repeat')} />
          </div>
          <div>
            <Button
              type="submit"
              block={!desktop}
              className={desktop ? 'min-w-40' : undefined}
              disabled={busy || !challenge || !form.name || !form.mobile || !form.password}
            >
              Create account
            </Button>
          </div>
          {!desktop && (
            <p className="text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link to="/login" className="text-primary underline underline-offset-2">
                Sign in
              </Link>
            </p>
          )}
        </form>
      )}
    </>,
  )
}
