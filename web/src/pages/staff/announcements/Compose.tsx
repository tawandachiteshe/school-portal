import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type {
  AnnouncementForm,
  AnnouncementIn,
  AudienceGroup,
  AudienceKind,
  ComposeOptions,
  PublishAction,
} from '@/api/generated/model'
import {
  createAnnouncement,
  getGetStaffAnnouncementQueryKey,
  getListStaffAnnouncementsQueryKey,
  updateAnnouncement,
  useAudienceReach,
  useComposeOptions,
  useDeleteAnnouncement,
  useGetStaffAnnouncement,
} from '@/api/generated/staff-announcements/staff-announcements'
import { errorMessage } from '@/lib/api'
import { shortDateTime, time } from '@/lib/format'
import { cn } from '@/lib/utils'
import { staffH1 } from '../teaching/staff-ui'

const longWhen = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Africa/Harare',
})
// "Tuesday 16 March, 16:00"
const until = (d: Date) => longWhen.format(d).replace(/^(\w+),? (\d+ \w+),? (?:at )?/, '$1 $2, ')

// <input type="datetime-local"> works in the browser's zone; staff are in Harare.
const toLocal = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const inDays = (days: number, hour: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return d
}

type Draft = {
  title: string
  body: string
  kind: AudienceKind
  groups: AudienceGroup[]
  pinned: boolean
  pinnedUntil: string // datetime-local
  sms: boolean
  smsText: string
}

const fromForm = (f: AnnouncementForm | undefined): Draft => ({
  title: f?.title ?? '',
  body: f?.body ?? '',
  kind: f?.audience.kind ?? 'students',
  groups: f?.audience.groups ?? [],
  pinned: f?.pinned ?? false,
  pinnedUntil: toLocal(f?.pinned_until ? new Date(f.pinned_until) : inDays(7, 17)),
  sms: !!f?.sms_text,
  smsText: f?.sms_text ?? '',
})

const toBody = (d: Draft, action: PublishAction, publishAt?: string): AnnouncementIn => ({
  title: d.title,
  body: d.body,
  audience: { kind: d.kind, groups: d.kind === 'groups' ? d.groups : [] },
  pinned: d.pinned,
  pinned_until: d.pinned ? new Date(d.pinnedUntil).toISOString() : null,
  sms_text: d.sms ? d.smsText : null,
  action,
  publish_at: publishAt ? new Date(publishAt).toISOString() : null,
})

function groupLabel(g: AudienceGroup, opts: ComposeOptions) {
  const p = opts.programmes.find((x) => x.id === g.programme_id)
  return `${g.year ? `Year ${g.year}` : 'All years'} · ${p ? p.code : 'all programmes'}`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function reachText(r: { students: number; staff: number }, kind: AudienceKind) {
  if (kind === 'everyone') return `${plural(r.students, 'student')} and ${plural(r.staff, 'staff member')}`
  return plural(r.students, 'student')
}

function AddGroup({ opts, onAdd }: { opts: ComposeOptions; onAdd: (g: AudienceGroup) => void }) {
  const [open, setOpen] = useState(false)
  const [programme, setProgramme] = useState('all')
  const [year, setYear] = useState('1')
  const maxYears = Math.max(1, ...opts.programmes.map((p) => p.years))
  const years = programme === 'all' ? maxYears : (opts.programmes.find((p) => p.id === programme)?.years ?? maxYears)
  if (!open)
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Add group
      </Button>
    )
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-md border bg-card p-2">
      <Select value={programme} onValueChange={setProgramme}>
        <SelectTrigger aria-label="Programme" className="h-9 w-[240px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectItem value="all">All programmes</SelectItem>
          {opts.programmes.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={year} onValueChange={setYear}>
        <SelectTrigger aria-label="Year" className="h-9 w-[130px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectItem value="all">All years</SelectItem>
          {Array.from({ length: years }, (_, i) => (
            <SelectItem key={i} value={String(i + 1)}>
              Year {i + 1}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          onAdd({ programme_id: programme === 'all' ? null : programme, year: year === 'all' ? null : Number(year) })
          setOpen(false)
        }}
      >
        Add
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  )
}

const KINDS: { value: AudienceKind; label: string }[] = [
  { value: 'everyone', label: 'Everyone: students and staff' },
  { value: 'students', label: 'All students' },
  { value: 'groups', label: 'Chosen groups' },
]

// design/AnnouncementCompose
function ComposeForm({
  opts,
  form,
  onCreated,
}: {
  opts: ComposeOptions
  form?: AnnouncementForm
  onCreated: (id: string) => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const ids = { title: useId(), titleHint: useId(), body: useId(), sms: useId(), pin: useId(), smsSw: useId() }
  const [d, setD] = useState<Draft>(() => fromForm(form))
  const [id, setId] = useState(form?.id)
  const [status, setStatus] = useState(form?.status ?? 'draft')
  const [savedAt, setSavedAt] = useState<Date | null>(form ? new Date(form.updated_at) : null)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [editPin, setEditPin] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [scheduleAt, setScheduleAt] = useState(() =>
    toLocal(form?.status === 'scheduled' ? new Date(form.publish_at) : inDays(1, 8)),
  )
  const [confirm, setConfirm] = useState(false)
  const dirty = useRef(false)
  const published = status === 'published' || status === 'expired'
  const set = (patch: Partial<Draft>) => {
    dirty.current = true
    setD((x) => ({ ...x, ...patch }))
  }

  // Who it reaches, as the audience changes.
  const reach = useAudienceReach()
  const audienceKey = JSON.stringify([d.kind, d.groups])
  useEffect(() => {
    if (d.kind === 'groups' && !d.groups.length) return reach.reset()
    reach.mutate({ data: { kind: d.kind, groups: d.kind === 'groups' ? d.groups : [] } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey])
  const r = d.kind === 'groups' && !d.groups.length ? { students: 0, staff: 0, phones: 0 } : reach.data

  async function save(action: PublishAction, publishAt?: string) {
    const body = toBody(d, action, publishAt)
    const out = id ? await updateAnnouncement(id, body) : await createAnnouncement(body)
    if (!id) {
      onCreated(out.id)
      navigate(`/staff/announcements/${out.id}`, { replace: true })
    }
    setId(out.id)
    setStatus(out.status)
    setSavedAt(new Date(out.updated_at))
    qc.setQueryData(getGetStaffAnnouncementQueryKey(out.id), out)
    void qc.invalidateQueries({ queryKey: getListStaffAnnouncementsQueryKey() })
    return out
  }

  // Autosave drafts a moment after typing stops.
  useEffect(() => {
    if (status !== 'draft' || !dirty.current || !(d.title.trim() || d.body.trim())) return
    const t = setTimeout(async () => {
      dirty.current = false
      setSaving('saving')
      try {
        await save('draft')
        setSaving('idle')
      } catch {
        setSaving('failed')
      }
    }, 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, status])

  async function submit(action: PublishAction, publishAt?: string) {
    setError(null)
    setConfirm(false)
    try {
      dirty.current = false
      const out = await save(action, publishAt)
      toast(
        action === 'schedule'
          ? `Scheduled for ${shortDateTime(new Date(out.publish_at))}.`
          : action === 'draft'
            ? 'Draft saved.'
            : published
              ? 'Changes saved.'
              : `Published to ${r ? reachText(r, d.kind) : 'the audience'}.`,
      )
      if (action !== 'draft') navigate('/staff/announcements')
    } catch (e) {
      setError(errorMessage(e, "Couldn't save. Try again."))
    }
  }

  const del = useDeleteAnnouncement({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListStaffAnnouncementsQueryKey() })
        toast(status === 'scheduled' ? 'Scheduled announcement deleted.' : 'Draft deleted.')
        navigate('/staff/announcements')
      },
    },
  })

  const statusText =
    saving === 'saving'
      ? 'Saving…'
      : saving === 'failed'
        ? 'Not saved'
        : status === 'scheduled' && form
          ? `Scheduled for ${shortDateTime(new Date(form.publish_at))}`
          : published && form
            ? `Published ${shortDateTime(new Date(form.publish_at))}`
            : savedAt
              ? `Draft saved ${time(savedAt)}`
              : ''
  const titleLen = d.title.trim().length
  const smsLen = d.smsText.length

  return (
    <>
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b bg-card px-8">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
          <Link to="/staff/announcements" className="text-primary underline-offset-2 hover:underline">
            Announcements
          </Link>
          <span className="text-muted-foreground">/</span>
          <span>{form ? 'Edit' : 'New'}</span>
        </nav>
        <span role="status" className={cn('text-sm text-muted-foreground', saving === 'failed' && 'text-destructive')}>
          {statusText}
        </span>
      </header>
      <main className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-12 px-8 py-6">
        <form
          className="flex max-w-[720px] flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (published) void submit('publish')
            else if (d.sms) setConfirm(true)
            else void submit('publish')
          }}
        >
          <h1 className={staffH1}>{published ? 'Edit announcement' : 'Write an announcement'}</h1>
          {error && (
            <p role="alert" className="font-medium text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.title}>Title</Label>
            <span id={ids.titleHint} className="text-sm text-muted-foreground">
              Say what, when and where. Students see this first.
            </span>
            <Input
              id={ids.title}
              aria-describedby={ids.titleHint}
              value={d.title}
              maxLength={200}
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.body}>Message</Label>
            <Textarea id={ids.body} rows={5} value={d.body} onChange={(e) => set({ body: e.target.value })} />
          </div>

          <fieldset className="flex flex-col gap-2" disabled={published}>
            <legend className="mb-2 text-sm font-medium">Who should see it?</legend>
            <div role="radiogroup" aria-label="Who should see it?" className="flex flex-col gap-2">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  role="radio"
                  aria-checked={d.kind === k.value}
                  onClick={() => set({ kind: k.value })}
                  className="flex min-h-9 items-center gap-2.5 text-left disabled:opacity-60"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-input bg-card',
                      d.kind === k.value && 'border-primary after:size-2.5 after:rounded-full after:bg-primary',
                    )}
                  />
                  {k.label}
                </button>
              ))}
            </div>
            {d.kind === 'groups' && (
              <div className="flex flex-wrap items-center gap-2 pl-[30px]">
                {d.groups.map((g, i) => (
                  <span
                    key={i}
                    className="inline-flex h-7 items-center gap-1 rounded-sm bg-info-soft pr-1 pl-2.5 text-[13px] font-medium text-info"
                  >
                    {groupLabel(g, opts)}
                    {!published && (
                      <button
                        type="button"
                        aria-label={`Remove ${groupLabel(g, opts)}`}
                        onClick={() => set({ groups: d.groups.filter((_, j) => j !== i) })}
                        className="inline-flex size-5 items-center justify-center rounded-sm hover:bg-info/10"
                      >
                        <X className="size-3.5" strokeWidth={1.5} />
                      </button>
                    )}
                  </span>
                ))}
                {!published && (
                  <AddGroup
                    opts={opts}
                    onAdd={(g) =>
                      !d.groups.some((x) => x.programme_id === g.programme_id && x.year === g.year) &&
                      set({ groups: [...d.groups, g] })
                    }
                  />
                )}
              </div>
            )}
            <p className="pl-[30px] text-sm text-muted-foreground">
              {d.kind === 'groups' && !d.groups.length ? (
                'Add at least one group.'
              ) : r ? (
                <>
                  <span className="font-mono text-foreground">{r.students}</span>{' '}
                  {r.students === 1 ? 'student' : 'students'}
                  {d.kind === 'everyone' && (
                    <>
                      {' and '}
                      <span className="font-mono text-foreground">{r.staff}</span> staff
                    </>
                  )}
                </>
              ) : (
                ' '
              )}
            </p>
          </fieldset>

          <div className="flex flex-col gap-3 border-y py-4">
            <div className="flex items-center gap-4">
              <span className="grow">
                <span className="block font-medium" id={ids.pin}>
                  Pin to the top of the dashboard
                </span>
                {d.pinned && !editPin && (
                  <span className="text-sm text-muted-foreground">
                    Until {until(new Date(d.pinnedUntil))}{' '}
                    <button
                      type="button"
                      className="text-primary underline underline-offset-2"
                      onClick={() => setEditPin(true)}
                    >
                      Change
                    </button>
                  </span>
                )}
                {d.pinned && editPin && (
                  <span className="mt-1.5 flex items-center gap-2">
                    <Input
                      type="datetime-local"
                      aria-label="Pinned until"
                      className="h-9 w-[220px] text-sm"
                      value={d.pinnedUntil}
                      onChange={(e) => e.target.value && set({ pinnedUntil: e.target.value })}
                    />
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditPin(false)}>
                      Done
                    </Button>
                  </span>
                )}
              </span>
              <Switch aria-labelledby={ids.pin} checked={d.pinned} onCheckedChange={(v) => set({ pinned: v })} />
            </div>
            <div className="flex items-center gap-4">
              <span className="grow">
                <span className="block font-medium" id={ids.smsSw}>
                  Also send as SMS
                </span>
                <span className="text-sm text-muted-foreground">
                  {published ? (
                    d.sms ? (
                      'Sent when it was published.'
                    ) : (
                      'Not sent by SMS.'
                    )
                  ) : (
                    <>
                      {r && (
                        <>
                          <span className="font-mono">{r.phones}</span> {r.phones === 1 ? 'message' : 'messages'}.{' '}
                        </>
                      )}
                      Use for things students must not miss.
                    </>
                  )}
                </span>
              </span>
              <Switch
                aria-labelledby={ids.smsSw}
                checked={d.sms}
                disabled={published}
                onCheckedChange={(v) => set({ sms: v })}
              />
            </div>
            {d.sms && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.sms}>SMS text</Label>
                <Textarea
                  id={ids.sms}
                  rows={2}
                  className="min-h-0 text-sm"
                  maxLength={opts.sms_max}
                  disabled={published}
                  value={d.smsText}
                  onChange={(e) => set({ smsText: e.target.value })}
                />
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono">{smsLen}</span>/{opts.sms_max} characters · 1 SMS each
                </span>
              </div>
            )}
          </div>

          {scheduling && !published && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="schedule-at">Publish at</Label>
                <Input
                  id="schedule-at"
                  type="datetime-local"
                  className="w-[240px]"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
              </div>
              <Button type="button" variant="outline" onClick={() => void submit('schedule', scheduleAt)}>
                Schedule for {shortDateTime(new Date(scheduleAt))}
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            <Button type="submit">{published ? 'Save changes' : 'Publish now'}</Button>
            {!published && (
              <>
                <Button type="button" variant="outline" onClick={() => setScheduling((s) => !s)}>
                  Schedule
                </Button>
                <Button type="button" variant="ghost" onClick={() => void submit('draft')}>
                  Save draft
                </Button>
              </>
            )}
            {id && !published && (
              <Button
                type="button"
                variant="ghost"
                className="ml-auto text-destructive"
                disabled={del.isPending}
                onClick={() => del.mutate({ announcementId: id })}
              >
                Delete
              </Button>
            )}
          </div>
        </form>

        <aside aria-label="Preview" className="sticky top-20 flex flex-col gap-2">
          <span className="text-sm font-medium">How students see it</span>
          <div className="flex flex-col gap-1 rounded-md border bg-background p-4">
            <span className="font-semibold">Announcements</span>
            <div className="mt-1 grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 border-t py-3">
              <span className="pt-2 pl-1">
                <span className="block size-2 rounded-full bg-primary" />
              </span>
              <div>
                <div className={cn('font-semibold', !titleLen && 'text-muted-foreground')}>
                  {d.title.trim() || 'Your title'}
                </div>
                <div className="text-sm text-muted-foreground">{form?.status === 'published' ? `${opts.from_label}` : `${opts.from_label} · Just now`}</div>
              </div>
            </div>
          </div>
          <p className={cn('text-xs text-muted-foreground', titleLen > opts.title_fits && 'text-destructive')}>
            Titles over {opts.title_fits} characters get cut off on small phones.
            {titleLen > 0 && ` This one is ${titleLen}.`}
          </p>
        </aside>
      </main>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-[440px]">
          <DialogTitle>Publish and send {r ? plural(r.phones, 'SMS', 'SMS') : 'SMS'}?</DialogTitle>
          <DialogDescription>
            {r ? reachText(r, d.kind) : 'The audience'} see it in the portal straight away. Text messages can't be
            recalled once they're sent.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit('publish')}>Publish and send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function Compose() {
  const { id: routeId } = useParams()
  // A new announcement gets an id on its first autosave; keep the same form mounted when the URL follows.
  const [created, setCreated] = useState<string>()
  const id = routeId === created ? undefined : routeId
  const opts = useComposeOptions({ query: { staleTime: 5 * 60_000 } })
  const form = useGetStaffAnnouncement(id ?? '', { query: { enabled: !!id, staleTime: Infinity } })
  if (opts.isPending || (id && form.isPending)) return <Skeleton className="m-8 h-96" />
  if (opts.error || !opts.data || (id && !form.data))
    return <p className="p-8 text-muted-foreground">Couldn't open this announcement.</p>
  return <ComposeForm key={id ?? 'new'} opts={opts.data} form={id ? form.data : undefined} onCreated={setCreated} />
}
