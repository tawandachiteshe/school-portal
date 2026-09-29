import { ArrowLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { DeskBar } from '@/components/shell/student-desktop'
import { useAssistantHome } from '@/api/generated/assistant/assistant'
import type { AnswerOut } from '@/api/generated/model'
import { errorMessage } from '@/lib/api'
import { askStream } from '@/lib/ask-stream'
import { shortDate } from '@/lib/format'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { Answer } from '@/components/ask/answer'
import { Composer } from '@/components/ask/composer'

// design/AskStart, AskChat, AskHandoff (phone) and DeskAsk (computer). The assistant only reads:
// the footer says so, and every answer shows where it came from.

type Turn = { question: string; status?: string; answer?: AnswerOut; error?: string }

function Bubble({ children, desktop }: { children: React.ReactNode; desktop: boolean }) {
  return <div className={cn('self-end rounded-md bg-muted px-3.5 py-2.5 whitespace-pre-wrap', desktop ? 'max-w-[480px]' : 'max-w-[300px]')}>{children}</div>
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
          if (e.type === 'error') update(i, { error: e.error ?? "Ask Campus couldn't answer just now.", status: undefined })
        },
        ctrl.signal,
      )
    } catch (err) {
      if (ctrl.signal.aborted) update(i, { status: undefined, error: 'Stopped.' })
      else update(i, { status: undefined, error: errorMessage(err, "Ask Campus couldn't answer just now. Try again in a minute.") })
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
          Ask about fees, timetables, tests, the library or college rules. Answers come from college documents and your own timetable, and show
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
        <DeskBar left={<span className="font-semibold text-foreground">Ask Campus</span>} right={newQuestion} />
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
        <span className="grow font-semibold">Ask Campus</span>
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
