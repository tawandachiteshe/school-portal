import { ArrowLeft, CircleCheck, Info } from 'lucide-react'
import { useId, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Wordmark } from '@/components/shell/wordmark'
import { resetFinish, resetStart } from '@/api/generated/auth/auth'
import { ApiError } from '@/lib/api'

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

// design/ForgotPassword: text a code, then choose a new password (the second screen has no design).
export default function ForgotPassword() {
  const navigate = useNavigate()
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
      setError(errText(e, "Couldn't do that just now. Try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b bg-card pr-4 pl-1">
        <button type="button" aria-label="Back to sign in" onClick={() => navigate('/login')} className="inline-flex size-11 items-center justify-center">
          <ArrowLeft className="size-5" strokeWidth={1.5} />
        </button>
        <Wordmark />
      </header>
      <main className="flex grow flex-col gap-6 px-4 py-6">
        {error && (
          <div role="alert" className="rounded-md border-2 border-destructive bg-card p-4 font-medium text-destructive">
            {error}
          </div>
        )}
        {stage === 'ask' && (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">Reset your password</h1>
              <p className="text-muted-foreground">We'll text a code to the mobile number on your account. Then you choose a new password.</p>
            </div>
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
                <Label htmlFor={ids.id}>Student number or mobile number</Label>
                <Input id={ids.id} value={identifier} autoComplete="username" onChange={(e) => setIdentifier(e.target.value)} className="font-mono" />
              </div>
              <Button type="submit" block disabled={busy || identifier.trim().length < 3}>
                Text me a code
              </Button>
            </form>
            <Alert variant="info">
              <Info strokeWidth={1.5} />
              <p className="text-sm">
                Changed your number, or lost your phone? Bring your National ID to ICT Services in Block C and they'll reset it
                for you.
              </p>
            </Alert>
            <p className="text-sm text-muted-foreground">Staff: use the reset link in your TCFL email, or ask ICT Services.</p>
          </>
        )}
        {stage === 'code' && (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">Choose a new password</h1>
              <p className="text-muted-foreground">
                If <span className="font-mono text-foreground">{identifier}</span> is an account with a mobile number, we've
                texted a code to it. It works for {minutes} minutes.
              </p>
            </div>
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
                <Label htmlFor={ids.code}>Code from the SMS</Label>
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
      </main>
    </div>
  )
}
