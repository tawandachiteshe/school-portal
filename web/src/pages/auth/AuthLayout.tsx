import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { Wordmark } from '@/components/shell/wordmark'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'

// Frame for sign-in, sign-up and password reset, in the style of design/Landing (desktop) and
// design/SignIn (phone). Desktop: bar with the wordmark and one action, the page on the left, a
// supporting card on the right, footer; the bar's action replaces the back arrow. Phone: back arrow,
// the page, then the phone-only extras below it.
// Desktop from 768px: staff laptops at 125–150% scaling are often under 1024px.
export const AUTH_DESKTOP = '(min-width: 768px)'

export function AuthLayout({
  action,
  onBack,
  aside,
  phoneExtra,
  children,
}: {
  action?: React.ReactNode
  onBack?: () => void
  aside?: React.ReactNode
  phoneExtra?: React.ReactNode
  children: React.ReactNode
}) {
  const desktop = useIsDesktop(AUTH_DESKTOP)
  const back = onBack && (
    <button type="button" aria-label="Back" onClick={onBack} className="-ml-3 inline-flex size-11 items-center justify-center">
      <ArrowLeft className="size-5" strokeWidth={1.5} />
    </button>
  )

  if (!desktop)
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-background">
        <header className={cn('flex h-14 shrink-0 items-center gap-1 px-4', onBack && 'border-b bg-card')}>
          {back}
          <Link to="/" aria-label="TCFL Portal, home">
            <Wordmark />
          </Link>
        </header>
        <main className="flex grow flex-col gap-6 px-4 py-6">
          {children}
          {phoneExtra}
          <p className="mt-auto pt-4 text-sm text-muted-foreground">Can't sign in? ICT Services, Block C.</p>
        </main>
      </div>
    )

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="h-16 shrink-0 border-b bg-card">
        <div className="mx-auto flex h-full max-w-[1280px] items-center justify-between gap-6 px-8 lg:px-20">
          <Link to="/" aria-label="TCFL Portal, home">
            <Wordmark />
          </Link>
          {action}
        </div>
      </header>
      <main className="grow">
        <div className="mx-auto grid max-w-[1280px] grid-cols-[minmax(0,1fr)_minmax(0,340px)] items-start gap-12 px-8 py-16 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-20 lg:px-20">
          <section className="flex max-w-[440px] flex-col gap-8">{children}</section>
          {aside && <aside className="flex flex-col gap-4 rounded-md border bg-card p-6">{aside}</aside>}
        </div>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-6 px-8 py-8 text-sm text-muted-foreground lg:px-20">
          <span>
            <span className="font-semibold text-foreground">TelOne Centre for Learning</span> · Harare, Zimbabwe
          </span>
          <span>Can't sign in? ICT Services, Block C.</span>
        </div>
      </footer>
    </div>
  )
}

// design/Landing: eyebrow, then the page title (28/36 on desktop, 24/32 on phones) and a lead.
export function AuthHeading({ eyebrow, title, lead }: { eyebrow?: string; title: string; lead: React.ReactNode }) {
  const desktop = useIsDesktop(AUTH_DESKTOP)
  return (
    <div className="flex flex-col gap-2">
      {eyebrow && desktop && <p className="text-xs leading-4 font-semibold tracking-[0.06em] text-muted-foreground uppercase">{eyebrow}</p>}
      <h1 className={desktop ? 'text-[28px] leading-9 font-semibold tracking-[-0.015em]' : 'text-2xl leading-8 font-semibold tracking-[-0.01em]'}>
        {title}
      </h1>
      <p className="text-muted-foreground">{lead}</p>
    </div>
  )
}

// A plain list with a small mark before each line (design/StaffSignIn aside, design/Landing "Have these ready").
export function Checklist({ items, mark }: { items: React.ReactNode[]; mark: React.ReactNode }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((t, i) => (
        <li key={i} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2">
          <span aria-hidden className="flex h-6 items-center">
            {mark}
          </span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}
