import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'

export type Role =
  | 'applicant'
  | 'student'
  | 'lecturer'
  | 'admissions'
  | 'registry'
  | 'librarian'
  | 'admin'
  | 'student_affairs'

export type Me = {
  id: string
  display_name: string
  given_name: string
  initials: string
  roles: Role[]
  phone: string | null
  student: {
    student_number: string
    programme_code: string
    programme_name: string
    class_group: string | null
    year_of_study: number
  } | null
  staff: { staff_number: string; short_name: string; position: string | null } | null
  term: { code: string; name: string; week: number | null; weeks: number } | null
}

export const meQueryKey = ['me'] as const

// `null` means signed out (401); errors other than 401 are thrown to the error boundary.
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return await api<Me>('/me')
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
  if (r.has('applicant')) return '/apply'
  return '/staff'
}

export function isStaff(me: Me): boolean {
  return me.roles.some((r) => r !== 'student' && r !== 'applicant')
}

export function useSignOut() {
  const qc = useQueryClient()
  return async () => {
    const { redirect } = await api<{ redirect: string }>('/auth/logout', { method: 'POST' })
    qc.clear()
    window.location.assign(redirect)
  }
}
