import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { homeFor, useMe, type Role } from '@/lib/auth'

// Gate a route tree on a session, and optionally on roles. Signed-out users go to /login and
// come back afterwards; users without the role go to their own home.
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { data: me, isPending } = useMe()
  const location = useLocation()
  if (isPending) return <div className="min-h-dvh bg-background" aria-busy="true" />
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (roles && !roles.some((r) => me.roles.includes(r))) return <Navigate to={homeFor(me)} replace />
  return children
}
