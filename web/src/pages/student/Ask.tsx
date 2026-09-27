import { ArrowLeft, ArrowUp, BookOpen, CalendarDays, ChevronRight, CircleCheck, FileText, LoaderCircle, Receipt } from 'lucide-react'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DeskBar } from '@/components/shell/student-desktop'
import {
  getAssistantHomeQueryKey,
  useAnswerFeedback,
  useAssistantHome,
  useHandoffPreview,
  useSendToStudentAffairs,
} from '@/api/generated/assistant/assistant'
import type { AnswerOut, AnswerSource, AskHandoffOut } from '@/api/generated/model'
import { errorMessage } from '@/lib/api'
import { askStream } from '@/lib/ask-stream'
import { shortDate } from '@/lib/format'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'

// design/AskStart, AskChat, AskHandoff (phone) and DeskAsk (computer). The assistant only reads:
// the footer says so, and every answer shows where it came from.

type Turn = { question: string; status?: string; answer?: AnswerOut; error?: string }

const FOOTNOTE = "Reads your timetable, deadlines and loans. Can't change anything. Check the source link on each answer."

// Answers are short Markdown: paragraphs, numbered or bulleted lists, **bold** and `codes`.
// Rendered as React elements, never as HTML.
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <span key={i} className="font-semibold">
            {part.slice(2, -2)}
          </span>
        ) : part.startsWith('`') && part.endsWith('`') ? (
          <span key={i} className="font-mono">
            {part.slice(1, -1)}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function AnswerText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter((b) => b.trim())
        .map((block, i) => {
          const lines = block.split('\n').filter((l) => l.trim())
          if (lines.every((l) => /^\s*\d+[.)]\s/.test(l)))
            return (
              <ol key={i} className="flex flex-col gap-2">
                {lines.map((l, j) => (
                  <li key={j} className="grid grid-cols-[20px_minmax(0,1fr)] gap-1">
                    <span className="font-mono text-muted-foreground">{j + 1}</span>
                    <span>
                      <Inline text={l.replace(/^\s*\d+[.)]\s/, '')} />
                    </span>
                  </li>
                ))}
              </ol>
            )
          if (lines.every((l) => /^\s*[-*•]\s/.test(l)))
            return (
              <ul key={i} className="flex list-disc flex-col gap-2 pl-5">
                {lines.map((l, j) => (
                  <li key={j}>
                    <Inline text={l.replace(/^\s*[-*•]\s/, '')} />
                  </li>
                ))}
              </ul>
            )
          return (
            <p key={i}>
              <Inline text={lines.join(' ')} />
            </p>
          )
        })}
    </>
  )
}

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

// design/AskHandoff: the question goes to Student Affairs only when the student presses the button.
function Handoff({ question, sessionId }: { question: string; sessionId: string }) {
  const id = useId()
  const qc = useQueryClient()
  const [text, setText] = useState(question)
  const [sent, setSent] = useState<AskHandoffOut | null>(null)
  const preview = useHandoffPreview()
  const send = useSendToStudentAffairs()
  if (sent)
    return (
      <Alert variant="success" role="status">
        <CircleCheck strokeWidth={1.5} />
        <div className="flex flex-col gap-0.5">
          <p className="font-semibold">Sent to Student Affairs</p>
          <p className="text-sm">
            Reference <span className="font-mono">{sent.reference}</span>.{' '}
            {sent.sms_to ? "We'll text you when they reply." : 'Their reply will appear in Ask TCFL.'}
          </p>
        </div>
      </Alert>
    )
  const p = preview.data
  return (
    <>
      <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3 rounded-md border bg-card p-4">
        <h2 id={`${id}-h`} className="text-lg leading-6 font-semibold">
          Send your question to Student Affairs
        </h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-q`}>Your question</Label>
          <textarea
            id={`${id}-q`}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="rounded-sm border border-input bg-card px-3 py-2.5"
          />
        </div>
        {p && (
          <p className="text-sm text-muted-foreground">
            They'll see your name
            {p.student_number && (
              <>
                , <span className="font-mono">{p.student_number}</span>
              </>
            )}
            {p.class_group && ' and your class'}.{' '}
            {p.sms_to ? (
              <>
                Replies come by SMS to <span className="font-mono">{p.sms_to}</span> and appear in Ask TCFL.
              </>
            ) : (
              'Replies appear in Ask TCFL.'
            )}
          </p>
        )}
        {send.error && <p className="font-medium text-destructive">{errorMessage(send.error, 'Couldn’t send it. Try again.')}</p>}
        <Button
          block
          disabled={send.isPending || text.trim().length < 3}
          onClick={() =>
            send.mutate(
              { data: { question: text.trim(), session_id: sessionId } },
              {
                onSuccess: (r) => {
                  setSent(r)
                  void qc.invalidateQueries({ queryKey: getAssistantHomeQueryKey() })
                },
              },
            )
          }
        >
          Send to Student Affairs
        </Button>
      </section>
      <p className="text-sm text-muted-foreground">Or visit Student Affairs in Block A.</p>
    </>
  )
}

function Answer({ a, question, desktop }: { a: AnswerOut; question: string; desktop: boolean }) {
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

function Bubble({ children, desktop }: { children: React.ReactNode; desktop: boolean }) {
  return <div className={cn('self-end rounded-md bg-muted px-3.5 py-2.5 whitespace-pre-wrap', desktop ? 'max-w-[480px]' : 'max-w-[300px]')}>{children}</div>
}

function Composer({
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

export default function Ask() {
  const desktop = useIsDesktop()
  const home = useAssistantHome()
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const sessionId = [...turns].reverse().find((t) => t.answer)?.answer?.session_id

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [turns])
  useEffect(() => () => abort.current?.abort(), [])

  const update = (i: number, patch: Partial<Turn>) => setTurns((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  async function send(question: string) {
    const q = question.trim()
    if (q.length < 2 || busy) return
    const i = turns.length
    setTurns((ts) => [...ts, { question: q, status: 'Reading your question…' }])
    setDraft('')
    setBusy(true)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      await askStream(
        { question: q, session_id: sessionId },
        (e) => {
          if (e.type === 'status' && e.status) update(i, { status: e.status })
          if (e.type === 'answer' && e.answer) update(i, { answer: e.answer, status: undefined })
          if (e.type === 'error') update(i, { error: e.error ?? "Ask TCFL couldn't answer just now.", status: undefined })
        },
        ctrl.signal,
      )
    } catch (err) {
      if (ctrl.signal.aborted) update(i, { status: undefined, error: 'Stopped.' })
      else update(i, { status: undefined, error: errorMessage(err, "Ask TCFL couldn't answer just now. Try again in a minute.") })
    } finally {
      setBusy(false)
      abort.current = null
    }
  }

  const restart = () => {
    abort.current?.abort()
    setTurns([])
    setDraft('')
  }

  const start = (
    <>
      <div className="flex flex-col gap-2">
        <h1 className={desktop ? 'text-[28px] leading-9 font-semibold tracking-[-0.015em]' : 'text-2xl leading-8 font-semibold tracking-[-0.01em]'}>
          What do you need to know?
        </h1>
        <p className="text-muted-foreground">
          Ask about fees, timetables, tests, the library or college rules. Answers come from TCFL documents and your own timetable, and show
          where they came from.
        </p>
      </div>
      {home.data && (
        <section aria-labelledby="h-sug">
          <h2 id="h-sug" className="border-b pb-2 text-xs leading-4 font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            Other students often ask
          </h2>
          <ul className="divide-y">
            {home.data.suggestions.map((s) => (
              <li key={s}>
                <button type="button" onClick={() => void send(s)} className="flex min-h-[52px] w-full items-center gap-3 py-2 text-left">
                  <span className="grow">{s}</span>
                  <ChevronRight className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {home.data && home.data.sent.length > 0 && (
        <section aria-labelledby="h-sent" className="flex flex-col gap-2">
          <h2 id="h-sent" className="border-b pb-2 text-xs leading-4 font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            Your questions to Student Affairs
          </h2>
          <ul className="divide-y">
            {home.data.sent.map((q) => (
              <li key={q.reference} className="flex flex-col gap-1 py-3">
                <span className="text-sm text-muted-foreground">
                  <span className="font-mono">{q.reference}</span> · {shortDate(new Date(q.created_at))}
                </span>
                <span>{q.question}</span>
                {q.reply ? (
                  <p className="mt-1 border-l-2 border-primary pl-3">
                    <span className="block text-sm font-medium">Student Affairs replied{q.replied_at && `, ${shortDate(new Date(q.replied_at))}`}</span>
                    {q.reply}
                  </p>
                ) : (
                  <span className="text-sm text-muted-foreground">Waiting for a reply</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )

  const conversation = turns.map((t, i) => (
    <Fragment key={i}>
      <Bubble desktop={desktop}>{t.question}</Bubble>
      {t.answer && <Answer a={t.answer} question={t.question} desktop={desktop} />}
      {t.status && (
        <div className="flex flex-col gap-2" aria-label="Loading answer">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden />
            {t.status}
          </p>
          <span className="h-3 w-[90%] rounded-sm bg-muted" />
          <span className="h-3 w-[70%] rounded-sm bg-muted" />
        </div>
      )}
      {t.error && <p className={cn('text-sm', t.error === 'Stopped.' ? 'text-muted-foreground' : 'font-medium text-destructive')}>{t.error}</p>}
    </Fragment>
  ))

  const newQuestion = turns.length > 0 && (
    <Button variant="ghost" size={desktop ? 'sm' : 'default'} onClick={restart}>
      New question
    </Button>
  )
  const composer = (
    <Composer
      value={draft}
      onChange={setDraft}
      onSend={() => void send(draft)}
      onStop={() => abort.current?.abort()}
      busy={busy}
      first={turns.length === 0}
      desktop={desktop}
    />
  )

  if (desktop)
    return (
      <>
        <DeskBar left={<span className="font-semibold text-foreground">Ask TCFL</span>} right={newQuestion} />
        <main aria-live="polite" className="flex grow flex-col items-center px-8 pt-8">
          <div className="flex w-full max-w-[720px] flex-col gap-6 pb-6">
            {turns.length === 0 ? start : conversation}
            <div ref={endRef} />
          </div>
        </main>
        {composer}
      </>
    )

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-1 border-b bg-card pr-2 pl-1">
        <Link to="/" aria-label="Back to home" className="inline-flex size-11 items-center justify-center">
          <ArrowLeft className="size-5" strokeWidth={1.5} />
        </Link>
        <span className="grow font-semibold">Ask TCFL</span>
        {newQuestion}
      </header>
      <main aria-live="polite" className="flex grow flex-col gap-6 px-4 py-6">
        {turns.length === 0 ? start : conversation}
        <div ref={endRef} />
      </main>
      {composer}
    </div>
  )
}
