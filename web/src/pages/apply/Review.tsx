import { CircleAlert, CircleCheck } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApplyShell } from '@/components/shell/apply-shell'
import type { ApplicantReview, ApplyStep, MyApplication } from '@/api/generated/model'
import { useMyApplication } from '@/api/generated/apply/apply'
import { useApplicationReview } from '@/api/generated/apply-review/apply-review'
import { useSignOut } from '@/lib/auth'
import { dateWithYear, onDay } from '@/lib/format'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { applyHome, STEP_PATH } from './common'

const dob = (d?: string | null) => (d ? dateWithYear(onDay(d)) : '—')
const MISSING: Record<string, string> = {
  national_id: 'Add your National ID',
  birth_certificate: 'Add your birth certificate',
  results: 'Add your ZIMSEC results',
}

function Section({ title, edit, editLabel, children }: { title: string; edit?: string; editLabel: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col">
      <div className="flex min-h-11 items-center justify-between border-b">
        <h2 className="text-lg leading-6 font-semibold">{title}</h2>
        {edit && (
          <Link to={edit} aria-label={editLabel} className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
            Edit
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

// Label over value on a phone, side by side on a computer.
function Rows({ rows, desktop }: { rows: [string, React.ReactNode, boolean?][]; desktop: boolean }) {
  return (
    <dl className="[&>div+div]:border-t">
      {rows.map(([k, v, mono]) => (
        <div key={k} className={desktop ? 'grid grid-cols-[160px_minmax(0,1fr)] py-2.5' : 'flex flex-col py-3'}>
          <dt className={cn('text-muted-foreground', !desktop && 'text-sm')}>{k}</dt>
          <dd className={cn(mono && 'font-mono')}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Sections({ r, desktop, editable }: { r: ApplicantReview; desktop: boolean; editable: boolean }) {
  const e = (path: string) => (editable ? path : undefined)
  const programme = (
    <Section title="Programme" edit={e(STEP_PATH.programme)} editLabel="Edit programme">
      <Rows
        desktop={desktop}
        rows={[
          ['Programme', <span key="v" className="font-medium">{r.programme.name}</span>],
          ['Award', [r.programme.award, r.programme.length, !desktop && r.programme.intake].filter(Boolean).join(' · ')],
        ]}
      />
    </Section>
  )
  const id = r.national_id && (
    <Section title="National ID" edit={e(STEP_PATH.national_id)} editLabel="Edit National ID">
      <Rows
        desktop={desktop}
        rows={[
          ['ID number', r.national_id.id_number, true],
          ['Name', r.national_id.name],
          ['Date of birth', dob(r.national_id.date_of_birth)],
          ...((r.national_id.registered_in || r.national_id.origin
            ? [
                [
                  'Registration',
                  [r.national_id.registered_in && `Registered in ${r.national_id.registered_in}`, r.national_id.origin && `Origin ${r.national_id.origin}`]
                    .filter(Boolean)
                    .join(' · '),
                ],
              ]
            : []) as [string, React.ReactNode][]),
        ]}
      />
    </Section>
  )
  const birth = r.birth_certificate && (
    <Section title="Birth certificate" edit={e(STEP_PATH.birth_certificate)} editLabel="Edit birth certificate">
      <Rows
        desktop={desktop}
        rows={[
          ['Name', r.birth_certificate.name],
          ['Date of birth', dob(r.birth_certificate.date_of_birth)],
        ]}
      />
      {r.birth_certificate.matches_id === false && (
        <p className="pb-3 text-sm text-muted-foreground">Different from your National ID. Admissions will check it.</p>
      )}
    </Section>
  )
  const contact = (
    <Section title="Contact" editLabel="Edit contact details">
      <Rows
        desktop={desktop}
        rows={[
          [
            'Mobile number',
            r.phone_masked ? (
              <span key="v" className="flex items-center gap-2">
                <span className="font-mono">{r.phone_masked}</span>
                <Badge variant="success">Verified</Badge>
              </span>
            ) : (
              <span key="v" className="text-muted-foreground">
                None on your account
              </span>
            ),
          ],
        ]}
      />
    </Section>
  )
  const results = r.sittings.length > 0 && (
    <Section title="ZIMSEC results" edit={e(STEP_PATH.results)} editLabel="Edit ZIMSEC results">
      {r.sittings.map((s) => (
        <div key={s.label}>
          <div className="pt-3 pb-2">
            <div className="font-medium">{s.label.replace(', ', ' · ')}</div>
            <div className="text-sm text-muted-foreground">
              Centre <span className="font-mono text-foreground">{s.centre_number}</span> · Candidate{' '}
              <span className="font-mono text-foreground">{s.candidate_number}</span>
            </div>
          </div>
          <ul className="border-t [&>li+li]:border-t">
            {s.subjects.map((x) => (
              <li key={x.name} className={cn('grid gap-x-2 py-2', desktop ? 'grid-cols-[80px_minmax(0,1fr)_60px]' : 'grid-cols-[56px_minmax(0,1fr)_24px]')}>
                <span className={cn('font-mono text-muted-foreground', !desktop && 'pt-0.5 text-sm')}>{x.code ?? '—'}</span>
                <span>{x.name}</span>
                <span className="text-right font-mono font-semibold">{x.grade}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  )
  if (desktop)
    return (
      <div className="grid grid-cols-2 items-start gap-12">
        <div className="flex flex-col gap-8">
          {programme}
          {id}
          {birth}
          {contact}
        </div>
        {results}
      </div>
    )
  return (
    <>
      {programme}
      {id}
      {birth}
      {results}
      {contact}
    </>
  )
}

// design/ReviewNotEligible
function NotEligible({ r, app, desktop }: { r: ApplicantReview; app: MyApplication; desktop: boolean }) {
  const signOut = useSignOut()
  const e = r.eligibility!
  const subjectShort = e.shortfalls.find((s) => s.subject)?.subject
  return (
    <>
      <Alert className="border-border-strong">
        <CircleAlert strokeWidth={1.5} />
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold">You don't meet the entry requirements for the {app.programme} yet</h2>
          {e.shortfalls.map((s) => (
            <p key={s.need}>
              {s.need} {s.have}
            </p>
          ))}
          {e.other_passes.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Your other {e.other_passes.length} {e.other_passes.length === 1 ? 'pass is' : 'passes are'} fine: {e.other_passes.join(', ')}.
            </p>
          )}
        </div>
      </Alert>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg leading-6 font-semibold">What you can do</h2>
        <ol className="border-y [&>li+li]:border-t">
          <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2 py-4">
            <span className="font-mono text-muted-foreground">1</span>
            <div className="flex flex-col items-start gap-2">
              <div>
                <div className="font-medium">Already rewritten {subjectShort ?? 'a subject'}?</div>
                <div className="text-sm text-muted-foreground">Add that sitting, for example a June resit, and we'll check again.</div>
              </div>
              <Button variant="outline" asChild>
                <Link to={STEP_PATH.results}>Add another sitting</Link>
              </Button>
            </div>
          </li>
          <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2 py-4">
            <span className="font-mono text-muted-foreground">2</span>
            <div>
              <div className="font-medium">Grade read wrongly?</div>
              <div className="text-sm text-muted-foreground">
                Compare it with your slip and{' '}
                <Link to={STEP_PATH.results} className="text-primary underline underline-offset-2">
                  correct the grade
                </Link>
                .
              </div>
            </div>
          </li>
          <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2 py-4">
            <span className="font-mono text-muted-foreground">3</span>
            <div>
              <div className="font-medium">Not sure what to do?</div>
              <div className="text-sm text-muted-foreground">
                Contact the Admissions Office{r.admissions_contact && <> ({r.admissions_contact})</>}. They can advise on bridging
                options or a different programme.
              </div>
            </div>
          </li>
        </ol>
      </section>
      <div className={cn('flex gap-3', desktop ? 'items-center' : 'mt-auto flex-col')}>
        <Button variant="outline" block={!desktop} onClick={() => void signOut()}>
          Save and come back later
        </Button>
        <Link to={STEP_PATH.programme} className="inline-flex min-h-11 items-center justify-center font-medium text-primary hover:underline">
          Choose a different programme
        </Link>
      </div>
    </>
  )
}

// Step 5 · Review. Also "View what you submitted" from the status page, without the Edit links.
export default function Review() {
  const desktop = useIsDesktop()
  const navigate = useNavigate()
  const { data: app, isPending: appPending } = useMyApplication()
  const { data: r } = useApplicationReview({ query: { enabled: !!app } })
  if (appPending) return <div className="min-h-dvh bg-background" aria-busy="true" />
  if (!app) return <Navigate to={applyHome(app)} replace />
  const draft = app.status === 'draft'
  const h1 = desktop ? 'text-[28px] leading-9 font-semibold tracking-[-0.015em]' : 'text-2xl leading-8 font-semibold tracking-[-0.01em]'
  const e = r?.eligibility
  const ready = !!r && r.missing.length === 0 && !!e?.eligible

  const body = !r ? (
    <Skeleton className="h-96" />
  ) : (
    <>
      <div className="flex flex-col gap-4">
        <h1 className={h1}>{draft ? 'Check your application' : 'What you submitted'}</h1>
        {draft && r.missing.length > 0 && (
          <Alert variant="info" className="max-w-[820px]">
            <CircleAlert strokeWidth={1.5} />
            <div className="flex flex-col gap-1">
              <p className="font-semibold">Still to do before you can submit</p>
              <ul className="flex flex-col gap-1">
                {r.missing.map((m: ApplyStep) => (
                  <li key={m}>
                    <Link to={STEP_PATH[m]} className="text-primary underline underline-offset-2">
                      {MISSING[m] ?? m}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </Alert>
        )}
        {draft && e?.eligible && (
          <Alert variant="success" className="max-w-[820px]">
            <CircleCheck strokeWidth={1.5} />
            <p>
              You meet the entry requirements for the {app.programme}: <strong className="font-semibold">{e.summary}</strong>
            </p>
          </Alert>
        )}
      </div>
      {draft && e && !e.eligible ? (
        <NotEligible r={r} app={app} desktop={desktop} />
      ) : (
        <>
          <Sections r={r} desktop={desktop} editable={draft} />
          {draft && (
            <div className={cn('flex gap-2', desktop ? 'items-center gap-6' : 'mt-auto flex-col')}>
              <Button block={!desktop} disabled={!ready} onClick={() => navigate(STEP_PATH.submit)}>
                Continue to submit
              </Button>
              <span className={cn('text-sm text-muted-foreground', !desktop && 'text-center')}>
                {desktop ? 'Nothing is sent until you submit.' : 'Next you confirm the declaration. Nothing is sent until then.'}
              </span>
            </div>
          )}
          {!draft && (
            <Link to="/apply/status" className="self-start font-medium text-primary hover:underline">
              Back to your application
            </Link>
          )}
        </>
      )}
    </>
  )
  return (
    <ApplyShell step={draft ? 5 : undefined} app={app}>
      <main className={cn('flex grow flex-col', desktop ? 'max-w-[1120px] gap-8 px-20 py-10' : 'gap-8 px-4 py-6')}>{body}</main>
    </ApplyShell>
  )
}
