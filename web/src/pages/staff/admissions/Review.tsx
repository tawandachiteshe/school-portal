import { useQueryClient } from '@tanstack/react-query'
import { Check, CircleAlert, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { ApplicationStatus, Decision, Review as ReviewData, Sitting } from '@/api/generated/model'
import {
  getDocumentFileUrl,
  getQueueQueryKey,
  getQueueSummaryQueryKey,
  getReviewQueryKey,
  useAddNote,
  useAssignToMe,
  useDecide,
  useMarkIdentityChecked,
  useMarkZimsecVerified,
  useResolveFlag,
  useReview,
  useSendMessage,
} from '@/api/generated/admissions/admissions'
import { ApiError } from '@/lib/api'
import { shortDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from '../teaching/staff-ui'

const STATUS: Record<ApplicationStatus, { label: string; variant: 'neutral' | 'info' | 'success' | 'destructive' }> = {
  draft: { label: 'Draft', variant: 'neutral' },
  submitted: { label: 'Submitted', variant: 'neutral' },
  in_review: { label: 'In review', variant: 'info' },
  more_info: { label: 'Waiting for applicant', variant: 'neutral' },
  accepted: { label: 'Offered a place', variant: 'success' },
  rejected: { label: 'Declined', variant: 'destructive' },
  withdrawn: { label: 'Withdrawn', variant: 'neutral' },
}
const TAB_NAME = { to_review: 'to review', needs_checking: 'to check', waiting: 'waiting', decided: 'decided' }
const NUMBER = ['no', 'one', 'two', 'three', 'four', 'five', 'six']

const withYear = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Africa/Harare',
})
const dayMonthTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Africa/Harare',
})
const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
// "Mon 12 Oct 2026, 14:05"
const sep = (s: string) => s.replace('Sept', 'Sep')
const submittedText = (d: Date) => sep(withYear.format(d).replace(/,/g, '').replace(/ (\d\d:\d\d)$/, ', $1'))
const fileUrl = (id: string) => `/api${getDocumentFileUrl(id)}`
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

function useRefresh(reference: string) {
  const qc = useQueryClient()
  return (r: ReviewData) => {
    qc.setQueryData(getReviewQueryKey(reference), r)
    void qc.invalidateQueries({ queryKey: getQueueQueryKey() })
    void qc.invalidateQueries({ queryKey: getQueueSummaryQueryKey() })
  }
}

function Section({ id, title, aside, meta, children }: { id: string; title: string; aside?: React.ReactNode; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id={id} className="text-xl leading-7 font-semibold">
            {title}
          </h2>
          {meta && <p className="text-sm text-muted-foreground">{meta}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

type TextDialogProps = {
  title: string
  description: React.ReactNode
  label: string
  required: boolean
  maxLength: number
  action: string
  destructive?: boolean
  pending: boolean
  warnings?: string[]
  onCancel: () => void
  onSubmit: (text: string) => void
}

// Mounted only while the dialog is open, so the text starts empty each time.
function TextDialogBody(p: TextDialogProps) {
  const id = useId()
  const [text, setText] = useState('')
  return (
    <>
      <DialogTitle>{p.title}</DialogTitle>
      <DialogDescription>{p.description}</DialogDescription>
      {!!p.warnings?.length && (
        <ul className="flex flex-col gap-1 text-sm">
          {p.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-urgent" strokeWidth={1.5} aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{p.label}</Label>
        <Textarea id={id} rows={4} maxLength={p.maxLength} value={text} onChange={(e) => setText(e.target.value)} />
        {p.maxLength <= 160 && (
          <span className="text-xs text-muted-foreground">
            <span className="font-mono">{text.length}</span>/{p.maxLength} characters
          </span>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={p.onCancel}>
          Cancel
        </Button>
        <Button
          variant={p.destructive ? 'destructive' : 'default'}
          disabled={p.pending || (p.required && !text.trim())}
          onClick={() => p.onSubmit(text)}
        >
          {p.action}
        </Button>
      </DialogFooter>
    </>
  )
}

// A textarea dialog for decisions, SMS and resolving checks.
function TextDialog({ open, onOpenChange, ...p }: { open: boolean; onOpenChange: (o: boolean) => void } & Omit<TextDialogProps, 'onCancel'>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <TextDialogBody {...p} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Results({ r, s, first }: { r: ReviewData; s: Sitting; first: boolean }) {
  const refresh = useRefresh(r.reference)
  const verify = useMarkZimsecVerified({
    mutation: { onSuccess: refresh, onError: (e) => toast(errText(e, "Couldn't save. Try again.")) },
  })
  const id = `zs-${s.id}`
  const unclear = s.rows.filter((x) => x.read === 'unclear_confirmed').length
  return (
    <Section
      id={id}
      title={first ? 'ZIMSEC results' : `${s.session === 'JUNE' ? 'June' : 'November'} ${s.year} resit`}
      meta={
        <>
          {s.level}-Level, {s.session === 'JUNE' ? 'June' : 'November'} {s.year} · Centre{' '}
          <span className="font-mono text-foreground">{s.centre_number}</span> · Candidate{' '}
          <span className="font-mono text-foreground">{s.candidate_number}</span>
        </>
      }
      aside={
        s.verification === 'verified' ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
            <Check className="size-4" strokeWidth={1.5} aria-hidden />
            Verified with ZIMSEC{s.verified_at && `, ${shortDateTime(new Date(s.verified_at))}`}
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={verify.isPending}
            onClick={() => verify.mutate({ reference: r.reference, sittingId: s.id })}
          >
            Mark verified with ZIMSEC
          </Button>
        )
      }
    >
      <Table
        head={
          <>
            <th className={cn(th, 'w-[72px]')}>Code</th>
            <th className={th}>Subject</th>
            <th className={cn(th, 'w-[72px]')}>Grade</th>
            <th className={th}>How it was read</th>
          </>
        }
      >
        {s.rows.map((x) => (
          <tr key={x.subject}>
            <td className={cn(td, 'font-mono')}>{x.code ?? '—'}</td>
            <td className={td}>{x.subject}</td>
            <td className={cn(td, 'font-mono font-semibold')}>{x.grade}</td>
            <td className={td}>
              {x.read === 'clear' ? (
                <span className="text-muted-foreground">Clear</span>
              ) : (
                <>
                  <span className="font-medium text-urgent">
                    {x.read === 'unclear_confirmed'
                      ? `Unclear, applicant confirmed ${x.grade}`
                      : `Changed by applicant (read as ${x.read_as ?? '?'})`}
                  </span>
                  {s.document_id && (
                    <>
                      {' · '}
                      <a href={fileUrl(s.document_id)} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                        View slip
                      </a>
                    </>
                  )}
                </>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {first && (
        <p className="text-sm text-muted-foreground">
          {s.verification === 'verified' ? 'Checked against ZIMSEC records.' : 'Not yet checked against ZIMSEC records.'}
          {r.unclear_count > 0 &&
            (r.unclear_decides
              ? ` The ${r.unclear_count === 1 ? 'unclear grade could' : 'unclear grades could'} change eligibility: check against the slip.`
              : ` The ${NUMBER[r.unclear_count] ?? r.unclear_count} unclear ${r.unclear_count === 1 ? "grade doesn't" : "grades don't"} change eligibility either way.`)}
        </p>
      )}
      {!first && unclear > 0 && <p className="text-sm text-muted-foreground">{unclear} unclear on this slip.</p>}
    </Section>
  )
}

function ReviewView({ r }: { r: ReviewData }) {
  const refresh = useRefresh(r.reference)
  const ids = { el: useId(), id: useId(), ct: useId(), act: useId(), note: useId() }
  const onError = (e: unknown) => toast(errText(e, "Couldn't save. Try again."))
  const [dialog, setDialog] = useState<Decision | 'sms' | null>(null)
  const [resolving, setResolving] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const open = ['submitted', 'in_review', 'more_info'].includes(r.status)

  // Opening an unassigned application takes it (and moves it to "In review").
  const assign = useAssignToMe({ mutation: { onSuccess: refresh } })
  const took = useRef(false)
  useEffect(() => {
    if (!took.current && ['submitted', 'in_review'].includes(r.status) && !r.assigned_to) {
      took.current = true
      assign.mutate({ reference: r.reference })
    }
  }, [r, assign])

  const identity = useMarkIdentityChecked({ mutation: { onSuccess: refresh, onError } })
  const resolve = useResolveFlag({
    mutation: {
      onSuccess: (x) => {
        refresh(x)
        setResolving(null)
        toast('Marked as checked.')
      },
      onError,
    },
  })
  const addNote = useAddNote({
    mutation: {
      onSuccess: (x) => {
        refresh(x)
        setNote('')
      },
      onError,
    },
  })
  const sms = useSendMessage({
    mutation: {
      onSuccess: () => {
        setDialog(null)
        toast('SMS queued. It goes out when the SMS service sends its next batch.')
      },
      onError,
    },
  })
  const decide = useDecide({
    mutation: {
      onSuccess: (x, v) => {
        refresh(x)
        setDialog(null)
        toast(
          v.data.decision === 'offer'
            ? `${r.name} has been offered a place.`
            : v.data.decision === 'decline'
              ? 'Application declined. The applicant has been told.'
              : 'Sent. The application waits for the applicant.',
        )
      },
      onError,
    },
  })

  const idn = r.identity
  const status = STATUS[r.status]
  const warnings = [
    ...(!r.eligibility.eligible ? [`Entry requirements not met: ${r.eligibility.summary}.`] : []),
    ...(!idn.checked_by ? ['Identity not marked checked.'] : []),
    ...r.flags.map((f) => `Not checked: ${f.text}.`),
  ]
  const first = r.name.split(' ')[0]

  return (
    <>
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b bg-card px-8">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
          <Link to={`/staff/admissions${r.nav && r.nav.tab !== 'to_review' ? `?tab=${r.nav.tab}` : ''}`} className="text-primary hover:underline">
            Applications
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono">{r.reference}</span>
        </nav>
        {r.nav && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {r.nav.position} of {r.nav.total} {TAB_NAME[r.nav.tab]}
            </span>
            {(['previous', 'next'] as const).map((k) =>
              r.nav?.[k] ? (
                <Button key={k} variant="outline" size="sm" asChild>
                  <Link to={`/staff/admissions/${r.nav[k]}`}>{k === 'previous' ? 'Previous' : 'Next'}</Link>
                </Button>
              ) : (
                <Button key={k} variant="outline" size="sm" disabled>
                  {k === 'previous' ? 'Previous' : 'Next'}
                </Button>
              ),
            )}
          </div>
        )}
      </header>

      {/* The applicant and the decision buttons stay in view under the top bar while the page scrolls. */}
      <div className="sticky top-14 z-[5] flex items-start justify-between gap-6 border-b bg-background px-8 pt-6 pb-5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className={staffH1}>{r.name}</h1>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {r.programme}
            {r.submitted_at && ` · Submitted ${submittedText(new Date(r.submitted_at))}`}
            {r.assigned_to && ` · ${r.assigned_to_me ? 'Assigned to you' : `Assigned to ${r.assigned_to}`}`}
          </p>
        </div>
        {open && (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => setDialog('ask')}>
              Ask for information
            </Button>
            <Button variant="destructive" onClick={() => setDialog('decline')}>
              Decline
            </Button>
            <Button onClick={() => setDialog('offer')}>Offer a place</Button>
          </div>
        )}
      </div>

      <main className="flex flex-col gap-6 px-8 py-6">
        {(r.status === 'accepted' || r.status === 'rejected') && (
          <Alert variant={r.status === 'accepted' ? 'success' : 'default'}>
            {r.status === 'accepted' ? <Check strokeWidth={1.5} /> : <CircleAlert strokeWidth={1.5} />}
            <p>
              <span className="font-semibold">
                {r.status === 'accepted' ? 'Offered a place' : 'Declined'}
                {r.decided_by && ` by ${r.decided_by}`}
                {r.decided_at && `, ${shortDateTime(new Date(r.decided_at))}`}.
              </span>
              {r.decision_reason && ` “${r.decision_reason}”`}
            </p>
          </Alert>
        )}

        {r.flags.length > 0 && (
          <Alert variant={r.flags.some((f) => f.severity === 'high' || f.severity === 'block') ? 'destructive' : 'urgent'}>
            <TriangleAlert strokeWidth={1.5} />
            <div className="flex grow flex-col gap-2">
              <p className="font-semibold">Check before deciding</p>
              <ul className="flex flex-col gap-1.5">
                {r.flags.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-4">
                    <span>{f.text}</span>
                    <Button variant="outline" size="sm" onClick={() => setResolving(f.id)}>
                      Mark checked
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </Alert>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-10">
          <div className="flex flex-col gap-8">
            <Section
              id={ids.el}
              title="Entry requirements"
              aside={
                r.eligibility.eligible ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                    <Check className="size-4" strokeWidth={1.5} aria-hidden />
                    All met
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
                    <CircleAlert className="size-4" strokeWidth={1.5} aria-hidden />
                    {r.eligibility.summary}
                  </span>
                )
              }
            >
              <Table
                head={
                  <>
                    <th className={th}>Requirement</th>
                    <th className={th}>Needed</th>
                    <th className={th}>Applicant</th>
                    <th className={cn(th, 'w-20')}>Result</th>
                  </>
                }
              >
                {r.eligibility.rows.map((x) => (
                  <tr key={x.label}>
                    <td className={td}>{x.label}</td>
                    <td className={cn(td, 'font-mono')}>{x.needed}</td>
                    <td className={cn(td, 'font-mono')}>{x.applicant}</td>
                    <td className={cn(td, x.met ? 'text-success' : 'font-medium text-destructive')}>{x.met ? 'Met' : 'Not met'}</td>
                  </tr>
                ))}
              </Table>
            </Section>

            <Section
              id={ids.id}
              title="Identity"
              aside={
                idn.checked_by ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                    <Check className="size-4" strokeWidth={1.5} aria-hidden />
                    Checked by {idn.checked_by}
                  </span>
                ) : (
                  idn.document_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={identity.isPending}
                      onClick={() => identity.mutate({ reference: r.reference })}
                    >
                      Mark identity checked
                    </Button>
                  )
                )
              }
            >
              <div className="grid grid-cols-[240px_minmax(0,1fr)] items-start gap-6">
                {idn.document_id ? (
                  <figure className="flex flex-col gap-1.5">
                    <img
                      src={fileUrl(idn.document_id)}
                      alt="Photo of the front of the National ID"
                      className="h-[152px] w-60 rounded-md border bg-muted object-cover"
                    />
                    <figcaption className="text-xs text-muted-foreground">
                      {idn.capture_device && `Taken on ${idn.capture_device}`}
                      {idn.captured_at && `, ${sep(dayMonthTime.format(new Date(idn.captured_at)))}`} ·{' '}
                      <a href={fileUrl(idn.document_id)} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                        Open full size
                      </a>
                    </figcaption>
                  </figure>
                ) : (
                  <p className="text-sm text-muted-foreground">No ID photo.</p>
                )}
                <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
                  <dt className="text-muted-foreground">ID number</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base">{idn.id_number ?? '—'}</span>
                    {idn.check_letter_valid != null &&
                      (idn.check_letter_valid ? (
                        <Badge variant="success">Check letter valid</Badge>
                      ) : (
                        <Badge variant="destructive">Check letter doesn't match</Badge>
                      ))}
                  </dd>
                  <dt className="text-muted-foreground">Name on ID</dt>
                  <dd>{idn.name_on_id ?? '—'}</dd>
                  <dt className="text-muted-foreground">Name on ZIMSEC slip</dt>
                  <dd className="flex items-center gap-2">
                    {idn.name_on_slip ?? '—'}
                    {idn.names_match === true && (
                      <span className="inline-flex items-center gap-1 text-success">
                        <Check className="size-4" strokeWidth={1.5} aria-hidden />
                        matches
                      </span>
                    )}
                    {idn.names_match === false && <span className="font-medium text-urgent">differs</span>}
                  </dd>
                  <dt className="text-muted-foreground">Date of birth</dt>
                  <dd>
                    {idn.date_of_birth ? longDate.format(new Date(`${idn.date_of_birth}T12:00:00`)) : '—'}
                    {idn.age_at_intake != null && <span className="text-muted-foreground"> · {idn.age_at_intake} at intake</span>}
                  </dd>
                  <dt className="text-muted-foreground">Registration</dt>
                  <dd>
                    {[idn.registered_in && `Registered in ${idn.registered_in}`, idn.origin && `Origin ${idn.origin}`]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </dd>
                  <dt className="text-muted-foreground">Edited by applicant</dt>
                  <dd className={cn(!idn.edited.length && 'text-muted-foreground', idn.edited.length && 'font-medium text-urgent')}>
                    {idn.edited.length ? `Changed ${idn.edited.join(', ')} after reading` : 'Nothing changed after reading'}
                  </dd>
                </dl>
              </div>
            </Section>

            {r.sittings.map((s, i) => (
              <Results key={s.id} r={r} s={s} first={i === 0} />
            ))}
            {!r.sittings.length && <p className="text-muted-foreground">No ZIMSEC results on this application.</p>}
          </div>

          <aside className="flex flex-col gap-7">
            <section aria-labelledby={ids.ct} className="flex flex-col gap-2">
              <h2 id={ids.ct} className="font-semibold">
                Contact
              </h2>
              {r.contact.phone_masked ? (
                <>
                  <p className="text-sm">
                    <span className="font-mono">{r.contact.phone_masked}</span>
                    {r.contact.verified && <span className="text-muted-foreground"> · verified</span>}
                  </p>
                  <button
                    type="button"
                    onClick={() => setDialog('sms')}
                    className="min-h-8 self-start text-sm font-medium text-primary hover:underline"
                  >
                    Send an SMS
                  </button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No phone number. They see messages in the portal.</p>
              )}
            </section>

            <section aria-labelledby={ids.act} className="flex flex-col gap-2">
              <h2 id={ids.act} className="font-semibold">
                Activity
              </h2>
              <ol className="border-t text-sm [&>li+li]:border-t">
                {r.activity.map((a, i) => (
                  <li key={i} className="py-2">
                    {a.note ? (
                      <>
                        <div className="text-xs text-muted-foreground">Note from {a.by}</div>
                        <div className="whitespace-pre-line">{a.text}</div>
                      </>
                    ) : (
                      <div>{a.text}</div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {shortDateTime(new Date(a.at))}
                      {a.via && ` · ${a.via}`}
                      {!a.note && a.by && ` · ${a.by}`}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="font-semibold">
                <label htmlFor={ids.note}>Internal note</label>
              </h2>
              <Textarea
                id={ids.note}
                rows={4}
                className="text-sm"
                placeholder="Only admissions staff can see this"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!note.trim() || addNote.isPending}
                  onClick={() => addNote.mutate({ reference: r.reference, data: { text: note } })}
                >
                  Add note
                </Button>
              </div>
            </section>
          </aside>
        </div>
      </main>

      <TextDialog
        open={dialog === 'offer'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Offer ${r.name} a place?`}
        description={`On the ${r.programme}. ${first} gets an SMS and sees the offer in the portal.`}
        label="Message to the applicant (optional)"
        required={false}
        maxLength={1000}
        action="Offer a place"
        pending={decide.isPending}
        warnings={warnings}
        onSubmit={(message) => decide.mutate({ reference: r.reference, data: { decision: 'offer', message } })}
      />
      <TextDialog
        open={dialog === 'decline'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Decline ${r.name}'s application?`}
        description={`${first} sees your reason in the portal and gets an SMS. This can't be undone here.`}
        label="Reason (the applicant sees this)"
        required
        maxLength={1000}
        action="Decline"
        destructive
        pending={decide.isPending}
        onSubmit={(message) => decide.mutate({ reference: r.reference, data: { decision: 'decline', message } })}
      />
      <TextDialog
        open={dialog === 'ask'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Ask for information"
        description={`The application waits in "Waiting for applicant" until ${first} replies.`}
        label="What do you need? (the applicant sees this)"
        required
        maxLength={1000}
        action="Send"
        pending={decide.isPending}
        onSubmit={(message) => decide.mutate({ reference: r.reference, data: { decision: 'ask', message } })}
      />
      <TextDialog
        open={dialog === 'sms'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Send ${first} an SMS`}
        description={`To ${r.contact.phone_masked}. It's also kept in the application's activity.`}
        label="Message"
        required
        maxLength={160}
        action="Send SMS"
        pending={sms.isPending}
        onSubmit={(text) => sms.mutate({ reference: r.reference, data: { text } })}
      />
      <TextDialog
        open={resolving != null}
        onOpenChange={(o) => !o && setResolving(null)}
        title="Mark as checked"
        description={r.flags.find((f) => f.id === resolving)?.text}
        label="What did you find?"
        required
        maxLength={500}
        action="Mark checked"
        pending={resolve.isPending}
        onSubmit={(resolution) =>
          resolving != null && resolve.mutate({ reference: r.reference, flagId: resolving, data: { resolution } })
        }
      />
    </>
  )
}

// design/StaffReview
export default function Review() {
  const { reference = '' } = useParams()
  const { data, isPending, error } = useReview(reference)
  if (isPending) return <Skeleton className="m-8 h-96" />
  if (error || !data)
    return (
      <p className="p-8 text-muted-foreground">
        {errText(error, "Couldn't open this application.")}{' '}
        <Link to="/staff/admissions" className="text-primary underline">
          Back to applications
        </Link>
      </p>
    )
  return <ReviewView key={data.id} r={data} />
}
