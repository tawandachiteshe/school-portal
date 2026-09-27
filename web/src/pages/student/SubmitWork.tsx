import { CircleAlert, CircleCheck, Clock } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { SubPage } from '@/components/shell/sub-page'
import { Empty } from '@/components/student/section'
import { errorMessage } from '@/lib/api'
import { useAssessmentDetail } from '@/api/generated/deadlines/deadlines'
import type { AssessmentOut as AssessmentDetail } from '@/api/generated/model'
import { acceptedText } from '@/lib/deadlines'
import { calendarDaysBetween, fileKind, fileSize, isUrgent, relativeDue, shortDate, shortDateTime, time } from '@/lib/format'
import { KIND_LABEL } from '@/lib/student'
import { cancelUpload, retryUpload, startUpload, useUpload, type UploadState } from '@/lib/uploads'
import { useNow } from '@/lib/use-now'
import { useIsDesktop } from '@/lib/use-desktop'
import { DeskPage } from '@/components/shell/student-desktop'

const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1)

function kindOf(name: string, mime: string) {
  const ext = name.split('.').pop()?.toUpperCase()
  return mime === 'application/pdf' ? 'PDF' : ext && ext.length <= 4 ? ext : fileKind(mime)
}

function timeLeft(s: number | null) {
  if (s === null || !Number.isFinite(s)) return null
  if (s < 60) return `about ${Math.max(5, Math.round(s / 5) * 5)} s left`
  return `about ${Math.round(s / 60)} min left`
}

// "17:00 tomorrow", "17:00 today", "17:00 on Fri 12 Mar"
function beforeText(due: Date, now: Date) {
  const days = calendarDaysBetween(now, due)
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `on ${shortDate(due)}`
  return `${time(due)} ${day}`
}

function FileLine({ name, size, mime }: { name: string; size: number; mime: string }) {
  return (
    <div className="flex items-center gap-3">
      <Badge className="w-11 justify-center font-mono">{kindOf(name, mime)}</Badge>
      <div className="min-w-0 grow">
        <div className="truncate font-mono text-sm font-medium">{name}</div>
        <div className="text-sm text-muted-foreground">{fileSize(size)}</div>
      </div>
    </div>
  )
}

function UploadStatus({ u, due, now }: { u: UploadState; due: Date; now: Date }) {
  const pct = Math.round((u.received / u.size) * 100)
  if (u.phase === 'uploading')
    return (
      <div role="status" className="flex flex-col gap-2">
        <Progress value={pct} className="h-1.5" aria-label="Upload progress" />
        <div className="flex justify-between text-sm">
          <span>
            Uploading <span className="font-mono">{mb(u.received)}</span> of{' '}
            <span className="font-mono">{mb(u.size)} MB</span>
          </span>
          <span className="text-muted-foreground">{timeLeft(u.secondsLeft)}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          You can leave this page. If the signal drops, the upload carries on when it's back.
        </p>
      </div>
    )
  if (u.phase === 'queued')
    return (
      <Alert variant="info" role="status">
        <Clock strokeWidth={1.5} className="text-primary" />
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Waiting for a signal</p>
          <p className="text-sm">
            Your file is saved on this phone and uploads by itself when you're back online. It counts as submitted when
            the upload finishes, so try to get signal before {beforeText(due, now)}.
          </p>
        </div>
      </Alert>
    )
  if (u.phase === 'failed')
    return (
      <Alert variant="destructive">
        <CircleAlert strokeWidth={1.5} />
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Upload didn't finish</p>
          <p className="text-sm">
            {u.error ?? (
              <>
                The connection dropped at <span className="font-mono">{mb(u.received)}</span> of{' '}
                <span className="font-mono">{mb(u.size)} MB</span>.
              </>
            )}{' '}
            Your work has not been submitted yet.
          </p>
        </div>
      </Alert>
    )
  return null
}

function Receipt({ a }: { a: AssessmentDetail }) {
  const s = a.submission!
  return (
    <Alert variant="success">
      <CircleCheck strokeWidth={1.5} />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="font-semibold">
          {s.status === 'late' ? 'Submitted late' : 'Submitted'}
          {s.submitted_at && ` ${shortDateTime(new Date(s.submitted_at))}`}
        </p>
        {s.files.map((f) => (
          <div key={f.sha256} className="flex min-w-0 flex-col text-sm">
            <span className="truncate font-mono">{f.filename}</span>
            <span className="text-muted-foreground">{fileSize(f.size_bytes)}</span>
            <span className="break-all text-muted-foreground">
              Receipt (SHA-256): <span className="font-mono text-foreground">{f.sha256}</span>
            </span>
          </div>
        ))}
        {s.note && <p className="text-sm">Your note: {s.note}</p>}
      </div>
    </Alert>
  )
}

export default function SubmitWork() {
  const { id = '' } = useParams()
  const { data: a, isPending, error } = useAssessmentDetail(id)
  const upload = useUpload(id)
  const now = useNow(15_000)
  const inputRef = useRef<HTMLInputElement>(null)
  const noteId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const desktop = useIsDesktop()

  const title = <span className="font-semibold">Submit work</span>
  if (isPending || error || !a)
    return (
      <SubPage title={title} back="/deadlines" backLabel="Back to deadlines">
        <main className="flex flex-col gap-3 px-4 py-6">
          {isPending ? (
            <>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-8" />
              <Skeleton className="h-24" />
            </>
          ) : (
            <Empty>{errorMessage(error, "Couldn't load this assessment.")}</Empty>
          )}
        </main>
      </SubPage>
    )

  const due = new Date(a.due_at)
  const accept = acceptedText(a.accepted_extensions)
  const active = upload && upload.phase !== 'done'
  const submitted = a.submission !== null && !replacing && !active
  const choosing = !submitted && !active

  function choose(f: File | undefined) {
    setProblem(null)
    if (!f) return
    const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase()
    if (a!.accepted_extensions?.length && !a!.accepted_extensions.includes(ext))
      return setProblem(`Upload ${accept}. This file is ${ext === '.' ? 'not one of those' : ext}.`)
    if (f.size > a!.max_file_mb * 1_000_000)
      return setProblem(`This file is ${fileSize(f.size)}. The limit is ${a!.max_file_mb} MB.`)
    setFile(f)
  }

  async function submit() {
    if (!file) return
    setStarting(true)
    try {
      await startUpload(a!.id, file, note)
      setFile(null)
      setReplacing(false)
    } catch (e) {
      setProblem(errorMessage(e, "Couldn't start the upload. Check your connection and try again."))
    } finally {
      setStarting(false)
    }
  }

  const header = (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Badge>{KIND_LABEL[a.kind]}</Badge>
            <span className="font-mono text-sm text-muted-foreground">{a.module_code}</span>
          </div>
          <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">{a.title}</h1>
          <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
            Due {shortDateTime(due)}
            {!a.submission && isUrgent(due, now, false) && <Badge variant="urgent">{relativeDue(due, now)}</Badge>}
          </p>
          {a.description && <p className="mt-2">{a.description}</p>}
        </div>
  )
  const panel = (
    <>
        {submitted && <Receipt a={a} />}

        {!a.can_submit && !active && a.reason && (
          <Alert>
            <p className="text-sm">{a.reason}</p>
          </Alert>
        )}

        {(active || (choosing && a.can_submit)) && (
          <div className="flex flex-col gap-3 border-y py-4">
            {active && upload ? (
              <>
                <FileLine name={upload.filename} size={upload.size} mime="" />
                <UploadStatus u={upload} due={due} now={now} />
              </>
            ) : file ? (
              <>
                <FileLine name={file.name} size={file.size} mime={file.type} />
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex min-h-11 items-center self-start text-sm font-medium text-primary"
                >
                  Choose a different file
                </button>
              </>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <Button variant="outline" onClick={() => inputRef.current?.click()}>
                  Choose file
                </Button>
                <p className="text-sm text-muted-foreground">
                  {accept ? `Upload ${accept}` : 'Any file type'}, up to {a.max_file_mb} MB.
                  {!desktop && ' Under 2 MB is safest on mobile data.'}
                </p>
                {a.pending_upload && (
                  <p className="text-sm text-muted-foreground">
                    An upload of <span className="font-mono">{a.pending_upload.filename}</span> stopped at{' '}
                    {mb(a.pending_upload.received_bytes)} of {mb(a.pending_upload.size_bytes)} MB. Choose the file again
                    to finish.
                  </p>
                )}
              </div>
            )}
            {problem && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {problem}
              </p>
            )}
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              accept={a.accepted_extensions?.join(',') || undefined}
              onChange={(e) => {
                choose(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        )}

        {choosing && a.can_submit && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={noteId}>
              Note for {a.lecturer ?? 'your lecturer'} <span className="font-medium text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id={noteId} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </div>
        )}

        <div className="mt-auto flex flex-col gap-3">
          {active && upload?.phase === 'failed' ? (
            <>
              <Button block onClick={() => retryUpload(id)}>
                Try again
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Big scans often fail on mobile data. Under 2 MB is safest.
              </p>
            </>
          ) : active ? (
            <Button block variant="outline" onClick={() => cancelUpload(id)}>
              Cancel upload
            </Button>
          ) : submitted ? (
            a.can_submit && (
              <Button block variant="outline" onClick={() => setReplacing(true)}>
                Replace file
              </Button>
            )
          ) : (
            a.can_submit && (
              <>
                <Button block disabled={!file || starting} onClick={submit}>
                  {a.submission ? 'Submit new file' : 'Submit'}
                </Button>
                {replacing && (
                  <Button block variant="ghost" onClick={() => setReplacing(false)}>
                    Keep my earlier file
                  </Button>
                )}
              </>
            )
          )}
        </div>
    </>
  )
  if (desktop)
    return (
      <DeskPage crumbs={[{ to: '/deadlines', label: 'Deadlines' }, { label: a.title }]}>
        {header}
        <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-12">
          <div className="flex max-w-[640px] flex-col gap-6">{panel}</div>
          <aside className="flex flex-col gap-3 border-l pl-6 text-sm">
            <h2 className="font-semibold">About this assessment</h2>
            <dl className="flex flex-col gap-3">
              <div>
                <dt className="text-muted-foreground">Module</dt>
                <dd className="font-mono">{a.module_code}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Due</dt>
                <dd>{shortDateTime(due)}</dd>
              </div>
              {a.allow_late_until && (
                <div>
                  <dt className="text-muted-foreground">Late submissions until</dt>
                  <dd>{shortDateTime(new Date(a.allow_late_until))}</dd>
                </div>
              )}
              {a.submission_mode === 'online' && (
                <div>
                  <dt className="text-muted-foreground">Files</dt>
                  <dd>
                    {accept ? `${accept[0].toUpperCase()}${accept.slice(1)}` : 'Any file type'}, up to {a.max_file_mb} MB
                  </dd>
                </div>
              )}
              {a.lecturer && (
                <div>
                  <dt className="text-muted-foreground">Lecturer</dt>
                  <dd>{a.lecturer}</dd>
                </div>
              )}
            </dl>
            <p className="border-t pt-3 text-muted-foreground">
              It counts as submitted when the upload finishes. You get a receipt with the file's SHA-256 fingerprint.
            </p>
          </aside>
        </div>
      </DeskPage>
    )
  return (
    <SubPage title={title} back="/deadlines" backLabel="Back to deadlines">
      <main className="flex grow flex-col gap-6 px-4 py-6">
        {header}
        {panel}
      </main>
    </SubPage>
  )
}
