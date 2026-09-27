import { Check, CircleAlert } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { answer, authentikUser, type Challenge, e164, fallbackUrl, fieldError, finishSignIn, generalError, startFlow } from '@/lib/authentik-flow'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { AUTH_DESKTOP, AuthHeading, AuthLayout, Checklist } from './AuthLayout'
import { GoogleSignIn } from './GoogleSignIn'
import { type AuthentikUser, SignedInAs } from './SignedInAs'
import { Verify } from './VerifyCode'

const FLOW = 'tcfl-enrollment'
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

export default function Register() {
  const navigate = useNavigate()
  const desktop = useIsDesktop(AUTH_DESKTOP)
  const ids = { name: useId(), mobile: useId(), email: useId(), pw: useId(), pw2: useId() }
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [down, setDown] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', mobile: '', email: '', password: '', repeat: '' })
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
    const known = ['ak-stage-prompt', 'ak-stage-authenticator-sms', 'ak-stage-authenticator-email', 'ak-stage-access-denied', 'ak-stage-flow-error']
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
          email: form.email.trim(),
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
    return frame(
      restart,
      <Verify flow={FLOW} channel="sms" to={phone} shown={masked(phone)} challenge={challenge} onAnswer={(c) => void handle(c)} onChange={restart} />,
    )
  if (challenge?.component === 'ak-stage-authenticator-email')
    return frame(
      restart,
      <Verify
        flow={FLOW}
        channel="email"
        to={form.email.trim()}
        shown={form.email.trim()}
        challenge={challenge}
        onAnswer={(c) => void handle(c)}
        onChange={restart}
      />,
    )

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
        <>
          <GoogleSignIn next="/apply" first />
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
              <Label htmlFor={ids.email}>
                Email <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <span className="text-sm text-muted-foreground">You can sign in with it too</span>
              {err('email') && <span className="font-medium text-destructive">{err('email')}</span>}
              <Input id={ids.email} type="email" value={form.email} autoComplete="email" spellCheck={false} onChange={set('email')} />
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
        </>
      )}
    </>,
  )
}
