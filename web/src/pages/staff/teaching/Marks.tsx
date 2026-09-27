import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { StaffTopBar } from '@/components/shell/staff-shell'
import type { MarkIn, MarksSheet } from '@/api/generated/model'
import {
  getGetMarksQueryKey,
  getMarkingQueryKey,
  getOverviewQueryKey,
  useGetMarks,
  usePublishMarks,
  useSaveMarks,
} from '@/api/generated/teaching/teaching'
import { ApiError } from '@/lib/api'
import { shortDate, time } from '@/lib/format'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from './staff-ui'

type Row = { mark: string; absent: boolean; note: string; comment: string }

const toRow = (r: MarksSheet['rows'][number]): Row => ({
  mark: r.mark === null ? '' : String(r.mark),
  absent: r.is_absent,
  note: r.absence_note ?? '',
  comment: r.comment ?? '',
})

function problem(value: string, max: number): string | null {
  if (value.trim() === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Numbers only'
  if (n < 0) return "Can't be negative"
  if (n > max) return `Max is ${max}`
  return null
}

// Parse "student number, mark[, comment]" lines; "absent" instead of a mark marks them absent.
function parseCsv(text: string) {
  const out: { number: string; mark: string; comment: string }[] = []
  for (const line of text.split(/\r?\n/)) {
    const [number, mark, ...rest] = line.split(',').map((x) => x.trim().replace(/^"|"$/g, ''))
    if (!number || !/\d/.test(number) || mark === undefined) continue
    out.push({ number, mark, comment: rest.join(',').trim() })
  }
  return out
}

function MarksTable({ sheet }: { sheet: MarksSheet }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(sheet.rows.map((r) => [r.student_id, toRow(r)])),
  )
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [savedAt, setSavedAt] = useState<string | null>(sheet.saved_at)
  const [confirm, setConfirm] = useState(false)
  const [find, setFind] = useState('')
  const [show, setShow] = useState<'all' | 'missing' | 'problems' | 'absent'>('all')
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const max = sheet.max_mark
  const published = sheet.released_at !== null

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getOverviewQueryKey() })
    void qc.invalidateQueries({ queryKey: getMarkingQueryKey() })
  }
  const save = useSaveMarks({
    mutation: {
      onSuccess: (s) => {
        setSavedAt(s.saved_at)
        qc.setQueryData(getGetMarksQueryKey(sheet.assessment_id), s)
        refresh()
      },
      onError: (e) => toast(e instanceof ApiError ? e.message : "Couldn't save. Your marks are kept on this page; try again."),
    },
  })
  const publish = usePublishMarks({
    mutation: {
      onSuccess: (s) => {
        qc.setQueryData(getGetMarksQueryKey(sheet.assessment_id), s)
        refresh()
        setConfirm(false)
        toast('Marks published. Students can see them now.')
      },
      onError: (e) => toast(e instanceof ApiError ? e.message : "Couldn't publish. Try again."),
    },
  })

  // Save a draft a moment after typing stops; rows with a problem wait until they're fixed.
  useEffect(() => {
    if (!dirty.size) return
    const t = setTimeout(() => {
      const send: MarkIn[] = []
      const kept = new Set<string>()
      for (const id of dirty) {
        const r = rows[id]
        if (!r.absent && problem(r.mark, max)) {
          kept.add(id)
          continue
        }
        send.push({
          student_id: id,
          mark: r.absent || r.mark.trim() === '' ? null : r.mark.trim(),
          is_absent: r.absent,
          absence_note: r.absent ? r.note : null,
          comment: r.comment,
        })
      }
      setDirty(kept)
      if (send.length) save.mutate({ assessmentId: sheet.assessment_id, data: { rows: send } })
    }, 800)
    return () => clearTimeout(t)
  }, [dirty, rows, max, save, sheet.assessment_id])

  const update = (id: string, patch: Partial<Row>) => {
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }))
    setDirty((d) => new Set(d).add(id))
  }

  const stats = useMemo(() => {
    const all = sheet.rows.map((r) => rows[r.student_id])
    const marks = all.filter((r) => !r.absent && r.mark.trim() !== '' && !problem(r.mark, max)).map((r) => Number(r.mark))
    const absent = all.filter((r) => r.absent).length
    const errors = all.filter((r) => !r.absent && problem(r.mark, max)).length
    const avg = marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null
    const missing = all.length - marks.length - absent - errors
    return { entered: marks.length, absent, errors, avg, missing, total: all.length }
  }, [rows, sheet.rows, max])

  async function importCsv(file: File | undefined) {
    if (!file) return
    const lines = parseCsv(await file.text())
    const byNumber = new Map(sheet.rows.map((r) => [r.student_number, r.student_id]))
    let matched = 0
    const unknown: string[] = []
    const next = { ...rows }
    const changed = new Set(dirty)
    for (const l of lines) {
      const id = byNumber.get(l.number)
      if (!id) {
        unknown.push(l.number)
        continue
      }
      const absent = l.mark.toLowerCase() === 'absent'
      next[id] = { ...next[id], mark: absent ? '' : l.mark, absent, comment: l.comment || next[id].comment }
      changed.add(id)
      matched++
    }
    setRows(next)
    setDirty(changed)
    toast(
      unknown.length
        ? `Imported ${matched} marks. ${unknown.length} student numbers aren't in this class: ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? '…' : ''}`
        : `Imported ${matched} marks.`,
    )
  }

  const visible = sheet.rows
    .map((s, i) => ({ s, n: i + 1 }))
    .filter(({ s }) => {
      const t = find.trim().toLowerCase()
      return !t || s.name.toLowerCase().includes(t) || s.student_number.toLowerCase().includes(t)
    })
    .filter(({ s }) => {
      const r = rows[s.student_id]
      if (show === 'absent') return r.absent
      if (show === 'problems') return !r.absent && !!problem(r.mark, max)
      if (show === 'missing') return !r.absent && r.mark.trim() === ''
      return true
    })
  const due = new Date(sheet.due_at)
  // Rows with a problem wait in `dirty` until fixed, so they don't count as "saving".
  const waiting = [...dirty].some((id) => rows[id].absent || !problem(rows[id].mark, max))
  const status = save.isPending || waiting ? 'Saving…' : savedAt ? `Draft saved ${time(new Date(savedAt))}` : null
  const canPublish = !published && stats.errors === 0 && stats.missing === 0 && !waiting && !save.isPending

  return (
    <>
      <StaffTopBar
        left={
          <nav aria-label="Breadcrumb" className="flex items-center gap-2">
            <Link to="/staff/teaching/marking" className="text-primary underline underline-offset-3">
              Marking
            </Link>
            <span aria-hidden>/</span>
            <span className="text-foreground">
              {sheet.title.split(':')[0]} · <span className="font-mono">{sheet.class_group}</span>
            </span>
          </nav>
        }
        right={<span role="status">{published ? `Published ${shortDate(new Date(sheet.released_at!))}` : status}</span>}
      />
      <main className="flex flex-col gap-5 px-8 py-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <h1 className={staffH1}>{sheet.title}</h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{sheet.module_code}</span> · <span className="font-mono">{sheet.class_group}</span> · Out
              of {max} · {sheet.weight}% of the module · {sheet.kind === 'assignment' ? 'Due' : 'Sat'} {shortDate(due)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={published}>
              Import CSV
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                void importCsv(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <Button size="sm" disabled={!canPublish} onClick={() => setConfirm(true)}>
              {published ? 'Published' : 'Publish to students'}
            </Button>
          </div>
        </div>

        <div className="sticky top-14 z-[5] -mx-8 flex flex-col bg-background px-8">
        <div className="flex gap-8 border-y py-3 text-sm">
          <span>
            <span className="text-muted-foreground">Entered</span> <span className="font-mono font-semibold">{stats.entered}</span>
            <span className="font-mono text-muted-foreground">/{stats.total}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Absent</span> <span className="font-mono font-semibold">{stats.absent}</span>
          </span>
          {stats.avg !== null && (
            <span>
              <span className="text-muted-foreground">Class average</span>{' '}
              <span className="font-mono font-semibold">{stats.avg.toFixed(1)}</span>
              <span className="text-muted-foreground">
                {' '}
                / {max} · {Math.round((stats.avg / max) * 100)}%
              </span>
            </span>
          )}
          {stats.errors > 0 ? (
            <span className="ml-auto inline-flex items-center gap-1.5 font-medium text-destructive">
              <CircleAlert className="size-4" strokeWidth={1.5} aria-hidden />
              {stats.errors} {stats.errors === 1 ? 'mark' : 'marks'} to fix before publishing
            </span>
          ) : (
            !published &&
            stats.missing > 0 && (
              <span className="ml-auto text-muted-foreground">
                {stats.missing} still to enter before publishing
              </span>
            )
          )}
        </div>

        <div className="flex items-center gap-3 border-b py-3">
          <div className="relative w-[300px]">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
            <input
              type="search"
              aria-label="Find a student"
              placeholder="Find a student by name or number"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              className="h-9 w-full rounded-sm border border-input bg-card pr-2 pl-8 text-sm"
            />
          </div>
          <select
            aria-label="Show"
            value={show}
            onChange={(e) => setShow(e.target.value as typeof show)}
            className="h-9 rounded-sm border border-input bg-card px-2 text-sm"
          >
            <option value="all">All students</option>
            <option value="missing">Not entered yet</option>
            <option value="problems">Marks to fix</option>
            <option value="absent">Absent</option>
          </select>
          {(find || show !== 'all') && (
            <span className="ml-auto text-sm text-muted-foreground" role="status">
              {visible.length} of {sheet.rows.length} ·{' '}
              <button
                type="button"
                className="text-primary underline underline-offset-2"
                onClick={() => {
                  setFind('')
                  setShow('all')
                }}
              >
                Clear
              </button>
            </span>
          )}
        </div>
        </div>

        <Table
          head={
            <>
              <th className={cn(th, 'w-10')}>#</th>
              <th className={cn(th, 'w-[170px]')}>Student no.</th>
              <th className={th}>Name</th>
              <th className={cn(th, 'w-[170px]')}>Mark / {max}</th>
              <th className={cn(th, 'w-20 text-right')}>%</th>
              <th className={th}>Comment for student</th>
            </>
          }
        >
          {visible.map(({ s, n }, i) => {
            const r = rows[s.student_id]
            const err = !r.absent ? problem(r.mark, max) : null
            const pct = !r.absent && r.mark.trim() !== '' && !err ? Math.round((Number(r.mark) / max) * 100) : null
            return (
              <tr key={s.student_id}>
                <td className={cn(td, 'font-mono text-muted-foreground')}>{n}</td>
                <td className={cn(td, 'font-mono')}>{s.student_number}</td>
                <td className={td}>{s.name}</td>
                <td className={td}>
                  {r.absent ? (
                    <span className="flex items-center gap-2">
                      <Badge>Absent</Badge>
                      {!published && (
                        <button
                          type="button"
                          className="text-xs text-primary underline underline-offset-2"
                          onClick={() => update(s.student_id, { absent: false })}
                        >
                          Undo
                        </button>
                      )}
                    </span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col gap-0.5">
                        <input
                          ref={(el) => {
                            inputs.current[i] = el
                          }}
                          inputMode="decimal"
                          aria-label={`Mark for ${s.name.split(', ').reverse().join(' ')}`}
                          aria-invalid={!!err}
                          value={r.mark}
                          disabled={published}
                          onChange={(e) => update(s.student_id, { mark: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              inputs.current.slice(i + 1).find(Boolean)?.focus()
                            }
                          }}
                          className={cn(
                            'h-8 w-[72px] rounded-sm border border-input bg-card px-2 text-right font-mono text-sm',
                            err && 'border-2 border-destructive px-[7px]',
                          )}
                        />
                        {err && <span className="text-xs font-medium text-destructive">{err}</span>}
                      </div>
                      {!published && r.mark.trim() === '' && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline underline-offset-2"
                          onClick={() => update(s.student_id, { absent: true, mark: '' })}
                        >
                          Absent
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td className={cn(td, 'text-right font-mono', pct === null && 'text-muted-foreground')}>{pct ?? '—'}</td>
                <td className={td}>
                  <input
                    aria-label={`${r.absent ? 'Absence note' : 'Comment'} for ${s.name.split(', ').reverse().join(' ')}`}
                    value={r.absent ? r.note : r.comment}
                    placeholder={r.absent ? 'Reason, e.g. medical note received' : ''}
                    disabled={published}
                    onChange={(e) => update(s.student_id, r.absent ? { note: e.target.value } : { comment: e.target.value })}
                    className="h-8 w-full rounded-sm border border-transparent bg-transparent px-2 text-sm hover:border-border focus:border-input focus:bg-card"
                  />
                </td>
              </tr>
            )
          })}
        </Table>
        <p className="text-sm text-muted-foreground">
          Press <kbd className="rounded-sm border px-1.5 py-px font-mono text-xs">Enter</kbd> to move to the next student ·
          Students see marks only after you publish · CSV: student number, mark, comment (or “absent”)
        </p>
      </main>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-[440px]">
          <DialogTitle>Publish marks to {stats.total} students?</DialogTitle>
          <DialogDescription>
            They see their mark and your comment straight away, and get a notification. You can still correct a mark
            afterwards.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button disabled={publish.isPending} onClick={() => publish.mutate({ assessmentId: sheet.assessment_id })}>
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// design/LecturerMarks
export default function Marks() {
  const { id = '' } = useParams()
  const { data, isPending, error } = useGetMarks(id, { query: { staleTime: Infinity } })
  if (isPending) return <Skeleton className="m-8 h-96" />
  if (error || !data)
    return <p className="p-8 text-muted-foreground">{error instanceof ApiError ? error.message : "Couldn't load marks."}</p>
  return <MarksTable key={data.assessment_id} sheet={data} />
}
