import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Initials } from '@/components/shell/wordmark'
import { getGetMySettingsQueryKey, useGetMySettings, useUpdateMySettings } from '@/api/generated/me/me'
import { useFees } from '@/api/generated/records/records'
import { useDashboard } from '@/api/generated/student/student'
import { useMe, useSignOut } from '@/lib/auth'
import { setDataSaver, useDataSaver } from '@/lib/data-saver'
import { maskPhone, shortDate } from '@/lib/format'
import { onDay } from '@/lib/records'
import { useTheme, type Theme } from '@/lib/theme'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DeskBar } from '@/components/shell/student-desktop'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Same as phone' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function Row({ to, title, meta, trailing }: { to?: string; title: string; meta?: ReactNode; trailing?: ReactNode }) {
  const body = (
    <>
      <span className="grow">
        <span className="block font-medium">{title}</span>
        {meta && <span className="text-sm text-muted-foreground">{meta}</span>}
      </span>
      {trailing}
      {to && <ChevronRight className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />}
    </>
  )
  const cls = 'flex min-h-14 items-center gap-3 py-2'
  return <li>{to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>
}

function ToggleRow({
  title,
  meta,
  checked,
  onChange,
  disabled,
}: {
  title: string
  meta: string
  checked: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <li className="flex min-h-16 items-center gap-4 py-2">
      <span className="grow">
        <span id={id} className="block font-medium">
          {title}
        </span>
        <span className="text-sm text-muted-foreground">{meta}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-labelledby={id} disabled={disabled} />
    </li>
  )
}

export default function More() {
  const { data: me } = useMe()
  const signOut = useSignOut()
  const { theme, setTheme } = useTheme()
  const dataSaver = useDataSaver()
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const qc = useQueryClient()
  const settings = useGetMySettings()
  const saveSettings = useUpdateMySettings({
    mutation: {
      onSuccess: (s) => qc.setQueryData(getGetMySettingsQueryKey(), s),
      onError: () => toast('Could not save the setting. Check your connection and try again.'),
    },
  })

  const dash = useDashboard()
  const desktop = useIsDesktop()
  const fees = useFees()
  if (!me) return null
  const st = me.student
  if (desktop)
    return (
      <MoreDesk
        smsOn={settings.data?.sms_reminders ?? true}
        smsDisabled={!settings.data || saveSettings.isPending}
        onSms={(on) => saveSettings.mutate({ data: { sms_reminders: on } })}
        theme={theme}
        setTheme={setTheme}
        onSignOut={signOut}
      />
    )
  const res = dash.data?.results
  const resultsMeta = res
    ? res.published
      ? `${res.term_name} published`
      : `${res.term_name?.replace(/ \d{4}$/, '') ?? 'Results'} not yet published`
    : undefined
  const next = fees.data?.next_payment
  const feesMeta = next ? `${next.label} due ${shortDate(onDay(next.due_on))}` : undefined
  const unread = dash.data?.announcements.unread

  return (
    <main className="flex grow flex-col gap-7 px-4 py-6">
      <div className="flex items-center gap-4">
        <Initials initials={me.initials} className="size-14 text-lg" />
        <div className="flex flex-col">
          <h1 className="text-lg leading-6 font-semibold">{me.display_name}</h1>
          {st && (
            <>
              <span className="font-mono">{st.student_number}</span>
              <span className="text-sm text-muted-foreground">
                {st.programme_name} · Year {st.year_of_study}
                {st.class_group && (
                  <>
                    {' · '}
                    <span className="font-mono">{st.class_group}</span>
                  </>
                )}
              </span>
            </>
          )}
        </div>
      </div>

      <section aria-label="Student records">
        <ul className="border-y [&>li+li]:border-t">
          <Row to="/results" title="Results" meta={resultsMeta} />
          <Row to="/fees" title="Fees and statements" meta={feesMeta} />
          <Row to="/timetable" title="Timetable" />
          <Row
            to="/announcements"
            title="Announcements"
            trailing={unread ? <span className="text-sm text-muted-foreground">{unread} unread</span> : undefined}
          />
          <Row to="/card" title="Student card" meta="Show at the library desk and exam rooms" />
        </ul>
      </section>

      <section aria-labelledby="h-settings">
        <h2 id="h-settings" className="border-b pb-2 text-lg leading-6 font-semibold">
          Settings
        </h2>
        <ul className="[&>li+li]:border-t">
          <ToggleRow
            title="Save mobile data"
            meta="Download notes only on Wi-Fi. Pages load without pictures."
            checked={dataSaver}
            onChange={setDataSaver}
          />
          <ToggleRow
            title="SMS reminders"
            meta="A text 24 hours before tests and deadlines"
            checked={settings.data?.sms_reminders ?? true}
            disabled={!settings.data || saveSettings.isPending}
            onChange={(on) => saveSettings.mutate({ data: { sms_reminders: on } })}
          />
          <li>
            <button
              type="button"
              onClick={() => setAppearanceOpen(true)}
              className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
            >
              <span className="grow font-medium">Appearance</span>
              <span className="text-sm text-muted-foreground">{THEMES.find((t) => t.value === theme)?.label}</span>
              <ChevronRight className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
            </button>
          </li>
          {me.phone && <Row title="Mobile number" meta={<span className="font-mono">{maskPhone(me.phone)}</span>} />}
        </ul>
      </section>

      <div className="flex flex-col items-start border-t pt-2">
        <Link to="/ask" className="inline-flex min-h-11 items-center text-sm font-medium text-primary">
          Contact Student Affairs
        </Link>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex h-11 items-center font-medium text-destructive"
        >
          Sign out
        </button>
      </div>

      <Sheet open={appearanceOpen} onOpenChange={setAppearanceOpen}>
        <SheetContent side="bottom" className="rounded-t-xl">
          <SheetHeader>
            <SheetTitle>Appearance</SheetTitle>
            <SheetDescription>Choose how the portal looks on this phone.</SheetDescription>
          </SheetHeader>
          <div role="radiogroup" aria-label="Appearance" className="flex flex-col px-4 pb-6 [&>*+*]:border-t">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={theme === t.value}
                onClick={() => {
                  setTheme(t.value)
                  setAppearanceOpen(false)
                }}
                className="flex min-h-14 items-center gap-3 text-left"
              >
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-input bg-card',
                    theme === t.value && 'border-primary after:size-2.5 after:rounded-full after:bg-primary',
                  )}
                />
                {t.label}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </main>
  )
}

// On a computer (no design): details and settings side by side. The sidebar already links to
// results, fees, timetable and announcements, and "Save mobile data" only applies on phones.
function MoreDesk({
  smsOn,
  smsDisabled,
  onSms,
  theme,
  setTheme,
  onSignOut,
}: {
  smsOn: boolean
  smsDisabled: boolean
  onSms: (on: boolean) => void
  theme: Theme
  setTheme: (t: Theme) => void
  onSignOut: () => void
}) {
  const { data: me } = useMe()
  const smsId = useId()
  if (!me) return null
  const st = me.student
  const mono = (v: string | null | undefined, cls = 'font-mono') => (v ? <span className={cls}>{v}</span> : null)
  const details: { label: string; value: ReactNode }[] = [
    { label: 'Student number', value: mono(st?.student_number) },
    { label: 'Programme', value: st?.programme_name },
    { label: 'Class', value: mono(st?.class_group) },
    { label: 'Year of study', value: st ? `Year ${st.year_of_study}` : null },
    { label: 'Mobile number', value: mono(me.phone ? maskPhone(me.phone) : null) },
    { label: 'Email', value: mono(me.email, 'font-mono text-sm') },
  ]
  return (
    <>
      <DeskBar left="Account" />
      <main className="flex max-w-[1040px] flex-col gap-8 p-8">
        <div className="flex items-center gap-4">
          <Initials initials={me.initials} className="size-14 text-lg" />
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.015em]">{me.display_name}</h1>
            {st && (
              <p className="text-muted-foreground">
                {st.programme_name} · Year {st.year_of_study}
                {st.class_group && (
                  <>
                    {' · '}
                    <span className="font-mono">{st.class_group}</span>
                  </>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-12">
          <div className="flex flex-col gap-8">
            <section aria-labelledby="acc-details">
              <h2 id="acc-details" className="border-b pb-2 text-lg leading-6 font-semibold">
                Your details
              </h2>
              <dl className="[&>div+div]:border-t">
                {details
                  .filter((d) => d.value)
                  .map((d) => (
                    <div key={d.label} className="grid grid-cols-[180px_minmax(0,1fr)] gap-4 py-3">
                      <dt className="text-sm text-muted-foreground">{d.label}</dt>
                      <dd>{d.value}</dd>
                    </div>
                  ))}
              </dl>
              <p className="pt-2 text-sm text-muted-foreground">
                Something wrong here? Ask Student Affairs to correct it.
              </p>
            </section>

            <section aria-labelledby="acc-settings">
              <h2 id="acc-settings" className="border-b pb-2 text-lg leading-6 font-semibold">
                Settings
              </h2>
              <div className="flex items-center gap-4 border-b py-3">
                <span className="grow">
                  <span id={smsId} className="block font-medium">
                    SMS reminders
                  </span>
                  <span className="text-sm text-muted-foreground">A text 24 hours before tests and deadlines</span>
                </span>
                <Switch checked={smsOn} onCheckedChange={onSms} aria-labelledby={smsId} disabled={smsDisabled} />
              </div>
              <div className="flex items-center gap-4 py-3">
                <span className="grow">
                  <span className="block font-medium">Appearance</span>
                  <span className="text-sm text-muted-foreground">How the portal looks on this computer</span>
                </span>
                <div role="radiogroup" aria-label="Appearance" className="flex gap-1 rounded-md bg-muted p-1">
                  {DESK_THEMES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={theme === t.value}
                      onClick={() => setTheme(t.value)}
                      className={cn(
                        'h-9 rounded-sm px-3 text-sm font-medium text-muted-foreground',
                        theme === t.value && 'bg-card text-foreground shadow-[0_0_0_1px_var(--border)]',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <aside className="flex flex-col gap-6">
            <Link to="/card" className="flex items-center gap-3 rounded-md border bg-card p-4">
              <span className="grow">
                <span className="block font-medium">Student card</span>
                <span className="text-sm text-muted-foreground">Show at the library desk and exam rooms</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
            </Link>
            <div className="flex flex-col items-start gap-1 border-t pt-4">
              <Link to="/ask" className="inline-flex min-h-11 items-center text-sm font-medium text-primary">
                Contact Student Affairs
              </Link>
              <Button variant="destructive" onClick={onSignOut}>
                Sign out
              </Button>
              <p className="pt-2 text-sm text-muted-foreground">On a shared computer, always sign out when you finish.</p>
            </div>
          </aside>
        </div>
      </main>
    </>
  )
}

const DESK_THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Same as this device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]
