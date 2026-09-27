import { CircleCheck, Loader2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { ResultsState, SittingIn, SittingOut } from '@/api/generated/model'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { asFile, assessImage, compressImage } from '../id/compress'
import { IdCamera, type PhotoQuality } from '../id/IdCamera'
import { checkable, type Draft, problem, SittingTable, toBody, toDraft } from './ResultsTable'

export type ResultsApi = {
  state: ResultsState | undefined
  addPage: (file: File, scan: string | undefined, quality: string | null) => Promise<unknown>
  removePage: (documentId: string) => Promise<unknown>
  read: (scan: string) => Promise<unknown>
  save: (body: { sittings: SittingIn[] }) => Promise<unknown>
  fileUrl: (documentId: string) => string
}

const QUALITY = { clear: 'Clear', blurry: 'Blurry', dark: 'Too dark' } as const
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

// Photos → upload one page at a time, with a quality label.
export function usePageUpload(api: ResultsApi) {
  const [busy, setBusy] = useState(false)
  async function send(photo: Blob, scan: string | undefined, quality: PhotoQuality | null) {
    setBusy(true)
    try {
      const q = quality ?? (await assessImage(photo))
      await api.addPage(asFile(await compressImage(photo), 'zimsec-slip.jpg'), scan, q)
      return true
    } catch (e) {
      toast(errText(e, "Couldn't send the photo. Check your signal and try again."))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { send, busy }
}

// design/ZimsecPages
export function PagesCheck({ scan, api, onAddPage, onRetake }: { scan: SittingOut; api: ResultsApi; onAddPage: () => void; onRetake: (n: number) => void }) {
  const [reading, setReading] = useState(false)
  const poor = scan.pages.filter((p) => p.quality === 'blurry' || p.quality === 'dark')
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl leading-8 font-semibold">Check your pages</h1>
        <p className="text-muted-foreground">
          Make sure every subject and grade can be read. Add a page if your results continue on the back or on a second slip.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-4">
        {scan.pages.map((p) => {
          const bad = p.quality === 'blurry' || p.quality === 'dark'
          return (
            <li key={p.document_id} className="flex flex-col gap-2">
              <img
                src={api.fileUrl(p.document_id)}
                alt={`Page ${p.number}${bad ? `, ${QUALITY[p.quality!].toLowerCase()}` : ''}`}
                className={cn('aspect-[1/1.414] w-full rounded-sm border bg-muted object-cover', bad && 'border-2 border-urgent-line')}
              />
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Page {p.number}</span>
                {p.quality && (
                  <span className={bad ? 'font-medium text-urgent' : 'inline-flex items-center gap-1 text-success'}>
                    {!bad && <CircleCheck className="size-4" strokeWidth={1.5} aria-hidden />}
                    {QUALITY[p.quality]}
                  </span>
                )}
              </div>
              <Button
                block
                variant="outline"
                onClick={() =>
                  void api
                    .removePage(p.document_id)
                    .then(() => onRetake(p.number))
                    .catch((e) => toast(errText(e, "Couldn't remove the page.")))
                }
              >
                Retake
              </Button>
            </li>
          )
        })}
      </ul>
      {poor.length > 0 && (
        <Alert variant="urgent">
          <TriangleAlert strokeWidth={1.5} />
          <p>
            {poor.map((p) => `Page ${p.number}`).join(' and ')} {poor.length === 1 ? 'is' : 'are'}{' '}
            {poor.every((p) => p.quality === 'dark') ? 'too dark' : 'blurry'}. Retake {poor.length === 1 ? 'it' : 'them'}, or we
            may not be able to read those grades.
          </p>
        </Alert>
      )}
      {scan.pages.length < 4 && (
        <Button variant="ghost" className="self-start px-1" onClick={onAddPage}>
          Add another page
        </Button>
      )}
      <div className="mt-auto flex flex-col gap-2">
        <Button
          block
          disabled={reading}
          onClick={() => {
            setReading(true)
            void api
              .read(scan.key)
              .catch((e) => toast(errText(e, "Couldn't start reading. Try again.")))
              .finally(() => setReading(false))
          }}
        >
          Read my results
        </Button>
        <p className="text-center text-sm text-muted-foreground">You'll check every grade on the next screen.</p>
      </div>
    </>
  )
}

export function Reading({ label = 'Reading your results…' }: { label?: string }) {
  return (
    <div role="status" className="flex grow flex-col items-center justify-center gap-3 py-16 text-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" strokeWidth={1.5} aria-hidden />
      <p className="font-medium">{label}</p>
      <p className="text-sm text-muted-foreground">This usually takes a few seconds for each page.</p>
    </div>
  )
}

const blank = (key: string): Draft => ({
  key,
  status: 'read',
  level: 'O',
  session: 'NOVEMBER',
  year: '',
  centre: '',
  candidate: '',
  name: null,
  rows: [],
  pages: [],
  read_at: null,
  editing: true,
})

// Edits are kept per sitting until saved; the server's copy fills in the rest.
export function useDrafts(state: ResultsState | undefined) {
  const [edits, setEdits] = useState<Record<string, Draft>>({})
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [typed, setTyped] = useState<string[]>([]) // sittings typed in by hand, not read from a photo
  const drafts = state
    ? [
        ...checkable(state)
          .filter((s) => !removed.has(s.key))
          .map((s) => (edits[s.key] && edits[s.key].status === s.status ? edits[s.key] : toDraft(s))),
        ...typed.filter((k) => !removed.has(k)).map((k) => edits[k] ?? blank(k)),
      ]
    : []
  const addBlank = () => setTyped((t) => [...t, `typed-${t.length + 1}`])
  const set = (key: string, p: Partial<Draft>) =>
    setEdits((e) => ({ ...e, [key]: { ...(e[key] ?? drafts.find((d) => d.key === key)!), ...p } }))
  const remove = (key: string) => setRemoved((r) => new Set(r).add(key))
  const reset = () => {
    setEdits({})
    setRemoved(new Set())
    setTyped([])
  }
  return { drafts, set, remove, reset, addBlank }
}

type Camera = { scan?: string; page: number }

// Mobile and linked phone: photograph → check pages → read → check grades → save.
export function ResultsFlow({
  api,
  frame,
  onBack,
  onSaved,
  step = 'Step 4 of 6',
}: {
  api: ResultsApi
  frame: (children: React.ReactNode) => React.ReactNode
  onBack: () => void
  onSaved: () => void
  step?: string
}) {
  const [camera, setCamera] = useState<Camera | null>(null)
  const { send, busy } = usePageUpload(api)
  const { drafts, set, remove, reset, addBlank } = useDrafts(api.state)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const st = api.state
  if (!st) return frame(<Reading label="Loading…" />)

  if (camera)
    return (
      <IdCamera
        kind="slip"
        page={camera.page}
        step={step}
        onBack={() => setCamera(null)}
        onPhoto={(b, q) => {
          const target = camera
          setCamera(null)
          void send(b, target.scan, q)
        }}
      />
    )
  if (busy) return frame(<Reading label="Sending your photo…" />)

  const pending = st.sittings.find((s) => s.status === 'pages')
  if (pending)
    return frame(
      <PagesCheck
        scan={pending}
        api={api}
        onAddPage={() => setCamera({ scan: pending.key, page: pending.pages.length + 1 })}
        onRetake={(n) => setCamera({ scan: pending.key, page: n })}
      />,
    )
  if (st.sittings.some((s) => s.status === 'reading')) return frame(<Reading />)

  const failed = st.sittings.find((s) => s.status === 'failed')
  if (!drafts.length)
    return frame(
      <>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl leading-8 font-semibold">ZIMSEC results</h1>
          <p className="text-muted-foreground">Photograph each result slip or certificate. We fill in the grades, then you check them.</p>
        </div>
        {failed && (
          <Alert variant="urgent">
            <TriangleAlert strokeWidth={1.5} />
            <p>
              We couldn't find the subjects and grades on that page. Check it's your result slip or certificate and try again,
              or type your results in.
            </p>
          </Alert>
        )}
        <div className="mt-auto flex flex-col gap-3">
          <Button block onClick={() => setCamera({ page: 1 })}>
            Photograph my result slip
          </Button>
          <Button block variant="outline" onClick={addBlank}>
            Type my results in
          </Button>
          <Button block variant="ghost" onClick={onBack}>
            Back
          </Button>
        </div>
      </>,
    )

  async function save() {
    const p = problem(drafts)
    setError(p)
    if (p) return
    setSaving(true)
    try {
      await api.save(toBody(drafts))
      reset()
      onSaved()
    } catch (e) {
      setError(errText(e, "Couldn't save. Check your signal and try again."))
    } finally {
      setSaving(false)
    }
  }

  return frame(
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl leading-8 font-semibold">ZIMSEC results</h1>
        <p className="text-muted-foreground">Check each grade against your slip. Change anything we got wrong.</p>
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
          fileUrl={api.fileUrl}
          desktop={false}
          onAddPhoto={d.status === 'read' ? () => setCamera({ scan: d.key, page: d.pages.length + 1 }) : undefined}
          onRemove={drafts.length > 1 ? () => remove(d.key) : undefined}
        />
      ))}
      <section className="flex flex-col items-start gap-3 border-t pt-6">
        <h2 className="font-semibold">Wrote any subjects again?</h2>
        <p className="text-sm text-muted-foreground">Add each sitting, for example a June resit. We use your best grade for each subject.</p>
        <Button variant="outline" onClick={() => setCamera({ page: 1 })}>
          Add another sitting
        </Button>
      </section>
      <div className="mt-auto">
        <Button block disabled={saving} onClick={() => void save()}>
          Save and continue
        </Button>
      </div>
    </>,
  )
}
