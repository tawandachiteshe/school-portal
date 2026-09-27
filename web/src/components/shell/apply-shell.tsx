import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { MyApplication } from '@/api/generated/model'
import { useSignOut } from '@/lib/auth'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { Initials, Wordmark } from './wordmark'

// The designs have five steps; Birth certificate was added after them.
const STEPS = ['Programme', 'National ID', 'Birth certificate', 'ZIMSEC results', 'Review', 'Submit'] as const

// Mobile: "Step 1 of 6 · Programme / Next: National ID" over one 4px segment per step (design/ProgrammeMobile).
function MobileSteps({ step }: { step: number }) {
  return (
    <div className="flex flex-col gap-2 bg-background px-4 pt-4 pb-3">
      <div className="flex justify-between text-sm">
        <span className="font-medium">
          Step {step} of {STEPS.length} · {STEPS[step - 1]}
        </span>
        {step < STEPS.length && <span className="text-muted-foreground">Next: {STEPS[step]}</span>}
      </div>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={step}
        aria-label={`Step ${step} of ${STEPS.length}`}
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }}
      >
        {STEPS.map((s, i) => (
          <span key={s} className={cn('h-1 rounded-full bg-border', i < step && 'bg-primary')} />
        ))}
      </div>
    </div>
  )
}

// Desktop 1280: the same steps as underlined tabs (design/ProgrammeDesktop .steps).
function DesktopSteps({ step }: { step: number }) {
  return (
    <nav aria-label="Application steps" className="border-b bg-card px-8">
      <ol className="flex h-14 items-stretch gap-8">
        {STEPS.map((s, i) => {
          const n = i + 1
          const state = n < step ? 'done' : n === step ? 'cur' : 'todo'
          return (
            <li
              key={s}
              aria-current={state === 'cur' ? 'step' : undefined}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 border-transparent text-sm text-muted-foreground',
                state === 'done' && 'text-foreground',
                state === 'cur' && 'border-primary font-semibold text-foreground',
              )}
            >
              <span
                className={cn(
                  'inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-xs font-medium',
                  state === 'done' && 'border-primary bg-primary text-primary-foreground',
                  state === 'cur' && 'border-[1.5px] border-primary text-primary',
                )}
              >
                {state === 'done' ? <Check className="size-3.5" strokeWidth={2} aria-label="Done" /> : n}
              </span>
              {s}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// Applicants: top bar and, while filling in the form, the five steps. Save and exit signs out;
// everything is saved as it's entered.
export function ApplyShell({
  step,
  app,
  children,
  footer,
}: {
  step?: number
  app?: MyApplication | null
  children: ReactNode
  footer?: ReactNode // mobile only: a sticky bar at the bottom (design/ProgrammeMobile "Continue")
}) {
  const desktop = useIsDesktop()
  const signOut = useSignOut()
  const inForm = step != null
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* The top bar and the steps stay in view while the page scrolls. */}
      <div className="sticky top-0 z-10 shrink-0">
        <header
          className={cn(
            'flex items-center justify-between border-b bg-card',
            desktop ? 'h-16 px-8' : 'h-14 pr-1 pl-4',
          )}
        >
          <div className="flex items-center gap-4">
            <Wordmark />
            {desktop && app && (
              <>
                <span aria-hidden className="h-5 w-px bg-border" />
                <span className="text-sm text-muted-foreground">Application · {app.intake}</span>
              </>
            )}
          </div>
          {inForm ? (
            <div className="flex items-center gap-4">
              {desktop && app?.reference && (
                <span className="text-sm text-muted-foreground">
                  Reference <span className="font-mono text-foreground">{app.reference}</span>
                </span>
              )}
              <Button variant={desktop ? 'outline' : 'ghost'} size={desktop ? 'sm' : 'default'} onClick={() => void signOut()}>
                Save and exit
              </Button>
            </div>
          ) : (
            app && (
              <div className="flex items-center gap-3">
                {desktop && <span className="text-sm">{app.name}</span>}
                <Initials initials={app.initials} />
                <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                  Sign out
                </Button>
              </div>
            )
          )}
        </header>
        {inForm && (desktop ? <DesktopSteps step={step} /> : <MobileSteps step={step} />)}
      </div>
      {children}
      {footer && !desktop && (
        <div className="sticky bottom-0 mt-auto flex flex-col gap-2 border-t bg-card px-4 pt-3 pb-4">{footer}</div>
      )}
    </div>
  )
}
