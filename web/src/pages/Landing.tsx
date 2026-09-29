import { CalendarDays, Check, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Wordmark } from '@/components/shell/wordmark'
import { usePublicHome } from '@/api/generated/public/public'
import type { PublicHome } from '@/api/generated/model'
import { longDateWithYear, onDay, time } from '@/lib/format'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

// design/Landing (computer) and LandingPhone: what the college offers, how applying works, and the
// way in for students. Shown at / to anyone signed out. Facts come from GET /public/home.

const NAV = [
  { href: '#programmes', label: 'Programmes' },
  { href: '#apply', label: 'How to apply' },
  { href: '#students', label: 'For students' },
  { href: '#help', label: 'Help' },
]

const STEPS = [
  ['Choose a programme', 'See the entry requirements before you choose.'],
  ['Add your National ID', 'Photograph it with your phone. We read the number, name and date of birth for you.'],
  ['Add your birth certificate', 'A photo or a scan of it.'],
  ['Add your ZIMSEC results', 'Photograph your result slip. Check the grades we read, and add any resits.'],
  ['Check your eligibility', "You'll see straight away whether you meet the entry requirements, and what to do if you don't."],
  ['Pay and submit', 'Pay the application fee by EcoCash, OneMoney, bank transfer or cash. Then track your application here.'],
] as const

const STUDENTS = [
  ['Results on your phone', "See your marks as soon as they're published, and download your results slip. No trip to the office."],
  ['Your day, in order', "Today's classes and rooms, tests and assignments due, new lecture notes, notices and library loans."],
  ['Works on slow data', "Pages are light. Your timetable and saved notes still open without signal, and uploads wait until you're back online."],
] as const

// "Applying for the 2027 intake": the intake's name, when there is one.
const intakeLabel = (home?: PublicHome) => home?.intake?.name ?? 'the next intake'

function Header({ studentsOpen }: { studentsOpen: boolean }) {
  const nav = studentsOpen ? NAV : NAV.filter((n) => n.href !== '#students')
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-10 border-b bg-card">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between gap-6 pr-2 pl-4 md:h-16 md:px-8 lg:px-20">
        <div className="flex items-center gap-10">
          <Link to="/" aria-label="Campus Portal, home">
            <Wordmark />
          </Link>
          <nav aria-label="Main" className="hidden gap-7 text-sm md:flex">
            {nav.map((n) => (
              <a key={n.href} href={n.href} className="hover:underline">
                {n.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="hidden gap-2 md:flex">
          <Button variant="outline" size="sm" asChild>
            <Link to="/login">Sign in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link to="/register">Apply now</Link>
          </Button>
        </div>
        <div className="flex items-center md:hidden">
          <Button variant="ghost" asChild>
            <Link to="/login">Sign in</Link>
          </Button>
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Menu'}
            aria-expanded={open}
            aria-controls="landing-menu"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex size-11 items-center justify-center"
          >
            {open ? <X className="size-5" strokeWidth={1.5} /> : <Menu className="size-5" strokeWidth={1.5} />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="landing-menu" aria-label="Main" className="border-t px-4 md:hidden">
          <ul className="divide-y">
            {nav.map((n) => (
              <li key={n.href}>
                <a href={n.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  )
}

function Closing({ home, className }: { home?: PublicHome; className?: string }) {
  const intake = home?.intake
  if (!intake) return null
  return (
    <Alert variant="info" className={className}>
      <CalendarDays strokeWidth={1.5} />
      <p>
        {intake.open ? (
          <>
            Applications for the {intake.name} are open. They close on{' '}
            <span className="font-semibold">{longDateWithYear(new Date(intake.closes_at))}</span>.
          </>
        ) : (
          <>
            Applications for the {intake.name} open on <span className="font-semibold">{longDateWithYear(new Date(intake.opens_at))}</span>.
          </>
        )}
      </p>
    </Alert>
  )
}

function Ready({ home }: { home?: PublicHome }) {
  const items = [
    'Your National ID, metal or plastic',
    'Your birth certificate',
    'Your ZIMSEC O-Level result slip or certificate',
    'A phone with a camera, or scans of your documents',
  ]
  return (
    <aside aria-labelledby="h-ready" className="flex flex-col gap-4 self-start rounded-md border bg-card p-4 md:p-6">
      <h3 id="h-ready" className="text-lg leading-6 font-semibold">
        Have these ready
      </h3>
      <ul className="flex flex-col gap-3">
        {items.map((t) => (
          <li key={t} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2">
            <Check aria-hidden className="mt-0.5 size-5 text-success" strokeWidth={1.5} />
            <span>{t}</span>
          </li>
        ))}
        {home && (
          <li className="grid grid-cols-[20px_minmax(0,1fr)] gap-2">
            <Check aria-hidden className="mt-0.5 size-5 text-success" strokeWidth={1.5} />
            <span>
              The application fee: <span className="font-mono font-semibold">US$ {home.application_fee}</span>
            </span>
          </li>
        )}
      </ul>
      <p className="border-t pt-3 text-sm text-muted-foreground">
        No smartphone? Use a college lab computer and upload scans, or ask at the Admissions Office in Block A.
      </p>
    </aside>
  )
}

function KeyDates({ home }: { home?: PublicHome }) {
  const now = useNow().getTime()
  const rows: [string, string][] = []
  if (home?.intake) rows.push(['Applications close', longDateWithYear(new Date(home.intake.closes_at))])
  if (home) rows.push(['Decisions sent', `Within ${home.decision_working_days} working days of applying`])
  // Past dates belong to an intake that has started: leave them off.
  if (home?.registration_at && new Date(home.registration_at).getTime() > now)
    rows.push(['Registration', `${longDateWithYear(new Date(home.registration_at))}, ${time(new Date(home.registration_at))}`])
  if (home?.classes_start && new Date(`${home.classes_start}T23:59:59`).getTime() > now)
    rows.push(['Classes start', longDateWithYear(onDay(home.classes_start))])
  if (rows.length === 0) return null
  return (
    <section aria-labelledby="h-dates" className="flex flex-col gap-4">
      <h2 id="h-dates" className="text-2xl leading-8 font-semibold md:text-[32px] md:leading-10">
        Key dates{home?.intake && <span className="text-muted-foreground"> · {home.intake.name}</span>}
      </h2>
      <dl className="divide-y border-y">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-3.5">
            <dt className="text-muted-foreground md:text-foreground">{k}</dt>
            <dd className="text-right font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Help({ home }: { home?: PublicHome }) {
  const rows: [string, string][] = [
    ['Applications', ['Admissions Office, Block A', home?.admissions_contact].filter(Boolean).join(' · ')],
    ['Signing in', 'ICT Services, Block C'],
    ['Fees and payments', 'Accounts Office, Block A'],
    ['Everything else', 'Student Affairs, Block A'],
  ]
  return (
    <section id="help" aria-labelledby="h-help" className="flex scroll-mt-20 flex-col gap-4">
      <h2 id="h-help" className="text-2xl leading-8 font-semibold md:text-[32px] md:leading-10">
        Need help?
      </h2>
      <dl className="divide-y border-y">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 py-3.5 md:flex-row md:justify-between md:gap-4">
            <dt className="font-semibold md:font-normal">{k}</dt>
            <dd className="text-muted-foreground md:text-right md:text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">Students can also ask questions in the portal with Ask Campus. Its answers link to the official source.</p>
    </section>
  )
}

const section = 'mx-auto max-w-[1280px] px-4 py-8 md:px-8 md:py-[72px] lg:px-20'
const h2 = 'text-2xl leading-8 font-semibold md:text-[32px] md:leading-10'
const lead = 'text-muted-foreground md:text-lg md:leading-7'

export default function Landing() {
  const { data: home } = usePublicHome({ query: { staleTime: 5 * 60_000 } })
  const studentsOpen = home?.students_open ?? true
  const applyLabel = home?.intake?.open ? `Apply for the ${home.intake.name}` : 'Start an application'

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <Header studentsOpen={home?.students_open ?? true} />
      <main className="flex flex-col">
        {/* Hero */}
        <div className="border-b">
          <section className={cn(section, 'grid items-start gap-20 md:grid-cols-[minmax(0,1fr)_minmax(0,400px)] md:pt-20 md:pb-[72px]')}>
            <div className="flex flex-col gap-4 md:gap-6 md:pt-6">
              <p className="text-xs leading-4 font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                TelOne Centre for Learning · Harare
              </p>
              <h1 className="max-w-[640px] text-[30px] leading-[38px] font-semibold tracking-[-0.015em] text-balance md:text-5xl md:leading-[56px] md:tracking-[-0.02em]">
                Apply, study and keep up with college in one place.
              </h1>
              <p className="max-w-[600px] text-[17px] leading-[26px] text-muted-foreground md:text-xl md:leading-[30px]">
                Apply for the {intakeLabel(home)} from your phone, with no forms to print.
                {studentsOpen && (
                  <>
                    {' '}
                    Students see their timetable, deadlines, notes and results here
                    <span className="hidden md:inline">, instead of on notice boards, WhatsApp groups and office counters</span>.
                  </>
                )}
              </p>
              <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center">
                <Button asChild className="md:h-12 md:px-5">
                  <Link to="/register">{applyLabel}</Link>
                </Button>
                <Button variant="outline" asChild className="md:h-12 md:px-5">
                  <Link to="/login">Sign in</Link>
                </Button>
              </div>
              <Closing home={home} className="mt-2 max-w-[600px] md:mt-4" />
            </div>
            <figure
              aria-label="The student dashboard on a phone"
              className="hidden h-[640px] w-[400px] max-w-full overflow-hidden rounded-[20px] border border-border-strong bg-card p-[5px] md:block"
            >
              <img src="/landing/dashboard-light.webp" alt="" width={390} height={628} className="rounded-[15px] dark:hidden" loading="lazy" />
              <img src="/landing/dashboard-dark.webp" alt="" width={390} height={628} className="hidden rounded-[15px] dark:block" loading="lazy" />
            </figure>
          </section>
        </div>

        {/* How applying works */}
        <div className="border-b">
          <section id="apply" aria-labelledby="h-apply" className={cn(section, 'grid scroll-mt-16 gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,360px)] md:gap-20')}>
            <div className="flex flex-col gap-4 md:gap-7">
              <div className="flex flex-col gap-2">
                <h2 id="h-apply" className={h2}>
                  How applying works
                </h2>
                <p className={lead}>
                  About 20 minutes. Start on a computer or phone. When you need to photograph a document, you can switch to your phone and
                  carry on.
                </p>
              </div>
              <ol className="divide-y border-y">
                {STEPS.map(([title, body], i) => (
                  <li key={title} className="grid grid-cols-[32px_minmax(0,1fr)] py-3.5 md:grid-cols-[48px_minmax(0,1fr)] md:py-[18px]">
                    <span className="font-mono text-muted-foreground md:text-lg">{i + 1}</span>
                    <span>
                      <span className="block font-semibold">{title}</span>
                      <span className="text-sm text-muted-foreground md:text-base">{body}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="hidden md:block">
                <Button asChild>
                  <Link to="/register">Start my application</Link>
                </Button>
              </div>
            </div>
            <Ready home={home} />
            <Button asChild block className="md:hidden">
              <Link to="/register">Start my application</Link>
            </Button>
          </section>
        </div>

        {/* Programmes */}
        <div className="border-b">
          <section id="programmes" aria-labelledby="h-prog" className={cn(section, 'flex scroll-mt-16 flex-col gap-3 md:gap-6')}>
            <div className="flex flex-col gap-2">
              <h2 id="h-prog" className={h2}>
                Programmes{home?.intake && ` for ${home.intake.name.replace(/ intake$/, '')}`}
              </h2>
              <p className={lead}>HEXCO-certified. Full-time, at the Harare campus.</p>
            </div>
            {/* Phone: a list. Computer: a table. */}
            <ul className="divide-y border-y md:hidden">
              {home?.programmes.map((p) => (
                <li key={p.code} className="flex flex-col gap-1 py-3.5">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-sm text-muted-foreground">{[p.award?.replace(/^HEXCO /, ''), p.length].filter(Boolean).join(' · ')}</span>
                  <span className="text-sm">{p.entry}</span>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left tabular-nums">
                <thead className="text-sm text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2.5 pr-4 font-medium">Programme</th>
                    <th className="w-[220px] py-2.5 pr-4 font-medium">Award</th>
                    <th className="w-[100px] py-2.5 pr-4 font-medium">Length</th>
                    <th className="py-2.5 font-medium">Entry requirements</th>
                  </tr>
                </thead>
                <tbody className="divide-y border-b">
                  {home?.programmes.map((p) => (
                    <tr key={p.code}>
                      <td className="py-3 pr-4 align-top font-semibold">{p.name}</td>
                      <td className="py-3 pr-4 align-top text-muted-foreground">{p.award}</td>
                      <td className="py-3 pr-4 align-top text-muted-foreground">{p.length}</td>
                      <td className="py-3 align-top">{p.entry}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Students: hidden while only applications are live (STUDENT_PORTAL_OPEN) */}
        {studentsOpen && (
          <div className="border-b">
            <section id="students" aria-labelledby="h-stu" className={cn(section, 'flex scroll-mt-16 flex-col gap-5 md:gap-8')}>
              <div className="flex max-w-[720px] flex-col gap-1 md:gap-2">
                <h2 id="h-stu" className={h2}>
                  Already a student?
                </h2>
                <p className={lead}>Sign in with your student number. Everything the college sends you is in one place.</p>
              </div>
              <div className="grid gap-5 md:grid-cols-3 md:gap-12">
                {STUDENTS.map(([title, body]) => (
                  <div key={title} className="flex flex-col gap-1.5 border-t-2 border-foreground pt-3 md:gap-2 md:pt-4">
                    <h3 className="text-lg leading-6 font-semibold">{title}</h3>
                    <p className="text-sm text-muted-foreground md:text-base">{body}</p>
                  </div>
                ))}
              </div>
              <div>
                <Button variant="outline" asChild className="w-full md:w-auto">
                  <Link to="/login">Sign in with your student number</Link>
                </Button>
              </div>
            </section>
          </div>
        )}

        {/* Dates and help */}
        <div className={cn(section, 'grid gap-8 md:grid-cols-2 md:gap-20')}>
          <KeyDates home={home} />
          <Help home={home} />
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 pt-6 pb-8 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between md:px-8 md:py-8 lg:px-20">
          <span>
            <span className="font-semibold text-foreground">TelOne Centre for Learning</span> · Harare, Zimbabwe
          </span>
          <Link to="/login" className="underline-offset-2 hover:underline">
            Staff sign in
          </Link>
        </div>
      </footer>
    </div>
  )
}
