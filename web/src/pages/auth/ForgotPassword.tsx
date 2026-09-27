import { CircleCheck, Info } from 'lucide-react'
import { useId, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resetFinish, resetStart } from '@/api/generated/auth/auth'
import { errorMessage } from '@/lib/api'
import { useIsDesktop } from '@/lib/use-desktop'
import { AUTH_DESKTOP, AuthHeading, AuthLayout } from './AuthLayout'

// design/ForgotPassword: text a code, then choose a new password (the second screen has no design).
export default function ForgotPassword() {
  const navigate = useNavigate()
  const desktop = useIsDesktop(AUTH_DESKTOP)
  const ids = { id: useId(), code: useId(), pw: useId(), pw2: useId() }
  const [stage, setStage] = useState<'ask' | 'code' | 'done'>('ask')
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [minutes, setMinutes] = useState(10)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(f: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await f()
    } catch (e) {
      setError(errorMessage(e, "Couldn't do that just now. Try again."))
    } finally {
      setBusy(false)
    }
  }

  const help = (
    <>
      <h2 className={desktop ? 'text-lg leading-6 font-semibold' : 'font-semibold'}>Changed your number, or lost your phone?</h2>
      <p className="text-sm">Bring your National ID to ICT Services in Block C and they'll reset it for you.</p>
      <p className="border-t pt-3 text-sm text-muted-foreground">Staff: use the reset link in your TCFL email, or ask ICT Services.</p>
    </>
  )

  return (
    <AuthLayout
      onBack={() => navigate('/login')}
      action={
        <Button variant="outline" size="sm" asChild>
          <Link to="/login">Sign in</Link>
        </Button>
      }
      aside={help}
      phoneExtra={
        stage === 'ask' && (
          <>
            <Alert variant="info">
              <Info strokeWidth={1.5} />
              <p className="text-sm">
                Changed your number, or lost your phone? Bring your National ID to ICT Services in Block C and they'll reset it
                for you.
              </p>
            </Alert>
            <p className="text-sm text-muted-foreground">Staff: use the reset link in your TCFL email, or ask ICT Services.</p>
          </>
        )
      }
    >
        {error && (
          <div role="alert" className="rounded-md border-2 border-destructive bg-card p-4 font-medium text-destructive">
            {error}
          </div>
        )}
        {stage === 'ask' && (
          <>
            <AuthHeading
              eyebrow="Signing in"
              title="Reset your password"
              lead="We'll send a code to the mobile number and email on your account. Then you choose a new password."
            />
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  setMinutes((await resetStart({ identifier })).minutes)
                  setStage('code')
                })
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.id}>Student number, mobile number or email</Label>
                <Input
                  id={ids.id}
                  value={identifier}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="font-mono"
                />
              </div>
              <Button type="submit" block disabled={busy || identifier.trim().length < 3}>
                Send me a code
              </Button>
            </form>
          </>
        )}
        {stage === 'code' && (
          <>
            <AuthHeading
              eyebrow="Signing in"
              title="Choose a new password"
              lead={
                <>
                  If <span className="font-mono text-foreground">{identifier}</span> is an account, we've sent a code to its mobile number
                  or email. It works for {minutes} minutes.
                </>
              }
            />
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault()
                if (password !== repeat) return setError("The two passwords don't match.")
                void run(async () => {
                  await resetFinish({ identifier, code, password })
                  setStage('done')
                })
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.code}>Code from the SMS or email</Label>
                <Input
                  id={ids.code}
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="w-40 text-center font-mono text-xl tracking-[0.3em]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.pw}>New password</Label>
                <span className="text-sm text-muted-foreground">At least 10 characters. A few words together is easy to remember.</span>
                <Input id={ids.pw} type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.pw2}>New password again</Label>
                <Input id={ids.pw2} type="password" value={repeat} autoComplete="new-password" onChange={(e) => setRepeat(e.target.value)} />
              </div>
              <Button type="submit" block disabled={busy || code.length !== 6 || password.length < 10}>
                Set new password
              </Button>
              <Button type="button" variant="ghost" block onClick={() => setStage('ask')}>
                Send a new code
              </Button>
            </form>
          </>
        )}
        {stage === 'done' && (
          <>
            <div role="status" className="flex flex-col gap-3">
              <CircleCheck className="size-6 text-success" strokeWidth={1.5} aria-hidden />
              <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">Password changed</h1>
              <p className="text-muted-foreground">Sign in with your new password.</p>
            </div>
            <Button block asChild>
              <Link to="/login">Sign in</Link>
            </Button>
          </>
        )}
    </AuthLayout>
  )
}
