import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, QrCode, Upload } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ApplyShell } from '@/components/shell/apply-shell'
import type { BirthCertificateState, ConfirmBirthIn, MyApplication, NewHandoff } from '@/api/generated/model'
import { getMyApplicationQueryKey, useMyApplication } from '@/api/generated/apply/apply'
import {
  confirmBirthCertificate,
  getBirthCertificateQueryKey,
  uploadBirthCertificate,
  useBirthCertificate,
} from '@/api/generated/apply-birth-certificate/apply-birth-certificate'
import { getCurrentHandoffQueryKey, useCurrentHandoff, useStartHandoff } from '@/api/generated/apply-id/apply-id'
import { getMyDocumentFileUrl } from '@/api/generated/apply-results/apply-results'
import { errorMessage } from '@/lib/api'
import { useIsDesktop } from '@/lib/use-desktop'
import { applyHome, STEP_PATH } from '../common'
import { asFile, compressImage } from '../id/compress'
import { IdCamera } from '../id/IdCamera'
import { LINK_KEY, LinkGone, LinkPanel } from '../id/NationalId'
import { Reading } from '../results/ResultsFlow'

const h1Desk = 'text-[28px] leading-9 font-semibold tracking-[-0.015em]'
const longDob = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const pad = (n: number) => String(n).padStart(2, '0')
const myFile = (id: string) => `/api${getMyDocumentFileUrl(id)}`

export type BirthApi = {
  state: BirthCertificateState | undefined
  upload: (file: File) => Promise<unknown>
  confirm: (body: ConfirmBirthIn) => Promise<unknown>
  fileUrl: (id: string) => string
}

// Name and date of birth exactly as printed (no design: in the style of design/PhoneCheck).
export function BirthCheck({ s, fileUrl, onSave, onRetake }: { s: BirthCertificateState; fileUrl: (id: string) => string; onSave: (b: ConfirmBirthIn) => Promise<unknown>; onRetake: () => void }) {
  const ids = { nm: useId(), dd: useId(), mm: useId(), yy: useId() }
  const dob = s.date_of_birth ? new Date(`${s.date_of_birth}T12:00:00`) : null
  const [name, setName] = useState(s.name ?? '')
  const [day, setDay] = useState(dob ? pad(dob.getDate()) : '')
  const [month, setMonth] = useState(dob ? pad(dob.getMonth() + 1) : '')
  const [year, setYear] = useState(dob ? String(dob.getFullYear()) : '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const errRef = useRef<HTMLDivElement>(null)

  async function save() {
    const date = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    const problem =
      name.trim().split(/\s+/).length < 2
        ? 'Enter your full name as it is on the certificate.'
        : !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))
          ? 'Enter your date of birth as day, month and year.'
          : null
    setError(problem)
    if (problem) return requestAnimationFrame(() => errRef.current?.focus())
    setSaving(true)
    try {
      await onSave({ name, date_of_birth: date })
    } catch (e) {
      setError(errorMessage(e, "Couldn't save. Check your signal and try again."))
      requestAnimationFrame(() => errRef.current?.focus())
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex grow flex-col gap-6">
      {error && (
        <div ref={errRef} tabIndex={-1} role="alert" className="rounded-md border-2 border-destructive bg-card p-4 font-medium text-destructive">
          {error}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl leading-8 font-semibold">Check your birth certificate</h1>
        <p className="text-muted-foreground">Copy your name and date of birth exactly as they are printed on the certificate.</p>
      </div>
      {s.document_id && (
        <div className="flex items-center gap-3">
          <img src={fileUrl(s.document_id)} alt="" className="h-16 w-12 shrink-0 rounded-sm border bg-muted object-cover" />
          <div className="grow font-medium">Photo of the certificate</div>
          <Button variant="ghost" onClick={onRetake}>
            Retake
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.nm}>Full name</Label>
        <span className="text-sm text-muted-foreground">If your name has changed since birth, enter it as it is on the certificate.</span>
        <Input id={ids.nm} value={name} autoComplete="name" onChange={(e) => setName(e.target.value.toUpperCase())} />
      </div>
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
            <div key={id} className={`flex flex-col gap-1 ${w}`}>
              <label htmlFor={id} className="text-sm text-muted-foreground">
                {label}
              </label>
              <Input id={id} value={value} inputMode="numeric" maxLength={max} onChange={(e) => set(e.target.value.replace(/\D/g, ''))} />
            </div>
          ))}
        </div>
      </fieldset>
      <div className="mt-auto">
        <Button block disabled={saving} onClick={() => void save()}>
          Save birth certificate
        </Button>
      </div>
    </div>
  )
}

function Added({ s, onChange, onContinue }: { s: BirthCertificateState; onChange: () => void; onContinue: () => void }) {
  return (
    <>
      <div role="status" className="flex flex-col gap-3">
        <CircleCheck className="size-6 text-success" strokeWidth={1.5} aria-hidden />
        <h1 className="text-2xl leading-8 font-semibold">Birth certificate added</h1>
      </div>
      <dl className="border-y [&>div+div]:border-t">
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-muted-foreground">Name</dt>
          <dd>{s.name}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-muted-foreground">Date of birth</dt>
          <dd>{s.date_of_birth ? longDob.format(new Date(`${s.date_of_birth}T12:00:00`)) : '—'}</dd>
        </div>
      </dl>
      {s.matches_id === false && (
        <p className="text-sm text-muted-foreground">
          This is different from your National ID. That's fine if your name has changed: Admissions will check it.
        </p>
      )}
      <div className="mt-auto flex flex-col gap-3 sm:flex-row">
        <Button onClick={onContinue}>Continue to ZIMSEC results</Button>
        <Button variant="outline" onClick={onChange}>
          Use a different photo
        </Button>
      </div>
    </>
  )
}

// Phone (signed in, or linked): photograph → check → done.
export function BirthFlow({ api, frame, onBack, onDone }: { api: BirthApi; frame: (c: React.ReactNode) => React.ReactNode; onBack: () => void; onDone: () => void }) {
  const [camera, setCamera] = useState(false)
  const [again, setAgain] = useState(false)
  const [sending, setSending] = useState(false)
  const s = api.state
  if (!s) return frame(<Reading label="Loading…" />)
  if (camera || (!again && s.status === 'none' && !sending))
    return (
      <IdCamera
        kind="certificate"
        step="Step 3 of 6"
        onBack={() => (camera ? setCamera(false) : onBack())}
        onPhoto={async (b) => {
          setCamera(false)
          setSending(true)
          try {
            await api.upload(asFile(await compressImage(b), 'birth-certificate.jpg'))
            setAgain(false)
          } catch (e) {
            toast(errorMessage(e, "Couldn't send the photo. Check your signal and try again."))
          } finally {
            setSending(false)
          }
        }}
      />
    )
  if (sending) return frame(<Reading label="Sending your photo…" />)
  if (s.status === 'confirmed' && !again)
    return frame(<Added s={s} onContinue={onDone} onChange={() => setCamera(true)} />)
  return frame(<BirthCheck key={s.document_id} s={s} fileUrl={api.fileUrl} onSave={api.confirm} onRetake={() => setCamera(true)} />)
}

function useBirthApi(): BirthApi {
  const qc = useQueryClient()
  const { data } = useBirthCertificate({ query: { refetchInterval: 3000 } })
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: getBirthCertificateQueryKey() }),
      qc.invalidateQueries({ queryKey: getMyApplicationQueryKey() }),
    ])
  return {
    state: data,
    upload: (file) => uploadBirthCertificate({ file }).then(refresh),
    confirm: (body) => confirmBirthCertificate(body).then(refresh),
    fileUrl: myFile,
  }
}

function Desktop({ app }: { app: MyApplication }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const api = useBirthApi()
  const s = api.state
  const input = useRef<HTMLInputElement>(null)
  const [upload, setUpload] = useState(false)
  const [again, setAgain] = useState(false)
  const [link, setLink] = useState<NewHandoff | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(LINK_KEY) ?? 'null') as NewHandoff | null
    } catch {
      return null
    }
  })
  const { data: h } = useCurrentHandoff({
    query: { refetchInterval: (q) => (q.state.data && ['waiting', 'connected'].includes(q.state.data.state) ? 2000 : false) },
  })
  const start = useStartHandoff({
    mutation: {
      onSuccess: (x) => {
        setLink(x)
        setUpload(false)
        try {
          sessionStorage.setItem(LINK_KEY, JSON.stringify(x))
        } catch {
          /* private mode */
        }
        void qc.invalidateQueries({ queryKey: getCurrentHandoffQueryKey() })
      },
      onError: (e) => toast(errorMessage(e, "Couldn't create a link. Try again.")),
    },
  })
  const phone = () => start.mutate({ data: { start_step: 'birth_certificate' } })
  const goOn = () => navigate(STEP_PATH.results)
  const fileInput = (
    <input
      ref={input}
      type="file"
      accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        try {
          await api.upload(asFile(await compressImage(f), f.name))
          setAgain(false)
        } catch (err) {
          toast(errorMessage(err, "Couldn't upload the file. Try again."))
        }
      }}
    />
  )
  if (!s || h === undefined) return <Skeleton className="h-80 max-w-[1040px]" />

  if (s.status === 'confirmed' && !again)
    return (
      <div className="flex max-w-[560px] flex-col gap-6">
        {fileInput}
        <Added s={s} onContinue={goOn} onChange={() => setAgain(true)} />
      </div>
    )
  if (s.status === 'uploaded' && !again)
    return (
      <div className="flex max-w-[480px] flex-col">
        {fileInput}
        <BirthCheck key={s.document_id} s={s} fileUrl={myFile} onSave={api.confirm} onRetake={() => input.current?.click()} />
      </div>
    )
  if (!upload && h?.state === 'connected')
    return (
      <section className="flex max-w-[720px] items-center gap-3 rounded-md border bg-card px-5 py-4">
        <span aria-hidden className="size-2 rounded-full bg-success" />
        <span className="grow font-medium">Phone connected{h.device && ` · ${h.device}`}</span>
        <span className="text-sm text-muted-foreground">Waiting for the photo of your birth certificate</span>
      </section>
    )
  if (!upload && h?.state === 'waiting' && link && link.match_code === h.match_code)
    return <LinkPanel link={link} app={app} back="Birth certificate options" what="a photo of your birth certificate" onUpload={() => setUpload(true)} />
  if (!upload && h?.state === 'expired' && link)
    return <LinkGone h={h} lost={false} starting={start.isPending} onNew={phone} onUpload={() => setUpload(true)} />
  return (
    <>
      {fileInput}
      <div className="flex max-w-[720px] flex-col gap-2">
        <h1 className={h1Desk}>Add your birth certificate</h1>
        <p className="text-muted-foreground">
          A photo or scan of your full birth certificate. We compare the name and date of birth with your National ID.
        </p>
      </div>
      <div className="grid max-w-[1040px] grid-cols-2 gap-6">
        <section className="flex flex-col gap-4 rounded-md border border-primary bg-card p-6">
          <div>
            <Badge variant="info">Recommended</Badge>
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg leading-6 font-semibold">Continue on your phone</h2>
            <p className="text-muted-foreground">Photograph the certificate with your phone camera.</p>
          </div>
          <div className="mt-auto">
            <Button disabled={start.isPending} onClick={phone}>
              <QrCode strokeWidth={1.5} />
              Continue on my phone
            </Button>
          </div>
        </section>
        <section className="flex flex-col gap-4 rounded-md border bg-card p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg leading-6 font-semibold">Upload a file from this computer</h2>
            <p className="text-muted-foreground">JPG, PNG or PDF, up to 5 MB.</p>
          </div>
          <div className="mt-auto">
            <Button variant="outline" onClick={() => input.current?.click()}>
              <Upload strokeWidth={1.5} />
              Choose a file
            </Button>
          </div>
        </section>
      </div>
    </>
  )
}

// Step 3 · Birth certificate (added after the designs; follows the National ID step)
export default function BirthCertificate() {
  const desktop = useIsDesktop()
  const navigate = useNavigate()
  const api = useBirthApi()
  const { data: app, isPending } = useMyApplication()
  if (isPending) return <div className="min-h-dvh bg-background" aria-busy="true" />
  if (!app || app.status !== 'draft') return <Navigate to={applyHome(app)} replace />
  if (!desktop)
    return (
      <BirthFlow
        api={api}
        onBack={() => navigate(STEP_PATH.national_id)}
        onDone={() => navigate(STEP_PATH.results)}
        frame={(children) => (
          <ApplyShell step={3} app={app}>
            <main className="flex grow flex-col gap-6 px-4 py-6">{children}</main>
          </ApplyShell>
        )}
      />
    )
  return (
    <ApplyShell step={3} app={app}>
      <main className="flex flex-col gap-6 px-20 py-10">
        <Desktop app={app} />
      </main>
    </ApplyShell>
  )
}
