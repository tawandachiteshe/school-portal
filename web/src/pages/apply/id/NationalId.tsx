import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CircleCheck, Loader2, QrCode, Upload } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApplyShell } from '@/components/shell/apply-shell'
import type { HandoffOut, MyApplication, NationalIdState, NewHandoff } from '@/api/generated/model'
import { getMyApplicationQueryKey, useMyApplication } from '@/api/generated/apply/apply'
import {
  confirmNationalId,
  getCurrentHandoffQueryKey,
  getNationalIdQueryKey,
  uploadNationalId,
  useCurrentHandoff,
  useDisconnectHandoff,
  useNationalId,
  useSendHandoffLink,
  useStartHandoff,
} from '@/api/generated/apply-id/apply-id'
import { ApiError } from '@/lib/api'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { applyHome, STEP_PATH } from '../common'
import { asFile, compressImage } from './compress'
import { IdCheck } from './IdCheck'
import { PhoneFlow } from './PhoneFlow'

const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Harare' })
const longDob = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const title = (s?: string | null) => (s ?? '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase())
const h1 = 'text-[28px] leading-9 font-semibold tracking-[-0.015em]'
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)
export const LINK_KEY = 'tcfl-handoff' // the link is shown once: keep it for this tab only

function registration(s: NationalIdState) {
  return [s.registered_in && `Registered in ${s.registered_in}`, s.origin && `Origin ${s.origin}`].filter(Boolean).join(' · ')
}

function IdDetails({ s }: { s: NationalIdState }) {
  const f = s.fields
  return (
    <dl className="grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 gap-y-2.5">
      <dt className="pt-0.5 text-sm text-muted-foreground">ID number</dt>
      <dd className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-lg">{f.id_number ?? '—'}</span>
        {s.check_letter_valid && <Badge variant="success">Check letter valid</Badge>}
      </dd>
      <dt className="pt-0.5 text-sm text-muted-foreground">Name</dt>
      <dd>
        {title(f.first_names)} {title(f.surname)}
      </dd>
      <dt className="pt-0.5 text-sm text-muted-foreground">Date of birth</dt>
      <dd>{f.date_of_birth ? longDob.format(new Date(`${f.date_of_birth}T12:00:00`)) : '—'}</dd>
      {registration(s) && (
        <>
          <dt className="pt-0.5 text-sm text-muted-foreground">Registration</dt>
          <dd className="text-muted-foreground">{registration(s)}</dd>
        </>
      )}
    </dl>
  )
}

function useRefresh() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: getNationalIdQueryKey() }),
      qc.invalidateQueries({ queryKey: getCurrentHandoffQueryKey() }),
      qc.invalidateQueries({ queryKey: getMyApplicationQueryKey() }),
    ])
}

// --- design/IdDesktop ----------------------------------------------------------------------------

function Options({ onPhone, starting, onFile }: { onPhone: () => void; starting: boolean; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <>
      <div className="flex max-w-[720px] flex-col gap-2">
        <h1 className={h1}>Add your National ID</h1>
        <p className="text-muted-foreground">
          We read your ID number, name and date of birth from a photo of the front of your ID. Metal and plastic IDs both
          work.
        </p>
      </div>
      <div className="grid max-w-[1040px] grid-cols-2 gap-6">
        <section className="flex flex-col gap-4 rounded-md border border-primary bg-card p-6">
          <div>
            <Badge variant="info">Recommended</Badge>
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg leading-6 font-semibold">Continue on your phone</h2>
            <p className="text-muted-foreground">
              Recommended for clearer scans. Phone cameras focus better than laptop webcams and most IDs get read on the
              first try.
            </p>
          </div>
          <ol className="flex flex-col gap-1.5 text-sm">
            {['Scan a QR code, or get the link by SMS', 'Photograph your ID on your phone', 'The details appear here as well'].map(
              (t, i) => (
                <li key={t} className="flex gap-2">
                  <span className="font-mono text-muted-foreground">{i + 1}</span>
                  {t}
                </li>
              ),
            )}
          </ol>
          <div className="mt-auto">
            <Button disabled={starting} onClick={onPhone}>
              <QrCode strokeWidth={1.5} />
              Continue on my phone
            </Button>
          </div>
        </section>
        <section className="flex flex-col gap-4 rounded-md border bg-card p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg leading-6 font-semibold">Upload a file from this computer</h2>
            <p className="text-muted-foreground">Use this if you already have a clear scan or photo of your ID.</p>
          </div>
          <label
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const f = e.dataTransfer.files[0]
              if (f) onFile(f)
            }}
            className={cn(
              'flex cursor-pointer flex-col items-start gap-2 rounded-md border border-dashed border-input bg-background p-5 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
              over && 'border-primary bg-primary-soft',
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <Upload className="size-4" strokeWidth={1.5} aria-hidden />
              Drag a file here, or <span className="text-primary underline underline-offset-2">choose a file</span>
            </span>
            <span className="text-sm text-muted-foreground">JPG, PNG or PDF, up to 5 MB. Front of the ID only.</span>
            <input
              ref={input}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onFile(f)
                e.target.value = ''
              }}
            />
          </label>
        </section>
      </div>
      <div className="flex max-w-[720px] flex-col gap-2">
        <h2 className="font-semibold">What we do with it</h2>
        <p className="text-sm text-muted-foreground">
          We check the ID number and its check letter, and compare your name and date of birth with your ZIMSEC results.
          Admissions staff see the photo.
        </p>
      </div>
    </>
  )
}

// --- design/Handoff --------------------------------------------------------------------------------

function useCountdown(until: string) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

export function LinkPanel({
  link,
  app,
  onUpload,
  back = 'National ID options',
  what = 'a photo of your ID',
}: {
  link: NewHandoff
  app: MyApplication
  onUpload: () => void
  back?: string
  what?: string
}) {
  const [qr, setQr] = useState<string>()
  const url = `${window.location.origin}/h/${link.token}`
  const typed = `${window.location.host}/h/${link.code}`
  const left = useCountdown(link.claim_expires_at)
  useEffect(() => {
    void QRCode.toDataURL(url, { margin: 0, width: 368, errorCorrectionLevel: 'M' }).then(setQr)
  }, [url])
  const sms = useSendHandoffLink({
    mutation: {
      onSuccess: () => toast(`Link queued to ${app.phone_masked}. It arrives when the SMS service sends it.`),
      onError: (e) => toast(errText(e, "Couldn't send the SMS.")),
    },
  })
  return (
    <>
      <div className="flex max-w-[720px] flex-col gap-2">
        <button type="button" onClick={onUpload} className="inline-flex min-h-6 items-center gap-1 self-start text-primary hover:underline">
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
          {back}
        </button>
        <h1 className={h1}>Continue on your phone</h1>
        <p className="text-muted-foreground">
          Open the link on your phone, take {what}, and this page updates by itself. Keep this page open.
        </p>
      </div>
      <section className="grid max-w-[1120px] grid-cols-[248px_minmax(0,1fr)_300px] rounded-md border bg-card">
        <div className="flex flex-col gap-3 border-r p-6">
          <div className="size-[200px] rounded-sm border bg-white p-2">
            {qr && <img src={qr} alt="QR code with the link to continue on your phone" className="size-full" />}
          </div>
          <p className="text-sm text-muted-foreground">Point your phone camera at the code.</p>
        </div>
        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Or type this link on your phone</span>
            <div className="flex items-center gap-2">
              <span className="grow rounded-sm border bg-background px-3 py-2.5 font-mono text-lg">{typed}</span>
              <Button
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(`${window.location.origin}/h/${link.code}`)
                    .then(() => toast('Link copied.'))
                    .catch(() => toast('Copy it by hand: select the link and copy.'))
                }
              >
                Copy
              </Button>
            </div>
          </div>
          <div className="h-px bg-border" />
          <div className="flex flex-col items-start gap-2">
            <span className="text-sm font-medium">Or get the link by SMS</span>
            <Button variant="outline" disabled={!app.phone_masked || sms.isPending} onClick={() => sms.mutate({ data: { code: link.code } })}>
              Send the link to my phone
            </Button>
            <span className="text-sm text-muted-foreground">
              {app.phone_masked ? (
                <>
                  To your verified number <span className="font-mono text-foreground">{app.phone_masked}</span>
                </>
              ) : (
                'There’s no verified phone number on your account.'
              )}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-r-md border-l bg-background p-6">
          <span className="text-sm font-medium">Match code</span>
          <span className="font-mono text-5xl leading-[56px] font-semibold tracking-[0.12em]">{link.match_code}</span>
          <p className="text-sm">Check your phone shows the same code. If it doesn't, don't continue on that phone.</p>
          <div className="mt-auto text-sm text-muted-foreground">
            Link expires in{' '}
            <span role="timer" className="font-mono font-medium text-foreground">
              {left}
            </span>
          </div>
        </div>
      </section>
      <button type="button" onClick={onUpload} className="self-start text-primary hover:underline">
        Upload a file from this computer instead
      </button>
    </>
  )
}

// design/HandoffExpired (also when this tab no longer has the link it showed)
export function LinkGone({ h, lost, onNew, onUpload, starting }: { h: HandoffOut; lost: boolean; onNew: () => void; onUpload: () => void; starting: boolean }) {
  return (
    <>
      <h1 className={h1}>Continue on your phone</h1>
      <section className="grid max-w-[1120px] grid-cols-[248px_minmax(0,1fr)] rounded-md border bg-card">
        <div className="border-r p-6">
          <div aria-hidden className="flex size-[200px] items-center justify-center rounded-sm border border-dashed border-input bg-muted">
            <QrCode className="size-8 text-muted-foreground" strokeWidth={1.5} />
          </div>
        </div>
        <div role="alert" className="flex flex-col items-start gap-3 p-8">
          <h2 className="text-lg leading-6 font-semibold">
            {lost ? 'Create a new link to continue.' : 'This link has expired. Create a new one.'}
          </h2>
          <p className="max-w-[560px] text-muted-foreground">
            {lost ? (
              'Links are shown once, so a new one is needed on this page.'
            ) : (
              <>
                Links last 15 minutes so nobody else can use them. The old code{' '}
                <span className="font-mono text-foreground">{h.match_code}</span> no longer works on any phone.
              </>
            )}{' '}
            Nothing you added has been lost.
          </p>
          <div className="mt-2 flex gap-3">
            <Button disabled={starting} onClick={onNew}>
              Create a new link
            </Button>
            <Button variant="outline" onClick={onUpload}>
              Upload from this computer instead
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}

// design/HandoffWaiting (stage reading / read)
function Connected({ h, onContinue }: { h: HandoffOut; onContinue: () => void }) {
  const refresh = useRefresh()
  const disconnect = useDisconnectHandoff({ mutation: { onSuccess: () => void refresh() } })
  const id = h.national_id
  const done = id.status === 'confirmed'
  return (
    <>
      <div className="flex max-w-[720px] flex-col gap-2">
        <h1 className={h1}>Continue on your phone</h1>
        <p className="text-muted-foreground">You can finish on either device. Everything you add on your phone shows up here as well.</p>
      </div>
      <div className="grid max-w-[1120px] grid-cols-[minmax(0,1fr)_300px] items-start gap-8">
        <section className="rounded-md border bg-card">
          <div className="flex items-center gap-3 border-b py-3 pr-3 pl-5">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
            <span className="grow font-medium">Phone connected{h.device && ` · ${h.device}`}</span>
            <span className="text-sm text-muted-foreground">
              Match code <span className="font-mono text-foreground">{h.match_code}</span>
            </span>
            <Button variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
              Disconnect
            </Button>
          </div>
          <ul aria-live="polite" className="[&>li+li]:border-t">
            <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 p-5">
              <span className="pt-0.5">
                {done ? (
                  <CircleCheck className="size-5 text-success" strokeWidth={1.5} aria-label="Done" />
                ) : id.status === 'none' ? (
                  <span aria-hidden className="block size-5 rounded-full border-[1.5px] border-input" />
                ) : (
                  <Loader2 className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" strokeWidth={1.5} aria-hidden />
                )}
              </span>
              <div className="flex flex-col gap-4">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-semibold">National ID</span>
                  <span className={cn('text-sm', done ? 'font-medium text-success' : 'text-muted-foreground')}>
                    {id.status === 'none'
                      ? 'Waiting for the photo'
                      : id.status === 'reading'
                        ? `Received ${hm.format(new Date(id.received_at!))}, reading…`
                        : id.status === 'confirmed'
                          ? `Saved${id.read_at ? ` ${hm.format(new Date(id.read_at))}` : ''}`
                          : 'Read, checking on the phone'}
                  </span>
                </div>
                {id.status === 'reading' && (
                  <div aria-hidden className="grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 gap-y-3.5">
                    {[96, 180, 64, 140, 88, 120].map((w, i) => (
                      <span key={i} className="h-3 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" style={{ width: w }} />
                    ))}
                  </div>
                )}
                {(id.status === 'read' || done) && <IdDetails s={id} />}
              </div>
            </li>
            <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 p-5">
              <span aria-hidden className="mt-0.5 block size-5 rounded-full border-[1.5px] border-input" />
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">ZIMSEC results</span>
                <span className="text-sm text-muted-foreground">{h.results_started ? 'Started' : 'Not started'}</span>
              </div>
            </li>
          </ul>
        </section>
        <aside className="flex flex-col gap-3">
          <h2 className="font-semibold">You can finish on either device</h2>
          <p className="text-sm text-muted-foreground">
            Carry on here, or keep going on your phone. If you close this page, the phone keeps working until you disconnect
            it.
          </p>
          <div>
            <Button disabled={!done} onClick={onContinue}>
              Continue to ZIMSEC results
            </Button>
          </div>
        </aside>
      </div>
    </>
  )
}

function Added({ s, onChange, onContinue }: { s: NationalIdState; onChange: () => void; onContinue: () => void }) {
  return (
    <>
      <div role="status" className="flex max-w-[720px] flex-col gap-2">
        <h1 className={h1}>National ID added</h1>
        <p className="text-muted-foreground">We'll compare these details with your ZIMSEC results.</p>
      </div>
      <section className="max-w-[720px] rounded-md border bg-card p-6">
        <IdDetails s={s} />
      </section>
      <div className="flex items-center gap-6">
        <Button onClick={onContinue}>Continue to ZIMSEC results</Button>
        <button type="button" onClick={onChange} className="text-primary hover:underline">
          Use a different photo
        </button>
      </div>
    </>
  )
}

function Desktop({ app }: { app: MyApplication }) {
  const navigate = useNavigate()
  const refresh = useRefresh()
  const [link, setLink] = useState<NewHandoff | null>(() => {
    try {
      const v = sessionStorage.getItem(LINK_KEY)
      return v ? (JSON.parse(v) as NewHandoff) : null
    } catch {
      return null
    }
  })
  const [view, setView] = useState<'auto' | 'upload'>('auto')
  const { data: id } = useNationalId({
    query: { refetchInterval: (q) => (q.state.data?.status === 'reading' ? 1500 : false) },
  })
  const { data: h } = useCurrentHandoff({
    query: {
      refetchInterval: (q) => {
        const s = q.state.data
        return s && (s.state === 'waiting' || s.state === 'connected') ? 2000 : false
      },
    },
  })
  useEffect(() => {
    if (h?.national_id.status === 'confirmed') void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h?.national_id.status])
  const start = useStartHandoff({
    mutation: {
      onSuccess: (x) => {
        setLink(x)
        setView('auto')
        try {
          sessionStorage.setItem(LINK_KEY, JSON.stringify(x))
        } catch {
          /* private mode: the link lasts until reload */
        }
        void refresh()
      },
      onError: (e) => toast(errText(e, "Couldn't create a link. Try again.")),
    },
  })
  const [uploading, setUploading] = useState(false)
  async function upload(file: File) {
    setUploading(true)
    try {
      await uploadNationalId({ file: asFile(await compressImage(file), file.name) })
      await refresh()
      setView('upload')
    } catch (e) {
      toast(errText(e, "Couldn't upload the file. Try again."))
    } finally {
      setUploading(false)
    }
  }
  if (!id || h === undefined) return <Skeleton className="h-80 max-w-[1040px]" />
  const goOn = () => navigate(STEP_PATH.results)
  const newLink = () => start.mutate({ data: { start_step: 'national_id' } })
  const usePhone = h && view === 'auto' && ['waiting', 'connected', 'expired'].includes(h.state)

  if (usePhone && h.state === 'connected') return <Connected h={h} onContinue={goOn} />
  if (id.status === 'confirmed' && view !== 'upload') return <Added s={id} onChange={() => setView('upload')} onContinue={goOn} />
  if (usePhone && h.state === 'waiting' && link && link.match_code === h.match_code)
    return <LinkPanel link={link} app={app} onUpload={() => setView('upload')} />
  if (usePhone && (h.state === 'expired' || h.state === 'waiting'))
    return <LinkGone h={h} lost={h.state === 'waiting'} starting={start.isPending} onNew={newLink} onUpload={() => setView('upload')} />
  if (uploading || id.status === 'reading')
    return (
      <div role="status" className="flex items-center gap-3 py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" strokeWidth={1.5} aria-hidden />
        <span>{uploading ? 'Uploading…' : 'Reading your ID…'}</span>
      </div>
    )
  if (view === 'upload' && (id.status === 'read' || id.status === 'failed'))
    return (
      <div className="flex max-w-[480px] flex-col">
        <IdCheck
          key={`${id.document_id}-${id.status}`}
          state={id}
          where="on this computer"
          onRetake={() => setView('auto')}
          onSave={async (body) => {
            await confirmNationalId(body)
            await refresh()
            setView('auto')
          }}
        />
      </div>
    )
  return <Options starting={start.isPending} onPhone={newLink} onFile={(f) => void upload(f)} />
}

function Mobile({ app }: { app: MyApplication }) {
  const navigate = useNavigate()
  const refresh = useRefresh()
  const [again, setAgain] = useState(false)
  const { data: id } = useNationalId({
    query: { refetchInterval: (q) => (q.state.data?.status === 'reading' ? 1500 : false) },
  })
  if (!id) return <Skeleton className="m-4 h-80" />
  const frame = (children: React.ReactNode) => (
    <ApplyShell step={2} app={app}>
      <main className="flex grow flex-col gap-6 px-4 py-6">{children}</main>
    </ApplyShell>
  )
  if (id.status === 'confirmed' && !again)
    return frame(
      <>
        <div role="status" className="flex flex-col gap-3">
          <CircleCheck className="size-6 text-success" strokeWidth={1.5} aria-hidden />
          <h1 className="text-2xl leading-8 font-semibold">National ID added</h1>
        </div>
        <IdDetails s={id} />
        <div className="mt-auto flex flex-col gap-3">
          <Button block onClick={() => navigate(STEP_PATH.results)}>
            Continue to ZIMSEC results
          </Button>
          <Button block variant="outline" onClick={() => setAgain(true)}>
            Use a different photo
          </Button>
        </div>
      </>,
    )
  return (
    <PhoneFlow
      state={again ? undefined : id}
      upload={async (file) => {
        await uploadNationalId({ file })
        setAgain(false)
        await refresh()
      }}
      confirm={async (body) => {
        await confirmNationalId(body)
        await refresh()
      }}
      onBack={() => (again ? setAgain(false) : navigate(STEP_PATH.programme))}
      frame={frame}
    />
  )
}

// Step 2 · National ID
export default function NationalId() {
  const desktop = useIsDesktop()
  const { data: app, isPending } = useMyApplication()
  if (isPending) return <div className="min-h-dvh bg-background" aria-busy="true" />
  if (!app || app.status !== 'draft') return <Navigate to={applyHome(app)} replace />
  if (!desktop) return <Mobile app={app} />
  return (
    <ApplyShell step={2} app={app}>
      <main className="flex flex-col gap-6 px-20 py-10">
        <Desktop app={app} />
      </main>
    </ApplyShell>
  )
}
