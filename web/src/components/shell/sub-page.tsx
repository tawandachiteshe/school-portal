import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'
import { useIsDesktop } from '@/lib/use-desktop'
import { DeskBar, DeskFallback } from './student-desktop'
import { BottomNav } from './student-shell'

const CRUMB: Record<string, string> = {
  '/': 'Home',
  '/modules': 'Modules',
  '/deadlines': 'Deadlines',
  '/library': 'Library',
  '/more': 'Account',
}

// Sub-pages: back-arrow header; no bottom nav unless the design shows one (ModuleDetail).
export function SubPage({
  title,
  back,
  backLabel,
  mono = false,
  bottomNav = false,
  children,
}: {
  title: ReactNode
  back: string
  backLabel: string
  mono?: boolean
  bottomNav?: boolean
  children: ReactNode
}) {
  const desktop = useIsDesktop()
  if (desktop)
    return (
      <DeskFallback
        bar={
          <DeskBar
            left={
              <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
                <Link to={back} className="text-primary underline underline-offset-3">
                  {CRUMB[back] ?? (backLabel.replace(/^Back( to)? ?/, '') || 'Back')}
                </Link>
                <span aria-hidden>/</span>
                <span className={cn('text-foreground', mono && 'font-mono')}>{title}</span>
              </nav>
            }
          />
        }
      >
        {children}
      </DeskFallback>
    )
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-1 border-b bg-card pr-4 pl-1">
        <Link
          to={back}
          aria-label={backLabel}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-foreground"
        >
          <ArrowLeft className="size-5" strokeWidth={1.5} />
        </Link>
        <span className={cn('truncate font-medium', mono && 'font-mono')}>{title}</span>
      </header>
      <div className="mx-auto flex w-full max-w-[640px] grow flex-col">{children}</div>
      {bottomNav && <BottomNav />}
    </div>
  )
}
