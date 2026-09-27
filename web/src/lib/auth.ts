import { useQuery, useQueryClient } from '@tanstack/react-query'
import { logout } from '@/api/generated/auth/auth'
import { getMeQueryKey, me as fetchMe } from '@/api/generated/me/me'
import type { MeOut, Role } from '@/api/generated/model'
import { ApiError } from '@/lib/api'

export type { Role }
export type Me = MeOut

export const meQueryKey = getMeQueryKey()

// `null` means signed out (401); errors other than 401 are thrown to the error boundary.
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async ({ signal }) => {
      try {
        return await fetchMe({ signal })
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
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

export function isStaff(me: Me): boolean {
  return me.roles.some((r) => r !== 'student' && r !== 'applicant')
}

export function useSignOut() {
  const qc = useQueryClient()
  return async () => {
    const { redirect } = await logout()
    qc.clear()
    window.location.assign(redirect)
  }
}
