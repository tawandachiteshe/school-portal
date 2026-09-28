import { useId, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ConfirmIdIn, NationalIdState } from '@/api/generated/model'
import { errorMessage } from '@/lib/api'
import { time } from '@/lib/format'
import { decodeId, formatId } from '@/lib/national-id'
import { cn } from '@/lib/utils'

const pad = (n: number) => String(n).padStart(2, '0')

function Field({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
      {children}
    </div>
  )
}

// design/PhoneCheck and IdError: check what we read, fix the check letter, or type it all in.
export function IdCheck({
  state,
  photo,
  onSave,
  onRetake,
  where = 'on this phone',
  footnote,
}: {
  state: NationalIdState | null
  photo?: string // object URL of the photo just taken
  onSave: (body: ConfirmIdIn) => Promise<unknown>
  onRetake: () => void
  where?: string
  footnote?: string
}) {
  const ids = { sn: useId(), fn: useId(), dd: useId(), mm: useId(), yy: useId(), num: useId(), ltr: useId() }
  const f = state?.fields
  const dob = f?.date_of_birth ? new Date(`${f.date_of_birth}T12:00:00`) : null
  const [surname, setSurname] = useState(f?.surname ?? '')
  const [first, setFirst] = useState(f?.first_names ?? '')
  const [day, setDay] = useState(dob ? pad(dob.getDate()) : '')
  const [month, setMonth] = useState(dob ? pad(dob.getMonth() + 1) : '')
  const [year, setYear] = useState(dob ? String(dob.getFullYear()) : '')
  const read = decodeId(f?.id_number ?? '')
  const [number, setNumber] = useState(f?.id_number ?? '')
  const [typing, setTyping] = useState(!read)
  const [letter, setLetter] = useState(read?.letter ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const errRef = useRef<HTMLDivElement>(null)

  const current = typing ? decodeId(number) : read && { ...read, letter, valid: letter.toUpperCase() === read.expected }
  const badLetter = !typing && read && !read.valid // design/IdError
  const low = new Set(state?.low_confidence ?? [])

  async function save() {
    setError(null)
    const d = typing ? decodeId(number) : read && decodeId(formatId({ ...read, letter: letter.toUpperCase() }))
    const date = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    const problem = !d
      ? 'Enter the ID number as it’s printed, like 63-2047823 C 29.'
      : !d.valid
        ? badLetter
          ? 'Enter the letter shown on your ID.'
          : 'That ID number isn’t valid. Check the letter after the digits.'
        : !surname.trim() || !first.trim()
          ? 'Enter your surname and first names as they are on your ID.'
          : !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))
            ? 'Enter your date of birth as day, month and year.'
            : null
    if (problem || !d) {
      setError(problem)
      requestAnimationFrame(() => errRef.current?.focus())
      return
    }
    setSaving(true)
    try {
      await onSave({ id_number: formatId(d), surname, first_names: first, date_of_birth: date })
    } catch (e) {
      setError(errorMessage(e, "Couldn't save. Check your signal and try again."))
      requestAnimationFrame(() => errRef.current?.focus())
    } finally {
      setSaving(false)
    }
  }

  const alert = error && (
    <div ref={errRef} tabIndex={-1} role="alert" className="flex flex-col gap-2 rounded-md border-2 border-destructive bg-card p-4">
      <h2 className="font-semibold">There's a problem</h2>
      <a href={badLetter ? `#${ids.ltr}` : `#${ids.num}`} className="font-medium text-destructive underline underline-offset-2">
        {error}
      </a>
    </div>
  )

  if (badLetter && read) {
    return (
      <div className="flex grow flex-col gap-6">
        {alert}
        <h1 className="text-2xl leading-8 font-semibold">Check your ID number</h1>
        <div className="flex flex-col gap-3">
          <figure
            role="img"
            aria-label="The ID number as it appears in your photo"
            className="flex h-14 items-center rounded-sm border bg-[#D6D0C3] px-3 font-mono text-[22px] tracking-[0.04em] text-[#3F3B34]"
          >
            {read.digits}
            <span className="mx-1 rounded-[2px] px-1 py-0.5 outline-2 outline-[#B42318]">{read.letter}</span>
            {read.origin}
          </figure>
          {state?.received_at && (
            <p className="text-xs text-muted-foreground">From your photo, taken {time(new Date(state.received_at))}</p>
          )}
        </div>
        <p>
          We read your ID as{' '}
          <span className="font-mono whitespace-nowrap">
            {read.digits}{' '}
            <mark className="rounded-[2px] bg-destructive-soft px-[3px] font-semibold text-destructive shadow-[inset_0_-2px_0_var(--destructive)]">
              {read.letter}
            </mark>{' '}
            {read.origin}
          </span>
          , but that number isn't valid. Please check the letter after the digits.
        </p>
        <div className="flex flex-col gap-1.5 border-l-4 border-destructive pl-3.5">
          <Label htmlFor={ids.ltr}>Letter after the digits</Label>
          <span className="text-sm text-muted-foreground">Letters like P, Q and R can look alike on worn IDs.</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg text-muted-foreground">{read.digits}</span>
            <Input
              id={ids.ltr}
              value={letter}
              maxLength={1}
              aria-invalid={!!error || undefined}
              onChange={(e) => setLetter(e.target.value.toUpperCase())}
              className="w-14 text-center font-mono text-lg uppercase"
            />
            <span className="font-mono text-lg text-muted-foreground">{read.origin}</span>
          </div>
        </div>
        {namesAndDob()}
        <div className="mt-auto flex flex-col gap-3">
          <Button block disabled={saving} onClick={() => void save()}>
            Check again
          </Button>
          <Button block variant="outline" onClick={onRetake}>
            Retake photo
          </Button>
        </div>
      </div>
    )
  }

  function namesAndDob() {
    return (
      <>
        <Field id={ids.sn} label="Surname">
          <Input
            id={ids.sn}
            value={surname}
            autoComplete="family-name"
            lowConfidence={low.has('surname')}
            onChange={(e) => setSurname(e.target.value.toUpperCase())}
          />
        </Field>
        <Field id={ids.fn} label="First names">
          <Input
            id={ids.fn}
            value={first}
            autoComplete="given-name"
            lowConfidence={low.has('first_names')}
            onChange={(e) => setFirst(e.target.value.toUpperCase())}
          />
        </Field>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Date of birth</legend>
          <div className="flex gap-3">
            {(
              [
                [ids.dd, 'Day', day, setDay, 'w-16', 2],
                [ids.mm, 'Month', month, setMonth, 'w-16', 2],
                [ids.yy, 'Year', year, setYear, 'w-24', 4],
              ] as const
            ).map(([id, label, value, set, w, max]) => (
              <div key={id} className={cn('flex flex-col gap-1', w)}>
                <label htmlFor={id} className="text-sm text-muted-foreground">
                  {label}
                </label>
                <Input
                  id={id}
                  value={value}
                  inputMode="numeric"
                  maxLength={max}
                  lowConfidence={low.has('date_of_birth')}
                  onChange={(e) => set(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            ))}
          </div>
        </fieldset>
      </>
    )
  }

  return (
    <div className="flex grow flex-col gap-6">
      {alert}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl leading-8 font-semibold">{state ? 'Check your ID details' : 'Type your ID details'}</h1>
        <p className="text-muted-foreground">
          {state && state.status !== 'failed'
            ? 'We filled these in from your photo. Change anything we got wrong.'
            : 'Copy them exactly as they are printed on the front of your ID.'}
        </p>
      </div>

      {state?.document_id && (
        <div className="flex items-center gap-3">
          {photo ? (
            <img src={photo} alt="" className="h-[61px] w-24 shrink-0 rounded-sm border object-cover" />
          ) : (
            <span aria-hidden className="h-[61px] w-24 shrink-0 rounded-sm border bg-muted" />
          )}
          <div className="grow">
            <div className="font-medium">Photo of the front</div>
            {state.received_at && (
              <div className="text-sm text-muted-foreground">
                Taken {time(new Date(state.received_at))} {where}
              </div>
            )}
          </div>
          <Button variant="ghost" onClick={onRetake}>
            Retake
          </Button>
        </div>
      )}

      {typing ? (
        <Field id={ids.num} label="ID number" hint="Two digits, then six or seven digits, a letter and two digits">
          <Input
            id={ids.num}
            value={number}
            placeholder="63-2047823 C 29"
            autoComplete="off"
            lowConfidence={low.has('id_number')}
            aria-invalid={!!(error && number && !current?.valid) || undefined}
            onChange={(e) => setNumber(e.target.value.toUpperCase())}
            className="font-mono text-lg"
          />
          {current && (
            <span className={cn('text-sm', current.valid ? 'text-success' : 'text-destructive')}>
              {current.valid ? 'Check letter valid' : `The letter after ${current.digits} doesn't match. Check it on your ID.`}
            </span>
          )}
        </Field>
      ) : (
        read && (
          <div className="flex flex-col gap-2 border-y py-4">
            <span className="text-sm font-medium">ID number</span>
            <span className="font-mono text-2xl leading-8 font-medium">{formatId(read)}</span>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success">Check letter valid</Badge>
              {(state?.registered_in || state?.origin) && (
                <span className="text-sm text-muted-foreground">
                  {[state.registered_in && `Registered in ${state.registered_in}`, state.origin && `Origin ${state.origin}`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
              <button
                type="button"
                onClick={() => setTyping(true)}
                className="text-sm text-primary underline underline-offset-2"
              >
                Change
              </button>
            </div>
          </div>
        )
      )}

      {namesAndDob()}

      <div className="mt-auto flex flex-col gap-2">
        <Button block disabled={saving} onClick={() => void save()}>
          Save ID details
        </Button>
        {footnote && <p className="text-center text-sm text-muted-foreground">{footnote}</p>}
      </div>
    </div>
  )
}
