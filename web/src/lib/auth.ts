import { useQuery, useQueryClient } from '@tanstack/react-query'
import { logout } from '@/api/generated/auth/auth'
import { getMeQueryKey, me as fetchMe } from '@/api/generated/me/me'
import type { MeOut, Role } from '@/api/generated/model'
import { ApiError } from '@/lib/api'
import { claimOfflineData, forgetOfflineData } from '@/lib/offline'
import { markSignedIn, sessionEnded } from '@/lib/session'

export type { Role }
export type Me = MeOut

export const meQueryKey = getMeQueryKey()

// `null` means signed out (401); errors other than 401 are thrown to the error boundary.
// A session that ends while a page is open keeps the page (and who was signed in) under the
// "You've been signed out" sheet (lib/session.ts), so nothing typed is thrown away.
export function useMe() {
  const qc = useQueryClient()
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async ({ signal }) => {
      try {
        const me = await fetchMe({ signal })
        markSignedIn()
        claimOfflineData(qc, me.id)
        return me
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          if (sessionEnded()) return qc.getQueryData<Me | null>(meQueryKey) ?? null
          return null
        }
        throw e
      }
    },
    staleTime: 5 * 60_000,
  })
}

// Where each kind of user lands after signing in.
export function homeFor(me: Me): string {
  const r = new Set(me.roles)
  if (r.has('student')) return '/'
  if (r.has('admissions')) return '/staff/admissions'
  if (r.has('lecturer')) return '/staff/teaching'
  if (r.has('librarian')) return '/staff/library'
  if (r.has('student_affairs')) return '/staff/announcements'
  if (r.has('accounts')) return '/staff/accounts/payments'
  if (r.has('applicant')) return '/apply'
  return '/staff'
}

export function useSignOut() {
  const qc = useQueryClient()
  return async () => {
    const { redirect } = await logout()
    qc.clear()
    forgetOfflineData()
    window.location.assign(redirect)
  }
}
