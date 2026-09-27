import { CircleAlert } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDevAccounts } from '@/api/generated/auth/auth'
import {
  answer,
  authentikUser,
  signInName,
  type Challenge,
  fallbackUrl,
  fieldError,
  finishSignIn,
  generalError,
  startFlow,
} from '@/lib/authentik-flow'
import { useIsDesktop } from '@/lib/use-desktop'
import { AUTH_DESKTOP, AuthHeading, AuthLayout, Checklist } from './AuthLayout'
import { GoogleSignIn } from './GoogleSignIn'
import { type AuthentikUser, SignedInAs } from './SignedInAs'
import { cn } from '@/lib/utils'

const FLOW = 'tcfl-authentication'
const ERRORS: Record<string, string> = {
  signin: "Sign-in didn't finish. Try again.",
  noaccess: "Your account isn't set up for the portal yet. Ask ICT Services, Block C.",
}

function Password({ id, value, onChange, error }: { id: string; value: string; onChange: (v: string) => void; error?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        autoComplete="current-password"
        aria-invalid={!!error || undefined}
        onChange={(e) => onChange(e.target.value)}
        className="pr-[72px]"
      />
      <Button type="button" variant="ghost" size="sm" className="absolute top-1 right-1" onClick={() => setShow((s) => !s)}>
        {show ? 'Hide' : 'Show'}
      </Button>
    </div>
  )
}

// design/SignIn (phone) and StaffSignIn (computer): our screen for Authentik's identification stage.
export default function SignIn() {
  const desktop = useIsDesktop(AUTH_DESKTOP)
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/'
  const ids = { id: useId(), pw: useId(), shared: useId() }
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [shared, setShared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [down, setDown] = useState<string | null>(null)
  const dev = useDevAccounts({ query: { retry: false } })

  const [already, setAlready] = useState<AuthentikUser | null>(null)
  const begin = () =>
    startFlow(FLOW)
      .then(setChallenge)
      .catch((e: Error) => setDown(e.message))
  useEffect(() => {
    void authentikUser().then((u) => (u ? setAlready(u) : begin()))
  }, [])

  // Each answer brings the next challenge; the last one is a redirect.
  async function handle(c: Challenge): Promise<void> {
    if (c.component === 'xak-flow-redirect') return finishSignIn(next, shared)
    // "Remember me": the shared-computer tick answers it, so there's no extra screen.
    if (c.component === 'ak-stage-user-login') return handle(await answer(FLOW, { component: 'ak-stage-user-login', remember_me: !shared }))
    const known = ['ak-stage-identification', 'ak-stage-password', 'ak-stage-access-denied', 'ak-stage-flow-error']
    if (!known.includes(c.component)) return window.location.assign(fallbackUrl(FLOW)) // e.g. MFA: Authentik's page
    setChallenge(c)
  }

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault()
    if (!challenge) return
    setBusy(true)
    try {
      if (challenge.component === 'ak-stage-password') await handle(await answer(FLOW, { component: 'ak-stage-password', password }))
      else await handle(await answer(FLOW, { component: 'ak-stage-identification', uid_field: signInName(username), password }))
    } catch (err) {
      setDown((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const problem = ERRORS[params.get('error') ?? ''] ?? generalError(challenge) ?? down
  const signedIn = already && (
    <SignedInAs
      user={already}
      inline={desktop}
      onContinue={() => finishSignIn(next)}
      onSignedOut={() => {
        setAlready(null)
        void begin()
      }}
    />
  )
  const uidError = fieldError(challenge, 'uid_field')
  const pwError = fieldError(challenge, 'password')
  const form = (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
      {problem && (
        <Alert variant="destructive">
          <CircleAlert strokeWidth={1.5} />
          <p>{problem}</p>
        </Alert>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.id}>Student number, email or mobile number</Label>
        {uidError && <span className="font-medium text-destructive">{uidError}</span>}
        <Input
          id={ids.id}
          value={username}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={!!uidError || undefined}
          onChange={(e) => setUsername(e.target.value)}
          className={cn(!desktop && 'font-mono')}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={ids.pw}>Password</Label>
          {desktop && (
            <Link to="/forgot" className="text-sm text-primary underline underline-offset-2">
              Forgot it?
            </Link>
          )}
        </div>
        {pwError && <span className="font-medium text-destructive">{pwError}</span>}
        <Password id={ids.pw} value={password} onChange={setPassword} error={pwError} />
      </div>
      {desktop && (
        <label htmlFor={ids.shared} className="flex cursor-pointer items-start gap-2.5">
          <input id={ids.shared} type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="mt-1 size-4 accent-primary" />
          <span>
            <span className="block">This is a shared computer</span>
            <span className="text-sm text-muted-foreground">You'll be signed out when you close the browser</span>
          </span>
        </label>
      )}
      <div>
        <Button type="submit" block={!desktop} className={desktop ? 'min-w-40' : undefined} disabled={busy || !challenge || !username || !password}>
          Sign in
        </Button>
      </div>
      {!desktop && (
        <Link to="/forgot" className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
          Forgot your password?
        </Link>
      )}
    </form>
  )
  const devLink = dev.data && dev.data.length > 0 && (
    <p className="text-sm text-muted-foreground">
      Development:{' '}
      <Link to={`/login/dev${params.toString() ? `?${params}` : ''}`} className="text-primary underline underline-offset-2">
        sign in as a sample account
      </Link>
    </p>
  )
  const apply = (
    <section aria-labelledby="h-new" className="flex flex-col items-start gap-2 border-t pt-6">
      <h2 id="h-new" className="font-semibold">
        Applying to TCFL?
      </h2>
      <p className="text-sm text-muted-foreground">Create an account with your mobile number. Have your National ID and ZIMSEC results with you.</p>
      <Button variant="outline" className="mt-2" asChild>
        <Link to="/register">Start an application</Link>
      </Button>
    </section>
  )

  return (
    <AuthLayout
      phoneExtra={apply}
      action={
        <Button variant="outline" size="sm" asChild>
          <Link to="/register">Start an application</Link>
        </Button>
      }
      aside={
        <>
          <h2 className="text-lg leading-6 font-semibold">On a college lab computer?</h2>
          <Checklist
            mark={<span className="size-1 rounded-full bg-foreground" />}
            items={[
              'Tick “This is a shared computer”, so you’re signed out when you close the browser.',
              "Don't let the browser save your password.",
              'Sign out from the menu when you’re done.',
              'Need to scan a document? You can continue on your phone at that step.',
            ]}
          />
        </>
      }
    >
      <AuthHeading eyebrow="TelOne Centre for Learning" title="Sign in" lead="Students, applicants and staff all sign in here." />
      {signedIn || ((challenge || down) && form)}
      {!already && (challenge || down) && <GoogleSignIn next={next} />}
      {devLink}
    </AuthLayout>
  )
}
