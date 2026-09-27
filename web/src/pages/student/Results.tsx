import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Download } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { SubPage } from '@/components/shell/sub-page'
import { Empty } from '@/components/student/section'
import type { TermResults } from '@/api/generated/model'
import { getResultsQueryKey, useRequestRemark, useResults } from '@/api/generated/records/records'
import { ApiError } from '@/lib/api'
import { formatLongDate } from '@/lib/format'
import { onDay } from '@/lib/records'
import { cn } from '@/lib/utils'

const longYear = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Africa/Harare',
})
const n = (x: number | null) => (x === null ? '–' : `${x}`)

function RemarkSheet({ term, open, onOpenChange }: { term: TermResults; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const reasonId = useId()
  const choices = term.modules.filter((m) => !m.remark_status)
  const [offering, setOffering] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const remark = useRequestRemark({
    mutation: {
      onSuccess: () => {
        toast('Re-mark request sent.')
        void qc.invalidateQueries({ queryKey: getResultsQueryKey() })
        onOpenChange(false)
        setOffering(null)
        setReason('')
      },
    },
  })
  const error = remark.error instanceof ApiError ? remark.error.message : remark.error ? 'Could not send. Try again.' : null
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="gap-4 rounded-t-xl px-4 pt-2 pb-6">
        <span aria-hidden className="h-1 w-10 self-center rounded-full bg-border-strong" />
        <SheetHeader className="p-0">
          <SheetTitle className="text-lg leading-6 font-semibold">Ask for a re-mark</SheetTitle>
          <SheetDescription>
            Until {formatLongDate(onDay(term.remark_until ?? ''))}. Say which question or mark you think is wrong.
          </SheetDescription>
        </SheetHeader>
        {choices.length === 0 ? (
          <p>You've already asked for a re-mark of every module.</p>
        ) : (
          <>
            <div role="radiogroup" aria-label="Module" className="flex flex-col [&>*+*]:border-t">
              {choices.map((m) => (
                <button
                  key={m.offering_id}
                  type="button"
                  role="radio"
                  aria-checked={offering === m.offering_id}
                  onClick={() => setOffering(m.offering_id)}
                  className="flex min-h-12 items-center gap-3 text-left"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-input bg-card',
                      offering === m.offering_id && 'border-primary after:size-2.5 after:rounded-full after:bg-primary',
                    )}
                  />
                  <span>
                    <span className="font-mono">{m.module_code}</span> {m.module_name}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={reasonId}>Why do you think the mark is wrong?</Label>
              <Textarea id={reasonId} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
            </div>
            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <Button
              block
              disabled={!offering || reason.trim().length < 10 || remark.isPending}
              onClick={() => offering && remark.mutate({ data: { offering_id: offering, reason } })}
            >
              Send request
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Term({ t }: { t: TermResults }) {
  const [open, setOpen] = useState(false)
  const failed = t.modules.filter((m) => m.is_pass === false)
  const canRemark = t.remark_until !== null && onDay(t.remark_until) >= new Date(new Date().toDateString())
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">{t.term_name}</h1>
        {t.published_at && (
          <p className="text-muted-foreground">Published {longYear.format(new Date(t.published_at)).replace(',', '')}</p>
        )}
      </div>

      {failed.length === 0 ? (
        <Alert variant="success">
          <CircleCheck strokeWidth={1.5} />
          <p>
            You passed all {t.modules.length} {t.modules.length === 1 ? 'module' : 'modules'}.
          </p>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <CircleAlert strokeWidth={1.5} />
          <p>
            You didn't pass {failed.map((m) => m.module_code).join(', ')}. Ask Student Affairs what happens next.
          </p>
        </Alert>
      )}

      <section aria-labelledby="h-mods">
        <h2 id="h-mods" className="border-b pb-2 text-lg leading-6 font-semibold">
          Modules
        </h2>
        <ul className="[&>li+li]:border-t">
          {t.modules.map((m) => (
            <li key={m.offering_id} className="flex flex-col gap-1.5 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">
                  <span className="font-mono">{m.module_code}</span> {m.module_name}
                </span>
                <span className="font-mono font-semibold">{m.final_mark === null ? '–' : `${m.final_mark}%`}</span>
              </div>
              <div className="flex justify-between gap-3 text-sm text-muted-foreground">
                <span>
                  Coursework <span className="font-mono">{n(m.coursework_mark)}</span> · Exam{' '}
                  <span className="font-mono">{n(m.exam_mark)}</span>
                  {m.remark_status && ' · re-mark requested'}
                </span>
                {m.is_pass !== null && (
                  <span className={m.is_pass ? 'text-success' : 'font-medium text-destructive'}>
                    {m.is_pass ? 'Pass' : 'Fail'}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-muted-foreground">
        {t.notice}
        {canRemark && t.remark_until && (
          <> Think a mark is wrong? You can ask for a re-mark until {formatLongDate(onDay(t.remark_until))}.</>
        )}
      </p>

      <div className="mt-auto flex flex-col gap-3">
        <Button variant="outline" block asChild>
          <a href={`/api/student/results/${t.term_code}/slip.pdf`}>
            <Download strokeWidth={1.5} />
            Download results slip (PDF)
          </a>
        </Button>
        {canRemark && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-primary"
          >
            Ask for a re-mark
          </button>
        )}
      </div>
      <RemarkSheet term={t} open={open} onOpenChange={setOpen} />
    </>
  )
}

export default function Results() {
  const { data, isPending, isError } = useResults()
  const latest = data?.terms[0]
  return (
    <SubPage title={<span className="font-semibold">Results</span>} back="/more" backLabel="Back">
      <main className="flex grow flex-col gap-6 px-4 py-6">
        {isPending && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-16" />
            <Skeleton className="h-40" />
          </div>
        )}
        {isError && <Empty>Couldn't load your results. Check your connection.</Empty>}
        {data && !data.current_published && (
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">
              {data.current_term_name ?? 'Results'}
            </h1>
            <p className="text-muted-foreground">Not yet published. Your results appear here as soon as they are.</p>
          </div>
        )}
        {latest && <Term t={latest} />}
      </main>
    </SubPage>
  )
}
