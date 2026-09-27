import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Wordmark } from '@/components/shell/wordmark'
import { api, ApiError } from '@/lib/api'
import { homeFor, meQueryKey, type Me } from '@/lib/auth'

type DevAccount = { username: string; display_name: string; roles: string[] }

const ROLE_LABEL: Record<string, string> = {
  student: 'Student',
  applicant: 'Applicant',
  lecturer: 'Lecturer',
  admissions: 'Admissions',
  librarian: 'Library',
  student_affairs: 'Student Affairs',
  registry: 'Registry',
  admin: 'Admin',
}

// Development only: sign in as a seeded account without Authentik (API: DEV_LOGIN=true).
export default function DevSignIn() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const accounts = useQuery({
    queryKey: ['dev-accounts'],
    queryFn: () => api<DevAccount[]>('/auth/dev-accounts'),
    retry: false,
  })

  async function signIn(username: string) {
    setError(null)
    try {
      await api('/auth/dev-login', { json: { username } })
      const me = await api<Me>('/me')
      qc.setQueryData(meQueryKey, me)
      const next = params.get('next')
      navigate(next?.startsWith('/') && !next.startsWith('//') ? next : homeFor(me), { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in. Is the API running?')
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex h-14 items-center border-b bg-card px-4">
        <Wordmark />
      </header>
      <main className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">Sign in</h1>
          <p className="text-muted-foreground">Development sign-in. Choose a sample account.</p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {accounts.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              Development sign-in is off, or the API isn't running. Start it with{' '}
              <code className="font-mono">uv run uvicorn app.main:app --reload</code>.
            </AlertDescription>
          </Alert>
        )}
        {accounts.data && (
          <ul className="border-y [&>li+li]:border-t">
            {accounts.data.map((a) => (
              <li key={a.username}>
                <button
                  type="button"
                  onClick={() => signIn(a.username)}
                  className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
                >
                  <span className="flex grow flex-col">
                    <span className="font-medium">{a.display_name}</span>
                    <span className="font-mono text-sm text-muted-foreground">{a.username}</span>
                  </span>
                  <span className="text-sm text-muted-foreground">{a.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
