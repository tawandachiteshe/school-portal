import { ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'

const FOOTNOTE = "Reads your timetable, deadlines and loans. Can't change anything. Check the source link on each answer."

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  first,
  desktop,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  busy: boolean
  first: boolean
  desktop: boolean
}) {
  const ready = value.trim().length >= 2 && !busy
  return (
    <div className={cn('sticky bottom-0 flex flex-col gap-2 bg-background pt-2 pb-3', desktop ? 'items-center pb-6' : 'px-3')}>
      <form
        className={cn('flex flex-col gap-1 rounded-2xl border border-input bg-card py-3 pr-2 pl-4 focus-within:border-primary', desktop && 'w-full max-w-[720px]')}
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onSend()
        }}
      >
        <label htmlFor="ask-q" className="sr-only">
          Your question
        </label>
        <textarea
          id="ask-q"
          rows={first || desktop ? 2 : 1}
          value={value}
          maxLength={1000}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends on a computer; on a phone it's a new line.
            if (desktop && e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (ready) onSend()
            }
          }}
          placeholder={first ? 'Ask about fees, tests, the library…' : 'Ask a follow-up'}
          className="resize-none bg-transparent pr-2 text-base leading-6 outline-none placeholder:text-muted-foreground"
        />
        <div className="flex justify-end">
          {busy ? (
            <button
              type="button"
              aria-label="Stop answering"
              onClick={onStop}
              className="inline-flex size-11 items-center justify-center rounded-xl bg-foreground text-background"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send question"
              disabled={!ready}
              className={cn(
                'inline-flex size-11 items-center justify-center rounded-xl',
                ready ? 'bg-primary text-primary-foreground' : 'cursor-not-allowed bg-muted text-muted-foreground',
              )}
            >
              <ArrowUp className="size-5" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </form>
      <p className="text-center text-xs text-muted-foreground">{FOOTNOTE}</p>
    </div>
  )
}
