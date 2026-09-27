import { BookOpen, CalendarDays, House, Layers, Menu, MessageSquare } from 'lucide-react'
import { useEffect } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useMe } from '@/lib/auth'
import { watchWifiQueue } from '@/lib/downloads'
import { dismissUpload, resumeSavedUploads } from '@/lib/uploads'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Initials, Wordmark } from './wordmark'

const NAV = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/modules', label: 'Modules', icon: Layers },
  { to: '/deadlines', label: 'Deadlines', icon: CalendarDays },
  { to: '/library', label: 'Library', icon: BookOpen },
  { to: '/more', label: 'More', icon: Menu },
]

export function StudentTopBar({ avatar = true }: { avatar?: boolean }) {
  const { data: me } = useMe()
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b bg-card pr-2 pl-4">
      <Link to="/" aria-label="TCFL Portal home" className="flex min-h-11 items-center">
        <Wordmark />
      </Link>
      <div className="flex items-center">
        <Button variant="ghost" asChild>
          <Link to="/ask">
            <MessageSquare strokeWidth={1.5} />
            Ask TCFL
          </Link>
        </Button>
        {avatar && me && (
          <Link
            to="/more"
            aria-label={`Account: ${me.display_name}`}
            className="inline-flex size-11 items-center justify-center rounded-md"
          >
            <Initials initials={me.initials} />
          </Link>
        )}
      </div>
    </header>
  )
}

export function BottomNav() {
  return (
    <nav aria-label="Main" className="sticky bottom-0 z-10 grid h-16 shrink-0 grid-cols-5 border-t bg-card">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground',
              isActive && 'font-semibold text-primary shadow-[inset_0_2px_0_var(--primary)]',
            )
          }
        >
          <Icon className="size-5" strokeWidth={1.5} aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

// Tab pages: top bar + bottom nav. Pages render their own <main>.
// `avatar={false}` on More, which is the account page itself (design/More).
// Root of the student area (tab pages and sub-pages): work that carries on while the student
// moves around the app.
export function StudentRoot() {
  const qc = useQueryClient()
  useEffect(() => {
    // Runs for every finished upload: refresh deadlines and receipts, then drop the progress state.
    void resumeSavedUploads((assessmentId) => {
      toast('Your work has been submitted.')
      void qc.invalidateQueries({ queryKey: ['student'] }).then(() => dismissUpload(assessmentId))
    })
  }, [qc])
  // Notes queued with "Download when I'm on Wi-Fi" start as soon as the phone is on Wi-Fi.
  useEffect(
    () =>
      watchWifiQueue((titles) =>
        toast(titles.length === 1 ? `On Wi-Fi: downloading ${titles[0]}.` : `On Wi-Fi: downloading ${titles.length} notes.`),
      ),
    [],
  )
  return <Outlet />
}

export function StudentShell({ avatar = true }: { avatar?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <StudentTopBar avatar={avatar} />
      <div className="mx-auto flex w-full max-w-[640px] grow flex-col">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  )
}
