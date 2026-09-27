import { BookOpen, CalendarDays, FileText, Receipt } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useAnswerFeedback } from '@/api/generated/assistant/assistant'
import type { AnswerOut, AnswerSource } from '@/api/generated/model'
import { cn } from '@/lib/utils'
import { AnswerText } from './answer-text'
import { Handoff } from './handoff'

function SourceIcon({ href }: { href: string | null | undefined }) {
  const cls = 'size-4 shrink-0 text-muted-foreground'
  if (href?.startsWith('/deadlines') || href?.startsWith('/timetable')) return <CalendarDays className={cls} strokeWidth={1.5} aria-hidden />
  if (href?.startsWith('/library')) return <BookOpen className={cls} strokeWidth={1.5} aria-hidden />
  if (href?.startsWith('/fees')) return <Receipt className={cls} strokeWidth={1.5} aria-hidden />
  return <FileText className={cls} strokeWidth={1.5} aria-hidden />
}

function SourceLink({ s }: { s: AnswerSource }) {
  return s.href ? (
    <Link to={s.href} className="text-primary underline underline-offset-2">
      {s.label}
    </Link>
  ) : (
    <span>{s.label}</span>
  )
}

function Feedback({ id, desktop }: { id: number; desktop: boolean }) {
  const [sent, setSent] = useState<boolean | null>(null)
  const feedback = useAnswerFeedback()
  if (sent !== null) return <p className="text-sm text-muted-foreground">{sent ? 'Thanks.' : 'Thanks. This helps us fix missing answers.'}</p>
  const send = (helpful: boolean) => feedback.mutate({ messageId: id, data: { helpful } }, { onSuccess: () => setSent(helpful) })
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className={cn('text-muted-foreground', !desktop && 'grow')}>{desktop ? 'Helpful?' : 'Did this answer your question?'}</span>
      <Button variant="outline" size="sm" className={cn(!desktop && 'h-11')} disabled={feedback.isPending} onClick={() => send(true)}>
        Yes
      </Button>
      <Button variant="outline" size="sm" className={cn(!desktop && 'h-11')} disabled={feedback.isPending} onClick={() => send(false)}>
        No
      </Button>
    </span>
  )
}

export function Answer({ a, question, desktop }: { a: AnswerOut; question: string; desktop: boolean }) {
  return (
    <article className="flex flex-col gap-3">
      <AnswerText text={a.text} />
      {a.handoff && <Handoff question={question} sessionId={a.session_id} />}
      {a.sources.length > 0 &&
        (desktop ? (
          <div className="flex items-center justify-between gap-4 border-t pt-3 text-sm">
            <span className="flex flex-wrap items-center gap-2">
              <SourceIcon href={a.sources[0].href} />
              <span className="text-muted-foreground">Source{a.sources.length > 1 ? 's' : ''}:</span>
              {a.sources.map((s, i) => (
                <Fragment key={i}>
                  {i > 0 && <span aria-hidden>·</span>}
                  <SourceLink s={s} />
                </Fragment>
              ))}
            </span>
            <Feedback id={a.message_id} desktop />
          </div>
        ) : (
          <div className="flex flex-col gap-1 border-t pt-3">
            <span className="text-xs font-medium text-muted-foreground">Source{a.sources.length > 1 ? 's' : ''}</span>
            {a.sources.map((s, i) => (
              <span key={i} className="flex min-h-11 items-center gap-2 text-sm">
                <SourceIcon href={s.href} />
                <SourceLink s={s} />
              </span>
            ))}
          </div>
        ))}
      {/* No "did this answer it?" when it didn't: the Student Affairs card is the next step. */}
      {!a.handoff && !(desktop && a.sources.length > 0) && <Feedback id={a.message_id} desktop={desktop} />}
    </article>
  )
}
