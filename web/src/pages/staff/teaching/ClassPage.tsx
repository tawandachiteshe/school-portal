import { useQueryClient } from '@tanstack/react-query'
import { Check, Search, Upload } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StaffTopBar } from '@/components/shell/staff-shell'
import type { ClassPage as ClassData } from '@/api/generated/model'
import { getClassPageQueryKey, getOverviewQueryKey, useClassPage, useUploadNotes } from '@/api/generated/teaching/teaching'
import { ApiError } from '@/lib/api'
import { fileKind, fileSize, shortDate, shortDateTime } from '@/lib/format'
import { KIND_LABEL } from '@/lib/student'
import { useMe } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from './staff-ui'

const DAYS = ['', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']
const TABS = ['students', 'notes', 'assessments'] as const
type Tab = (typeof TABS)[number]

function titleFromFile(name: string) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// design/LecturerUpload dialog
function UploadDialog({ c, open, onOpenChange }: { c: ClassData; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const { data: me } = useMe()
  const fileRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const weekId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [week, setWeek] = useState<string>(String(me?.term?.week ?? 1))
  const [share, setShare] = useState<Set<string>>(new Set([c.offering_id]))
  const upload = useUploadNotes({
    mutation: {
      onSuccess: (r) => {
        toast(`Shared with ${r.students} students.`)
        for (const id of share) void qc.invalidateQueries({ queryKey: getClassPageQueryKey(id) })
        void qc.invalidateQueries({ queryKey: getOverviewQueryKey() })
        onOpenChange(false)
        setFile(null)
        setTitle('')
      },
    },
  })
  const students = c.other_classes.filter((x) => share.has(x.offering_id)).reduce((n, x) => n + x.students, 0)
  const weeks = me?.term?.weeks ?? 16
  const error = upload.error instanceof ApiError ? upload.error.message : upload.error ? "Couldn't upload. Try again." : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-[560px] flex-col gap-0 p-0">
        <div className="flex items-center border-b px-6 py-4">
          <DialogTitle className="text-lg leading-6 font-semibold">Upload notes</DialogTitle>
        </div>
        <div className="flex flex-col gap-5 px-6 py-5">
          {file ? (
            <div className="flex items-center gap-3 rounded-md border bg-background p-3">
              <Badge className="w-11 justify-center font-mono">{fileKind(file.type)}</Badge>
              <div className="min-w-0 grow">
                <div className="truncate font-mono text-sm font-medium">{file.name}</div>
                <div className="text-sm text-muted-foreground">{fileSize(file.size)}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                Replace
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const f = e.dataTransfer.files[0]
                if (f) {
                  setFile(f)
                  setTitle((t) => t || titleFromFile(f.name))
                }
              }}
              className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-strong bg-background p-4 text-sm"
            >
              <Upload className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <span className="font-medium">Choose a file or drop it here</span>
              <span className="text-muted-foreground">PDF, slides or documents, up to 50 MB</span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) {
                setFile(f)
                setTitle((t) => t || titleFromFile(f.name))
              }
              e.target.value = ''
            }}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={titleId}>Title students will see</Label>
            <Input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={weekId}>Week</Label>
              <select
                id={weekId}
                value={week}
                onChange={(e) => setWeek(e.target.value)}
                className="h-11 rounded-sm border border-input bg-card px-3"
              >
                {Array.from({ length: weeks }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    Week {i + 1}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">Share with</legend>
              <div className="flex h-11 items-center gap-5">
                {c.other_classes.map((x) => (
                  <label key={x.offering_id} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={share.has(x.offering_id)}
                      onChange={(e) =>
                        setShare((s) => {
                          const n = new Set(s)
                          if (e.target.checked) n.add(x.offering_id)
                          else n.delete(x.offering_id)
                          return n
                        })
                      }
                    />
                    <span className="font-mono">{x.class_group}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <p className="text-sm text-muted-foreground">
            {students} students get it in <span className="text-foreground">New notes</span> on their dashboard. Large
            files show a size warning to students on mobile data.
          </p>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!file || !title.trim() || share.size === 0 || upload.isPending}
            onClick={() =>
              file &&
              upload.mutate({
                data: { file, title: title.trim(), week: Number(week), offering_ids: [...share] },
              })
            }
          >
            {upload.isPending ? 'Uploading…' : `Share with ${students} students`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-[300px]">
      <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <Input
        type="search"
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 pl-8 text-sm"
      />
    </div>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-sm border border-input bg-card px-2 text-sm"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

const matches = (q: string, ...fields: (string | null | undefined)[]) => {
  const t = q.trim().toLowerCase()
  return !t || fields.some((f) => f?.toLowerCase().includes(t))
}

const LOW_ATTENDANCE = 75 // percent; shown in red

export default function ClassPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'students'
  const uploadOpen = params.get('upload') === '1'
  const setUpload = (open: boolean) => {
    const p = new URLSearchParams(params)
    if (open) p.set('upload', '1')
    else p.delete('upload')
    setParams(p, { replace: true })
  }
  const [query, setQuery] = useState<Record<Tab, string>>({ students: '', notes: '', assessments: '' })
  const [attendance, setAttendance] = useState('all')
  const [week, setWeek] = useState('all')
  const [kind, setKind] = useState('all')
  const [status, setStatus] = useState('all')
  const { data: c, isPending, error } = useClassPage(id)
  if (isPending) return <Skeleton className="m-8 h-96" />
  if (error || !c)
    return <p className="p-8 text-muted-foreground">{error instanceof ApiError ? error.message : "Couldn't load this class."}</p>

  const now = new Date()
  const q = query[tab]
  const setQ = (v: string) => setQuery((x) => ({ ...x, [tab]: v }))
  const pct = (s: ClassData['students'][number]) => (s.sessions ? Math.round((s.attended / s.sessions) * 100) : null)
  const students = c.students
    .map((s, i) => ({ ...s, n: i + 1 }))
    .filter((s) => matches(q, s.name, s.student_number))
    .filter((s) =>
      attendance === 'low' ? (pct(s) ?? 100) < LOW_ATTENDANCE : attendance === 'none' ? s.sessions === 0 : true,
    )
  const weeks = [...new Set(c.notes.map((n) => n.week).filter((w): w is number => w !== null))].sort((a, b) => b - a)
  const notes = c.notes.filter((n) => matches(q, n.title)).filter((n) => week === 'all' || String(n.week) === week)
  const aStatus = (a: ClassData['assessments'][number]) =>
    a.released ? 'published' : new Date(a.due_at) <= now ? 'to_mark' : 'upcoming'
  const kinds = [...new Set(c.assessments.map((a) => a.kind))]
  const assessments = c.assessments
    .filter((a) => matches(q, a.title))
    .filter((a) => kind === 'all' || a.kind === kind)
    .filter((a) => status === 'all' || aStatus(a) === status)
  const shown = { students: students.length, notes: notes.length, assessments: assessments.length }[tab]
  const total = { students: c.students.length, notes: c.notes.length, assessments: c.assessments.length }[tab]
  const filtered =
    q.trim() !== '' ||
    (tab === 'students' && attendance !== 'all') ||
    (tab === 'notes' && week !== 'all') ||
    (tab === 'assessments' && (kind !== 'all' || status !== 'all'))
  const clear = () => {
    setQ('')
    if (tab === 'students') setAttendance('all')
    if (tab === 'notes') setWeek('all')
    if (tab === 'assessments') {
      setKind('all')
      setStatus('all')
    }
  }

  const slots = c.weekly_slots.map((s) => `${DAYS[s.day_of_week]} ${s.starts_at}${s.venue ? ` ${s.venue}` : ''}`).join(', ')
  return (
    <>
      <StaffTopBar
        left={c.term_name}
        right={
          <Button variant="outline" size="sm" onClick={() => setUpload(true)}>
            <Upload strokeWidth={1.5} className="size-4" />
            Upload notes
          </Button>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(t) => {
          const p = new URLSearchParams(params)
          p.set('tab', t)
          setParams(p, { replace: true })
        }}
        className="gap-0"
      >
        <div className="flex flex-col gap-1 px-8 pt-6 pb-4">
          <h1 className={staffH1}>
            <span className="font-mono">{c.module_code}</span> {c.module_name} ·{' '}
            <span className="font-mono">{c.class_group}</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {c.students.length} students{slots && ` · ${slots}`}
          </p>
        </div>
        {/* Tabs and filters stay in view under the top bar while the list scrolls. */}
        <div className="sticky top-14 z-[5] flex flex-col bg-background px-8">
          <TabsList>
            <TabsTrigger value="students">
              Students <span className="font-mono text-sm">{c.students.length}</span>
            </TabsTrigger>
            <TabsTrigger value="notes">
              Notes <span className="font-mono text-sm">{c.notes.length}</span>
            </TabsTrigger>
            <TabsTrigger value="assessments">
              Assessments <span className="font-mono text-sm">{c.assessments.length}</span>
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-3 border-b py-3">
          {tab === 'students' && (
            <>
              <SearchField value={q} onChange={setQ} placeholder="Search name or student number" />
              <Select
                label="Attendance"
                value={attendance}
                onChange={setAttendance}
                options={[
                  { value: 'all', label: 'Any attendance' },
                  { value: 'low', label: `Below ${LOW_ATTENDANCE}%` },
                  { value: 'none', label: 'No registers yet' },
                ]}
              />
            </>
          )}
          {tab === 'notes' && (
            <>
              <SearchField value={q} onChange={setQ} placeholder="Search notes" />
              <Select
                label="Week"
                value={week}
                onChange={setWeek}
                options={[{ value: 'all', label: 'All weeks' }, ...weeks.map((w) => ({ value: String(w), label: `Week ${w}` }))]}
              />
            </>
          )}
          {tab === 'assessments' && (
            <>
              <SearchField value={q} onChange={setQ} placeholder="Search assessments" />
              <Select
                label="Type"
                value={kind}
                onChange={setKind}
                options={[{ value: 'all', label: 'All types' }, ...kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))]}
              />
              <Select
                label="Status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'all', label: 'Any status' },
                  { value: 'to_mark', label: 'To mark' },
                  { value: 'published', label: 'Published' },
                  { value: 'upcoming', label: 'Coming up' },
                ]}
              />
            </>
          )}
          <span className="ml-auto text-sm text-muted-foreground" role="status">
            {filtered ? (
              <>
                {shown} of {total} ·{' '}
                <button type="button" onClick={clear} className="text-primary underline underline-offset-2">
                  Clear
                </button>
              </>
            ) : (
              `${total} ${tab === 'students' ? 'students' : tab === 'notes' ? 'notes' : 'assessments'}`
            )}
          </span>
          </div>
        </div>

        <main className="px-8 pb-8">
          <TabsContent value="students">
            {students.length ? (
              <Table
                head={
                  <>
                    <th className={cn(th, 'w-10')}>#</th>
                    <th className={cn(th, 'w-[170px]')}>Student no.</th>
                    <th className={th}>Name</th>
                    <th className={cn(th, 'w-[200px] text-right')}>Attendance</th>
                  </>
                }
              >
                {students.map((s) => {
                  const p = pct(s)
                  return (
                    <tr key={s.id}>
                      <td className={cn(td, 'font-mono text-muted-foreground')}>{s.n}</td>
                      <td className={cn(td, 'font-mono')}>{s.student_number}</td>
                      <td className={td}>{s.name}</td>
                      <td className={cn(td, 'text-right')}>
                        {p === null ? (
                          <span className="text-muted-foreground">No registers yet</span>
                        ) : (
                          <span className={cn('font-mono', p < LOW_ATTENDANCE && 'font-medium text-destructive')}>
                            {s.attended}/{s.sessions} · {p}%
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </Table>
            ) : (
              <p className="py-4 text-muted-foreground">No students match.</p>
            )}
          </TabsContent>

          <TabsContent value="notes">
            {notes.length ? (
              <Table
                head={
                  <>
                    <th className={th}>Title</th>
                    <th className={th}>Week</th>
                    <th className={th}>Type</th>
                    <th className={th}>Size</th>
                    <th className={th}>Uploaded</th>
                    <th className={cn(th, 'text-right')}>Downloaded by</th>
                  </>
                }
              >
                {notes.map((n) => (
                  <tr key={n.first_material_id}>
                    <td className={cn(td, 'font-medium')}>{n.title}</td>
                    <td className={td}>{n.week ?? '–'}</td>
                    <td className={cn(td, 'font-mono')}>{fileKind(n.mime_type)}</td>
                    <td className={cn(td, 'font-mono')}>{n.size_bytes ? fileSize(n.size_bytes) : '–'}</td>
                    <td className={td}>{shortDate(new Date(n.published_at))}</td>
                    <td className={cn(td, 'text-right font-mono')}>
                      {n.downloaded}/{n.audience}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <p className="py-4 text-muted-foreground">
                {c.notes.length ? 'No notes match.' : 'No notes shared with this class yet.'}
              </p>
            )}
          </TabsContent>

          <TabsContent value="assessments">
            {assessments.length ? (
              <Table
                head={
                  <>
                    <th className={cn(th, 'w-[110px]')}>Type</th>
                    <th className={th}>Assessment</th>
                    <th className={cn(th, 'w-20 text-right')}>Weight</th>
                    <th className={cn(th, 'w-[170px]')}>Due</th>
                    <th className={cn(th, 'w-[130px]')}>Marked</th>
                    <th className={cn(th, 'w-[130px]')}>
                      <span className="sr-only">Action</span>
                    </th>
                  </>
                }
              >
                {assessments.map((a) => {
                  const st = aStatus(a)
                  return (
                    <tr key={a.id}>
                      <td className={td}>
                        <Badge>{KIND_LABEL[a.kind]}</Badge>
                      </td>
                      <td className={cn(td, 'font-medium')}>{a.title}</td>
                      <td className={cn(td, 'text-right font-mono')}>{a.weight}%</td>
                      <td className={td}>{shortDateTime(new Date(a.due_at))}</td>
                      <td className={td}>
                        {st === 'published' ? (
                          <span className="inline-flex items-center gap-1">
                            <Check className="size-4 text-success" strokeWidth={1.5} aria-hidden />
                            Published
                          </span>
                        ) : st === 'to_mark' ? (
                          <span className="font-mono">
                            {a.marked}/{c.students.length}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Not yet</span>
                        )}
                      </td>
                      <td className={cn(td, 'text-right')}>
                        {st !== 'upcoming' && (
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/staff/teaching/assessments/${a.id}/marks`}>{a.released ? 'View' : 'Marks'}</Link>
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </Table>
            ) : (
              <p className="py-4 text-muted-foreground">No assessments match.</p>
            )}
          </TabsContent>
        </main>
      </Tabs>
      <UploadDialog c={c} open={uploadOpen} onOpenChange={setUpload} />
    </>
  )
}
