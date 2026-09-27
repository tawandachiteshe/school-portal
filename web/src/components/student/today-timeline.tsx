import type { TodayClass } from '@/lib/student'
import { time } from '@/lib/format'
import { cn } from '@/lib/utils'

function minutesUntil(d: Date, now: Date) {
  return Math.max(0, Math.round((d.getTime() - now.getTime()) / 60_000))
}

function inWords(mins: number) {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

// "Test 1: Signals and modulation" → "Test 1"
const shortAssessment = (title: string) => title.split(':')[0]

const KIND: Record<string, string> = { lecture: 'Lecture', tutorial: 'Tutorial', lab: 'Lab', consultation: 'Consultation' }

// design/Main "Today": a timeline of the day's classes. The first class that hasn't ended is
// highlighted as current ("Now") or next ("Next · starts in 20 min").
export function TodayTimeline({ classes, now }: { classes: TodayClass[]; now: Date }) {
  const current = classes.findIndex((c) => !c.cancelled && new Date(c.ends_at) > now)
  return (
    <ol className="flex flex-col">
      {classes.map((c, i) => {
        const start = new Date(c.starts_at)
        const end = new Date(c.ends_at)
        const finished = end <= now
        const isCurrent = i === current
        const started = start <= now
        const what = c.assessment_title ? shortAssessment(c.assessment_title) : KIND[c.kind] ?? c.kind
        const where = [c.venue, c.lecturer].filter(Boolean).join(' · ')
        return (
          <li
            key={`${c.module_code}-${c.starts_at}`}
            aria-current={isCurrent ? 'true' : undefined}
            className={cn(
              '-mx-2 grid grid-cols-[48px_12px_minmax(0,1fr)] gap-x-3 px-2',
              finished && 'text-muted-foreground',
              isCurrent && 'rounded-md bg-primary-soft',
            )}
          >
            <div className={cn('flex flex-col py-3 font-mono text-sm', isCurrent && 'font-medium text-primary')}>
              <span>{time(start)}</span>
              <span className={cn(!finished && 'text-muted-foreground', isCurrent && 'font-normal')}>{time(end)}</span>
            </div>
            <div className="flex flex-col items-center" aria-hidden>
              <span className={cn('h-[18px] w-px', i === 0 ? 'bg-transparent' : 'bg-border')} />
              <span
                className={cn(
                  'size-[9px] shrink-0 rounded-full border-[1.5px]',
                  finished ? 'border-border-strong' : 'border-foreground',
                  isCurrent && 'border-primary bg-primary',
                )}
              />
              <span className={cn('w-px grow', i === classes.length - 1 ? 'bg-transparent' : 'bg-border')} />
            </div>
            <div className="flex flex-col gap-0.5 py-3">
              {c.cancelled ? (
                <>
                  <div className="text-sm font-medium text-destructive">
                    Cancelled{c.change_reason ? ` · ${c.change_reason}` : ''}
                  </div>
                  <div className="font-medium text-muted-foreground line-through">
                    <span className="font-mono">{c.module_code}</span> {c.module_name}
                  </div>
                </>
              ) : finished ? (
                <>
                  <div className="text-sm">
                    <span className="font-mono">{c.module_code}</span> · Finished
                  </div>
                  <div className="font-medium">{c.module_name}</div>
                  <div className="text-sm">{where}</div>
                </>
              ) : (
                <>
                  {isCurrent && (
                    <div className="text-sm font-medium text-primary">
                      {started
                        ? `Now · ends in ${inWords(minutesUntil(end, now))}`
                        : `Next · starts in ${inWords(minutesUntil(start, now))}`}
                    </div>
                  )}
                  <div className="font-medium">
                    <span className="font-mono">{c.module_code}</span> {c.module_name}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {isCurrent || c.assessment_title ? [what, where].filter(Boolean).join(' · ') : where}
                  </div>
                </>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
