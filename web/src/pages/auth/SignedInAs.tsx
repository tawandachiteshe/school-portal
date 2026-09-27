import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { logout } from '@/api/generated/auth/auth'
import { signOutAuthentik } from '@/lib/authentik-flow'
import { cn } from '@/lib/utils'

export type AuthentikUser = { name: string; username: string }

// Still signed in to Authentik (the portal session ended first, or someone else used this browser):
// continue as that person, or sign out and start again. Authentik won't run sign-in or sign-up
// flows for a signed-in session.
export function SignedInAs({
  user,
  onContinue,
  onSignedOut,
  inline = false,
}: {
  user: AuthentikUser
  onContinue: () => void
  onSignedOut: () => void
  inline?: boolean
}) {
  const [busy, setBusy] = useState(false)
  async function notMe() {
    setBusy(true)
    await logout().catch(() => undefined) // a portal session left open too
    await signOutAuthentik().catch(() => undefined)
    setBusy(false)
    onSignedOut()
  }
  return (
    <div className="flex flex-col gap-4">
      <p>
        You're signed in as <span className="font-semibold">{user.name}</span>
        {user.name !== user.username && <span className="font-mono text-sm text-muted-foreground"> ({user.username})</span>}.
      </p>
      <div className={cn('flex gap-3', !inline && 'flex-col')}>
        <Button block={!inline} onClick={onContinue}>
          Continue as {user.name.split(' ')[0]}
        </Button>
        <Button block={!inline} variant="outline" disabled={busy} onClick={() => void notMe()}>
          Not you? Sign out
        </Button>
      </div>
    </div>
  )
}
