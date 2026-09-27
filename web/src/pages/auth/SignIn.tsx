import { CircleAlert } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Wordmark } from '@/components/shell/wordmark'
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
  const desktop = useIsDesktop()
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
        <Label htmlFor={ids.id}>Student number, staff email or mobile number</Label>
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
  const heading = (
    <div className="flex flex-col gap-1">
      <h1 className={desktop ? 'text-[28px] leading-9 font-semibold tracking-[-0.015em]' : 'text-2xl leading-8 font-semibold tracking-[-0.01em]'}>
        Sign in
      </h1>
      <p className="text-muted-foreground">Students, applicants and staff all sign in here.</p>
    </div>
  )

  if (desktop)
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        <header className="flex h-16 shrink-0 items-center border-b bg-card px-8">
          <Wordmark />
        </header>
        <main className="grid grid-cols-[400px_360px] items-start gap-24 px-20 py-16">
          <section className="flex flex-col gap-6">
            {heading}
            {signedIn || ((challenge || down) && form)}
            <p className="text-sm text-muted-foreground">
              New applicant?{' '}
              <Link to="/register" className="text-primary underline underline-offset-2">
                Start an application
              </Link>
            </p>
            {devLink}
          </section>
          <aside className="flex flex-col gap-4 pt-[72px]">
            <h2 className="font-semibold">On a college lab computer?</h2>
            <ul className="flex flex-col gap-2.5 text-sm">
              {[
                "Don't let the browser save your password.",
                'Sign out from the menu when you’re done.',
                'Need to scan a document? You can continue on your phone at that step.',
              ].map((t) => (
                <li key={t} className="grid grid-cols-[12px_minmax(0,1fr)] gap-2">
                  <span aria-hidden className="mt-2 size-1 rounded-full bg-foreground" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <p className="border-t pt-4 text-sm text-muted-foreground">Can't sign in? ICT Services, Block C.</p>
          </aside>
        </main>
      </div>
    )

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center px-4">
        <Wordmark />
      </header>
      <main className="flex grow flex-col gap-6 px-4 py-6">
        {heading}
        {signedIn || ((challenge || down) && form)}
        <section aria-labelledby="h-new" className="flex flex-col items-start gap-2 border-t pt-6">
          <h2 id="h-new" className="font-semibold">
            Applying to TCFL?
          </h2>
          <p className="text-sm text-muted-foreground">Have your National ID and ZIMSEC results with you.</p>
          <Button variant="outline" className="mt-1" asChild>
            <Link to="/register">Start an application</Link>
          </Button>
        </section>
        {devLink}
        <p className="mt-auto text-sm text-muted-foreground">Can't sign in? ICT Services, Block C.</p>
      </main>
    </div>
  )
}
