import { useQueryClient } from '@tanstack/react-query'
import { QrCode, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApplyShell } from '@/components/shell/apply-shell'
import type { MyApplication, NewHandoff } from '@/api/generated/model'
import { getMyApplicationQueryKey, useMyApplication } from '@/api/generated/apply/apply'
import { getCurrentHandoffQueryKey, useCurrentHandoff, useStartHandoff } from '@/api/generated/apply-id/apply-id'
import {
  addResultsPage,
  getApplicationResultsQueryKey,
  getMyDocumentFileUrl,
  readResultsScan,
  removeResultsPage,
  saveResults,
  useApplicationResults,
} from '@/api/generated/apply-results/apply-results'
import { errorMessage } from '@/lib/api'
import { useIsDesktop } from '@/lib/use-desktop'
import { applyHome, STEP_PATH } from '../common'
import { LINK_KEY, LinkGone, LinkPanel } from '../id/NationalId'
import { type ResultsApi, useDrafts, usePageUpload } from './hooks'
import { PagesCheck, Reading, ResultsFlow } from './ResultsFlow'
import { problem, scannedText, toBody } from './drafts'
import { SittingTable } from './ResultsTable'

const h1 = 'text-[28px] leading-9 font-semibold tracking-[-0.015em]'
const fileUrl = (id: string) => `/api${getMyDocumentFileUrl(id)}`
function useResultsApi(): ResultsApi {
  const qc = useQueryClient()
  const { data } = useApplicationResults({
    query: { refetchInterval: (q) => (q.state.data?.sittings.some((s) => s.status === 'reading') ? 1500 : 3000) },
  })
  const put = (s: unknown) => qc.setQueryData(getApplicationResultsQueryKey(), s)
  return {
    state: data,
    addPage: (file, scan, quality) => addResultsPage({ file, scan: scan ?? null, quality }).then(put),
    removePage: (id) => removeResultsPage(id).then(put),
    read: (scan) => readResultsScan(scan).then(put),
    save: async (body) => {
      put(await saveResults(body))
      await qc.invalidateQueries({ queryKey: getMyApplicationQueryKey() })
    },
    fileUrl,
  }
}

// design/ZimsecDesktop, with the phone or upload to get the slip in first.
function Desktop({ app }: { app: MyApplication }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const api = useResultsApi()
  const st = api.state
  const { send, busy } = usePageUpload(api)
  const { drafts, set, remove, reset, addBlank } = useDrafts(st)
  const files = useRef<HTMLInputElement>(null)
  const addTo = useRef<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [upload, setUpload] = useState(false)
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
  const phone = () => start.mutate({ data: { start_step: 'results' } })

  const input = (
    <input
      ref={files}
      type="file"
      multiple
      accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={async (e) => {
        const list = Array.from(e.target.files ?? [])
        e.target.value = ''
        let scan = addTo.current
        for (const f of list) {
          const ok = await send(f, scan, null)
          if (!ok) break
          scan ??= qc.getQueryData<typeof st>(getApplicationResultsQueryKey())?.sittings.find((s) => s.status === 'pages')?.key
        }
        setUpload(false)
      }}
    />
  )
  const choose = (scan?: string) => {
    addTo.current = scan
    files.current?.click()
  }

  if (!st || h === undefined) return <Skeleton className="h-80 max-w-[1040px]" />
  if (busy) return <Reading label="Uploading…" />
  const pending = st.sittings.find((s) => s.status === 'pages')
  const reading = st.sittings.some((s) => s.status === 'reading')
  const phoneOn = !upload && h?.state === 'connected'

  if (pending && !phoneOn)
    return (
      <div className="flex max-w-[640px] flex-col gap-6">
        {input}
        <PagesCheck scan={pending} api={api} onAddPage={() => choose(pending.key)} onRetake={() => choose(pending.key)} />
      </div>
    )
  if (reading) return <Reading />

  if (!drafts.length) {
    if (h && h.state === 'connected' && !upload)
      return (
        <section className="flex max-w-[720px] items-center gap-3 rounded-md border bg-card px-5 py-4">
          <span aria-hidden className="size-2 rounded-full bg-success" />
          <span className="grow font-medium">Phone connected{h.device && ` · ${h.device}`}</span>
          <span className="text-sm text-muted-foreground">
            {pending ? `${pending.pages.length} ${pending.pages.length === 1 ? 'page' : 'pages'} received` : 'Waiting for the photos'}
          </span>
        </section>
      )
    if (!upload && h && h.state === 'waiting' && link && link.match_code === h.match_code)
      return <LinkPanel link={link} app={app} back="ZIMSEC results options" what="photos of your result slip" onUpload={() => setUpload(true)} />
    if (!upload && h && h.state === 'expired' && link)
      return <LinkGone h={h} lost={false} starting={start.isPending} onNew={phone} onUpload={() => setUpload(true)} />
    return (
      <>
        {input}
        <div className="flex max-w-[720px] flex-col gap-2">
          <h1 className={h1}>ZIMSEC results</h1>
          <p className="text-muted-foreground">Photograph each result slip or certificate. We fill in the grades, then you check them.</p>
        </div>
        {st.sittings.some((s) => s.status === 'failed') && (
          <p role="alert" className="max-w-[720px] font-medium text-destructive">
            We couldn't find the subjects and grades on that page. Check it's your result slip or certificate and try again,
            or type your results in.
          </p>
        )}
        <div className="grid max-w-[1040px] grid-cols-2 gap-6">
          <section className="flex flex-col gap-4 rounded-md border border-primary bg-card p-6">
            <div>
              <Badge variant="info">Recommended</Badge>
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg leading-6 font-semibold">Continue on your phone</h2>
              <p className="text-muted-foreground">Phone cameras read slips best. The grades appear here to check.</p>
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
              <h2 className="text-lg leading-6 font-semibold">Upload scans from this computer</h2>
              <p className="text-muted-foreground">One file per page. JPG, PNG or PDF, up to 5 MB each.</p>
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-4">
              <Button variant="outline" onClick={() => choose()}>
                <Upload strokeWidth={1.5} />
                Choose files
              </Button>
              <button type="button" onClick={addBlank} className="text-primary hover:underline">
                Type my results in
              </button>
            </div>
          </section>
        </div>
      </>
    )
  }

  async function save() {
    const p = problem(drafts)
    setError(p)
    if (p) return
    setSaving(true)
    try {
      await api.save(toBody(drafts))
      reset()
      navigate(STEP_PATH.review)
    } catch (e) {
      setError(errorMessage(e, "Couldn't save. Try again."))
    } finally {
      setSaving(false)
    }
  }
  const unsure = drafts.reduce((n, d) => n + d.rows.filter((r) => r.check).length, 0)
  const slip = drafts[0]

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-12">
      {input}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className={h1}>ZIMSEC results</h1>
          <p className="text-muted-foreground">
            Check each grade against your slip.
            {unsure > 0 && ` We've outlined the ${unsure} we weren't sure about.`}
          </p>
        </div>
        {error && (
          <div role="alert" className="rounded-md border-2 border-destructive bg-card p-4 font-medium text-destructive">
            {error}
          </div>
        )}
        {drafts.map((d) => (
          <SittingTable
            key={d.key}
            d={d}
            set={(p) => set(d.key, p)}
            all={st.subjects}
            fileUrl={fileUrl}
            desktop
            onRemove={drafts.length > 1 ? () => remove(d.key) : undefined}
          />
        ))}
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => choose()}>
            Add another sitting
          </Button>
          <span className="text-sm text-muted-foreground">For example a June resit. We use your best grade for each subject.</span>
        </div>
        <div className="flex items-center gap-6 pt-2">
          <Button disabled={saving} onClick={() => void save()}>
            Save and continue
          </Button>
          <span className="text-sm text-muted-foreground">Next: review everything before you submit</span>
        </div>
      </div>
      {slip.pages[0] && (
        <aside className="sticky top-40 flex flex-col gap-3 pt-2">
          <span className="text-sm font-medium">Your slip</span>
          <img
            src={fileUrl(slip.pages[0].document_id)}
            alt="Scan of your result slip"
            className="aspect-[1/1.414] w-full rounded-sm border bg-muted object-cover object-top"
          />
          <p className="text-sm text-muted-foreground">{scannedText(slip)}</p>
          <a href={fileUrl(slip.pages[0].document_id)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            Open full size
          </a>
          <button type="button" onClick={phone} className="self-start text-primary hover:underline">
            Retake on my phone
          </button>
        </aside>
      )}
    </div>
  )
}

function Mobile({ app }: { app: MyApplication }) {
  const navigate = useNavigate()
  const api = useResultsApi()
  return (
    <ResultsFlow
      api={api}
      onBack={() => navigate(STEP_PATH.birth_certificate)}
      onSaved={() => navigate(STEP_PATH.review)}
      frame={(children) => (
        <ApplyShell step={4} app={app}>
          <main className="flex grow flex-col gap-6 px-4 py-6">{children}</main>
        </ApplyShell>
      )}
    />
  )
}

// Step 3 · ZIMSEC results
export default function Results() {
  const desktop = useIsDesktop()
  const { data: app, isPending } = useMyApplication()
  if (isPending) return <div className="min-h-dvh bg-background" aria-busy="true" />
  if (!app || app.status !== 'draft') return <Navigate to={applyHome(app)} replace />
  if (!desktop) return <Mobile app={app} />
  return (
    <ApplyShell step={4} app={app}>
      <main className="flex flex-col gap-6 px-20 py-10">
        <Desktop app={app} />
      </main>
    </ApplyShell>
  )
}
