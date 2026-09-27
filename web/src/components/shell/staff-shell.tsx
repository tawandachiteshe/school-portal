import {
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  Clock,
  FileText,
  House,
  Inbox,
  LogOut,
  MessageSquare,
  Pin,
  Search,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, NavLink, Outlet } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { useOverview } from '@/api/generated/teaching/teaching'
import { useQueueSummary } from '@/api/generated/admissions/admissions'
import { useDeskToday } from '@/api/generated/library-desk/library-desk'
import { homeFor, useMe, useSignOut, type Role } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Initials, Wordmark } from './wordmark'

type Item = { to: string; label: string; icon: LucideIcon; end?: boolean }
type Group = { title: string; items: Item[] }

const announcements: Item = { to: '/staff/announcements', label: 'Announcements', icon: Bell }
const findStudent: Item = { to: '/staff/students', label: 'Find a student', icon: Search }

// Role-specific navigation (design/StaffQueue, LecturerHome, LibraryDesk, AnnouncementCompose).
const NAV: Partial<Record<Role, Group[]>> = {
  admissions: [
    {
      title: 'Admissions',
      items: [
        { to: '/staff/admissions', label: 'Applications', icon: Inbox, end: true },
        { to: '/staff/admissions/decided', label: 'Decisions sent', icon: Check },
        { to: '/staff/admissions/places', label: 'Intake places', icon: CalendarDays },
      ],
    },
    { title: 'College', items: [announcements, findStudent] },
  ],
  lecturer: [
    {
      title: 'Teaching',
      items: [
        { to: '/staff/teaching', label: 'Today', icon: House, end: true },
        { to: '/staff/teaching/marking', label: 'Marking', icon: Check },
        announcements,
      ],
    },
  ],
  librarian: [
    {
      title: 'Library',
      items: [
        { to: '/staff/library', label: 'Issue and return', icon: BookOpen, end: true },
        { to: '/staff/library/overdue', label: 'Overdue', icon: Clock },
        { to: '/staff/library/reservations', label: 'Reservations', icon: Pin },
        { to: '/staff/library/catalogue', label: 'Catalogue', icon: Search },
        { to: '/staff/library/reading-lists', label: 'Reading lists', icon: FileText },
      ],
    },
  ],
  student_affairs: [
    {
      title: 'Student Affairs',
      items: [
        announcements,
        { to: '/staff/ask-questions', label: 'Questions from Ask TCFL', icon: MessageSquare },
        findStudent,
      ],
    },
  ],
}

function groupsFor(roles: Role[]): Group[] {
  const seen = new Set<string>()
  const groups: Group[] = []
  for (const role of roles) {
    for (const g of NAV[role] ?? []) {
      const items = g.items.filter((i) => !seen.has(i.to))
      items.forEach((i) => seen.add(i.to))
      if (items.length) groups.push({ ...g, items })
    }
  }
  return groups
}

// Lecturers: counts on "Marking" and their classes under "My classes" (design/LecturerHome).
function useLecturerNav(enabled: boolean) {
  const { data } = useOverview({ query: { enabled, staleTime: 60_000 } })
  const counts: Record<string, number> = data ? { '/staff/teaching/marking': data.marking.length } : {}
  const classes = data?.classes ?? []
  return { counts, classes }
}

// Librarians: open overdue loans and reservations waiting on the desk (design/LibraryOverdue).
function useLibrarianCounts(enabled: boolean): Record<string, number> {
  const { data } = useDeskToday({ query: { enabled, staleTime: 60_000 } })
  return data
    ? {
        '/staff/library/overdue': data.overdue,
        '/staff/library/reservations': data.reservations_waiting + data.reservations_ready,
      }
    : {}
}

// Admissions: open applications and decisions sent (design/StaffQueue "Applications 52").
function useAdmissionsCounts(enabled: boolean): Record<string, number> {
  const { data } = useQueueSummary({ query: { enabled, staleTime: 60_000 } })
  return data ? { '/staff/admissions': data.open, '/staff/admissions/decided': data.decided } : {}
}

export function StaffShell({ extraNav }: { extraNav?: ReactNode }) {
  const { data: me } = useMe()
  const signOut = useSignOut()
  const lecturer = !!me?.roles.includes('lecturer')
  const { counts: lecturerCounts, classes } = useLecturerNav(lecturer)
  const libraryCounts = useLibrarianCounts(!!me?.roles.includes('librarian'))
  const admissionsCounts = useAdmissionsCounts(!!me?.roles.includes('admissions'))
  const counts = { ...lecturerCounts, ...libraryCounts, ...admissionsCounts }
  if (!me) return null
  return (
    <div className="flex min-h-dvh bg-background">
      <aside
        aria-label="Staff"
        className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col border-r bg-card px-3 py-4"
      >
        <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-3">
          <Wordmark />
          <Badge className="ml-auto">Staff</Badge>
        </div>
        <nav className="flex flex-col gap-0.5">
          {groupsFor(me.roles).map((g) => (
            <div key={g.title} className="flex flex-col gap-0.5">
              <div className="px-2.5 pt-4 pb-1.5 text-xs font-semibold text-muted-foreground">{g.title}</div>
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted',
                      isActive && 'bg-primary-soft font-semibold text-primary hover:bg-primary-soft',
                    )
                  }
                >
                  <Icon className="size-4" strokeWidth={1.5} aria-hidden />
                  {label}
                  {!!counts[to] && <span className="ml-auto font-mono text-xs">{counts[to]}</span>}
                </NavLink>
              ))}
            </div>
          ))}
          {lecturer && classes.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <div className="px-2.5 pt-4 pb-1.5 text-xs font-semibold text-muted-foreground">My classes</div>
              {classes.map((c) => (
                <NavLink
                  key={c.offering_id}
                  to={`/staff/teaching/classes/${c.offering_id}`}
                  className={({ isActive }) =>
                    cn(
                      'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted',
                      isActive && 'bg-primary-soft font-semibold text-primary hover:bg-primary-soft',
                    )
                  }
                >
                  <span className="font-mono text-[13px]">{c.module_code}</span>
                  {c.class_group}
                  <span className="ml-auto font-mono text-xs">
                    {c.students}
                    <span className="sr-only"> students</span>
                  </span>
                </NavLink>
              ))}
            </div>
          )}
          {extraNav}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 border-t px-2.5 pt-3">
          <Initials initials={me.initials} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{me.staff?.short_name ?? me.display_name}</span>
            {me.staff?.position && (
              <span className="text-xs text-muted-foreground">{me.staff.position}</span>
            )}
          </div>
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
            className="ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <LogOut className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 grow flex-col">
        <Outlet />
      </div>
    </div>
  )
}

// 56px top bar with page context on the left and a status line on the right.
export function StaffTopBar({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b bg-card px-8 text-sm text-muted-foreground">
      <span>{left}</span>
      {right && <span>{right}</span>}
    </header>
  )
}

// /staff: go to the first section the user's role has.
export function StaffIndex() {
  const { data: me } = useMe()
  return me ? <Navigate to={homeFor(me)} replace /> : null
}
