import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'
import { BottomNav } from './student-shell'

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
