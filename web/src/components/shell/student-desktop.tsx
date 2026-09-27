import {
  Bell,
  BookOpen,
  CalendarDays,
  CalendarRange,
  GraduationCap,
  House,
  Layers,
  MessageSquare,
  Search,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { Input } from '@/components/ui/input'
import { useDeadlines } from '@/api/generated/deadlines/deadlines'
import { useDashboard } from '@/api/generated/student/student'
import { useMe } from '@/lib/auth'
import { isUrgent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { OfflineBar } from './offline-bar'
import { Initials, Wordmark } from './wordmark'

type Item = { to: string; label: string; icon: LucideIcon; end?: boolean; count?: number; urgent?: boolean }

// design/DeskHome: the student sidebar on a computer.
function Sidebar() {
  const { data: me } = useMe()
  const dash = useDashboard()
  const deadlines = useDeadlines()
  const now = new Date()
  const urgent =
    deadlines.data?.items.filter((i) => i.status === null && isUrgent(new Date(i.due_at), now, false)).length ?? 0
  const unread = dash.data?.announcements.unread ?? 0
  const items: Item[] = [
    { to: '/', label: 'Home', icon: House, end: true },
    { to: '/timetable', label: 'Timetable', icon: CalendarRange },
    { to: '/modules', label: 'Modules', icon: Layers },
    { to: '/deadlines', label: 'Deadlines', icon: CalendarDays, count: urgent, urgent: true },
    { to: '/library', label: 'Library', icon: BookOpen },
    { to: '/results', label: 'Results', icon: GraduationCap },
    { to: '/fees', label: 'Fees', icon: Wallet },
    { to: '/announcements', label: 'Announcements', icon: Bell, count: unread },
  ]
  const link = ({ to, label, icon: Icon, end, count, urgent: amber }: Item) => (
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
      {!!count && (
        <span className={cn('ml-auto font-mono text-xs', amber && 'font-semibold text-urgent')}>
          {count}
          <span className="sr-only">{amber ? ' due within 48 hours' : ' unread'}</span>
        </span>
      )}
    </NavLink>
  )
  return (
    <aside aria-label="Student" className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col border-r bg-card px-3 py-4">
      <Link to="/" className="px-2.5 pt-1 pb-4" aria-label="TCFL Portal home">
        <Wordmark />
      </Link>
      <nav className="flex flex-col gap-0.5">
        {items.map(link)}
        <div className="mt-3 mb-2 border-t" />
        {link({ to: '/ask', label: 'Ask TCFL', icon: MessageSquare })}
      </nav>
      {me && (
        <Link to="/more" className="mt-auto flex items-center gap-2.5 border-t px-2.5 pt-3" title="Account and settings">
          <Initials initials={me.initials} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{me.display_name}</span>
            {me.student && <span className="font-mono text-xs text-muted-foreground">{me.student.student_number}</span>}
          </span>
        </Link>
      )}
    </aside>
  )
}

export function DesktopStudentShell() {
  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar />
      <div className="flex min-w-0 grow flex-col">
        <OfflineBar />
        <Outlet />
      </div>
    </div>
  )
}

// 56px bar at the top of each desktop page.
export function DeskBar({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-card px-8">
      <div className="min-w-0 text-sm text-muted-foreground">{left}</div>
      {right}
    </header>
  )
}

// "DIT-1A · Semester 1 2027"
export function ClassContext() {
  const { data: me } = useMe()
  if (!me) return null
  return (
    <>
      {me.student?.class_group && <span className="font-mono">{me.student.class_group}</span>}
      {me.student?.class_group && me.term && ' · '}
      {me.term?.name}
    </>
  )
}

export function DeskSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  return (
    <form
      role="search"
      className="relative w-[340px]"
      onSubmit={(e) => {
        e.preventDefault()
        if (q.trim().length >= 2) navigate(`/search?q=${encodeURIComponent(q.trim())}`)
      }}
    >
      <label htmlFor="desk-search" className="sr-only">
        Search
      </label>
      <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <Input
        id="desk-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search modules, notes, announcements"
        className="h-9 pl-8 text-sm"
      />
    </form>
  )
}

// Pages without a desktop design keep their phone layout, in a readable column under a bar.
export function DeskFallback({ bar, children }: { bar?: ReactNode; children: ReactNode }) {
  return (
    <>
      {bar ?? <DeskBar left={<ClassContext />} />}
      <div className="flex w-full max-w-[720px] grow flex-col px-4">{children}</div>
    </>
  )
}

// A desktop page with a breadcrumb bar: "Library / Search".
export function DeskPage({
  crumbs,
  right,
  children,
  wide = false,
}: {
  crumbs: { to?: string; label: ReactNode }[]
  right?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  return (
    <>
      <DeskBar
        left={
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden>/</span>}
                {c.to ? (
                  <Link to={c.to} className="text-primary underline underline-offset-3">
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-foreground">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        }
        right={right}
      />
      <main className={cn('flex flex-col gap-6 p-8', wide ? 'max-w-[1200px]' : 'max-w-[1040px]')}>{children}</main>
    </>
  )
}

export const deskH1 = 'text-[28px] leading-9 font-semibold tracking-[-0.015em]'
