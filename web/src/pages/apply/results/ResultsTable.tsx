import { TriangleAlert, X } from 'lucide-react'
import { useId, useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ResultsState, SittingIn, SittingOut, SubjectOut, ZimsecSubjectOut } from '@/api/generated/model'
import { cn } from '@/lib/utils'
import { Crop } from './Crop'

export type Row = { code: string | null; name: string; grade: string; check: boolean; read_as: string | null; crop: SubjectOut['crop'] }
export type Draft = {
  key: string
  status: SittingOut['status']
  level: string
  session: string
  year: string
  centre: string
  candidate: string
  name: string | null
  rows: Row[]
  pages: SittingOut['pages']
  read_at: string | null
  editing: boolean // the header fields are open for editing
}

const GRADES: Record<string, string[]> = { O: ['A', 'B', 'C', 'D', 'E', 'U', 'X'], A: ['A', 'B', 'C', 'D', 'E', 'O', 'F'] }
const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Harare' })
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Harare' })
const SESSION = { JUNE: 'June', NOVEMBER: 'November' } as Record<string, string>

export function toDraft(s: SittingOut): Draft {
  const header = !!(s.level && s.session && s.year && s.centre_number && s.candidate_number)
  return {
    key: s.key,
    status: s.status,
    level: s.level ?? 'O',
    session: s.session ?? 'NOVEMBER',
    year: s.year ? String(s.year) : '',
    centre: s.centre_number ?? '',
    candidate: s.candidate_number ?? '',
    name: s.candidate_name,
    rows: s.subjects.map((x) => ({ code: x.code, name: x.name, grade: x.grade ?? '', check: x.check, read_as: x.read_as, crop: x.crop })),
    pages: s.pages,
    read_at: s.read_at,
    editing: !header,
  }
}

// Sittings the applicant can check: read (not saved yet) and saved ones.
export const checkable = (st: ResultsState) => st.sittings.filter((s) => s.status === 'read' || s.status === 'saved')

export function problem(drafts: Draft[]): string | null {
  for (const d of drafts) {
    if (!/^\d{6}$/.test(d.centre)) return 'Enter the 6-digit centre number from your slip.'
    if (!/^\d{4}$/.test(d.candidate)) return 'Enter the 4-digit candidate number from your slip.'
    const y = Number(d.year)
    if (!(y >= 1980 && y <= new Date().getFullYear())) return 'Enter the year of the exam, like 2022.'
    if (!d.rows.length) return 'Add at least one subject.'
    const missing = d.rows.find((r) => !r.grade)
    if (missing) return `Choose a grade for ${missing.name}.`
  }
  const sittings = drafts.map((d) => `${d.level}${d.session}${d.year}`)
  if (new Set(sittings).size !== sittings.length) return 'The same sitting is listed twice. Put all its subjects together.'
  return null
}

export function toBody(drafts: Draft[]): { sittings: SittingIn[] } {
  return {
    sittings: drafts.map((d) => ({
      key: d.key,
      level: d.level,
      session: d.session,
      year: Number(d.year),
      centre_number: d.centre,
      candidate_number: d.candidate,
      candidate_name: d.name,
      subjects: d.rows.map((r) => ({ code: r.code, name: r.name, grade: r.grade })),
    })),
  }
}

function GradeSelect({ row, level, onChange, desktop }: { row: Row; level: string; onChange: (g: string) => void; desktop: boolean }) {
  return (
    <select
      aria-label={`Grade for ${row.name}${row.check ? ', please check' : ''}`}
      value={row.grade}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'rounded-sm border border-input bg-card px-2 font-mono text-base',
        desktop ? 'h-10 w-[72px]' : 'h-11 w-16',
        row.check && 'border-2 border-urgent-line bg-urgent-soft px-[7px]',
      )}
    >
      {!row.grade && <option value="">–</option>}
      {GRADES[level].map((g) => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
    </select>
  )
}

function Header({ d, set }: { d: Draft; set: (p: Partial<Draft>) => void }) {
  const ids = { lv: useId(), ss: useId(), yr: useId(), cn: useId(), cd: useId() }
  if (!d.editing)
    return (
      <p className="text-sm text-muted-foreground">
        Centre <span className="font-mono text-foreground">{d.centre}</span> · Candidate{' '}
        <span className="font-mono text-foreground">{d.candidate}</span> ·{' '}
        <button type="button" onClick={() => set({ editing: true })} className="text-primary underline underline-offset-2">
          Edit
        </button>
      </p>
    )
  const field = 'h-11 rounded-sm border border-input bg-card px-3'
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(5,auto)] sm:justify-start">
      <label className="flex flex-col gap-1 text-sm" htmlFor={ids.lv}>
        Level
        <select id={ids.lv} value={d.level} onChange={(e) => set({ level: e.target.value })} className={field}>
          <option value="O">O-Level</option>
          <option value="A">A-Level</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={ids.ss}>
        Session
        <select id={ids.ss} value={d.session} onChange={(e) => set({ session: e.target.value })} className={field}>
          <option value="NOVEMBER">November</option>
          <option value="JUNE">June</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={ids.yr}>
        Year
        <Input id={ids.yr} inputMode="numeric" maxLength={4} value={d.year} onChange={(e) => set({ year: e.target.value.replace(/\D/g, '') })} className="w-24 font-mono" />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={ids.cn}>
        Centre number
        <Input id={ids.cn} inputMode="numeric" maxLength={6} value={d.centre} onChange={(e) => set({ centre: e.target.value.replace(/\D/g, '') })} className="w-32 font-mono" />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={ids.cd}>
        Candidate number
        <Input id={ids.cd} inputMode="numeric" maxLength={4} value={d.candidate} onChange={(e) => set({ candidate: e.target.value.replace(/\D/g, '') })} className="w-24 font-mono" />
      </label>
    </div>
  )
}

function AddSubject({ taken, all, onAdd }: { taken: Set<string>; all: ZimsecSubjectOut[]; onAdd: (s: ZimsecSubjectOut) => void }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const left = all.filter((s) => !taken.has(s.name))
  if (!open)
    return (
      <div>
        <Button variant="ghost" className="px-1" disabled={!left.length} onClick={() => setOpen(true)}>
          Add a subject we missed
        </Button>
      </div>
    )
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">
        Subject
      </label>
      <select
        id={id}
        autoFocus
        defaultValue=""
        onChange={(e) => {
          const s = left.find((x) => x.code === e.target.value)
          if (s) onAdd(s)
          setOpen(false)
        }}
        className="h-11 min-w-0 grow rounded-sm border border-input bg-card px-3"
      >
        <option value="" disabled>
          Choose the subject
        </option>
        {left.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name} ({s.code})
          </option>
        ))}
      </select>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  )
}

// design/Zimsec (mobile) and ZimsecDesktop: one sitting's grades, each editable.
export function SittingTable({
  d,
  set,
  all,
  fileUrl,
  desktop,
  onAddPhoto,
  onRemove,
}: {
  d: Draft
  set: (p: Partial<Draft>) => void
  all: ZimsecSubjectOut[]
  fileUrl: (id: string) => string
  desktop: boolean
  onAddPhoto?: () => void
  onRemove?: () => void
}) {
  const unsure = d.rows.filter((r) => r.check).length
  const setRow = (i: number, p: Partial<Row>) => set({ rows: d.rows.map((r, j) => (j === i ? { ...r, ...p } : r)) })
  const title = `${d.level}-Level · ${SESSION[d.session] ?? ''} ${d.year}`.trim()
  const head = (
    <div className={cn('flex gap-4', desktop ? 'items-baseline justify-between border-b pb-2' : 'flex-col gap-0.5')}>
      <h2 className="text-lg leading-6 font-semibold">{title}</h2>
      <div className="flex items-center gap-3">
        <Header d={d} set={set} />
        {onRemove && (
          <button type="button" onClick={onRemove} className="text-sm text-destructive hover:underline">
            Remove sitting
          </button>
        )}
      </div>
    </div>
  )
  const crop = (r: Row, w: number, h: number) =>
    r.crop && (
      <Crop
        src={fileUrl(r.crop.document_id)}
        crop={r.crop}
        width={w}
        height={h}
        label={`Crop from your slip${r.read_as ? `: we read it as ${r.read_as}` : ''}`}
      />
    )
  const remove = (i: number) => set({ rows: d.rows.filter((_, j) => j !== i) })

  return (
    <section className="flex flex-col gap-4">
      {head}
      {!desktop && d.pages.length > 0 && (
        <div className="flex items-center gap-3">
          <img src={fileUrl(d.pages[0].document_id)} alt="" className="h-16 w-12 shrink-0 rounded-sm border object-cover" />
          <div className="grow">
            <div className="font-medium">Result slip</div>
            <div className="text-sm text-muted-foreground">
              {d.pages.length} {d.pages.length === 1 ? 'photo' : 'photos'}
              {d.read_at && ` · read ${hm.format(new Date(d.read_at))}`}
            </div>
          </div>
          {onAddPhoto && (
            <Button variant="ghost" onClick={onAddPhoto}>
              Add photo
            </Button>
          )}
        </div>
      )}
      {!desktop && unsure > 0 && (
        <Alert variant="urgent">
          <TriangleAlert strokeWidth={1.5} />
          <p>
            We weren't sure about {unsure} {unsure === 1 ? 'grade' : 'grades'}. They're outlined below, next to the part of
            your slip we read.
          </p>
        </Alert>
      )}
      <table className={cn('w-full border-collapse [&_tr]:border-b', desktop ? 'text-base' : '')}>
        <thead>
          <tr className="text-left text-sm text-muted-foreground">
            <th scope="col" className={cn('py-2 font-medium', desktop ? 'w-[90px] px-3' : 'w-14')}>
              Code
            </th>
            <th scope="col" className={cn('py-2 font-medium', desktop && 'px-3')}>
              Subject
            </th>
            {desktop && (
              <th scope="col" className="w-[180px] px-3 py-2 font-medium">
                From your slip
              </th>
            )}
            <th scope="col" className={cn('py-2 font-medium', desktop ? 'w-[110px] px-3' : 'w-[132px] text-right')}>
              Grade
            </th>
            <th scope="col" className="w-10">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r, i) => (
            <tr key={r.name}>
              <td className={cn('py-2 align-top font-mono', desktop ? 'px-3 pt-4' : 'pt-[18px] text-sm')}>{r.code ?? '—'}</td>
              <td className={cn('py-2 align-top', desktop ? 'px-3 pt-4' : 'pt-[18px]')}>
                <div>{r.name}</div>
                {r.check && <div className="text-sm font-medium text-urgent">Check this grade</div>}
              </td>
              {desktop && (
                <td className="px-3 py-2">
                  {r.check ? crop(r, 64, 44) ?? <span className="text-sm text-urgent">Not read</span> : <span className="text-sm text-muted-foreground">Clear</span>}
                </td>
              )}
              <td className={cn('py-2', desktop && 'px-3')}>
                <div className={cn('flex items-center gap-2', !desktop && 'justify-end')}>
                  {!desktop && r.check && crop(r, 56, 44)}
                  <GradeSelect row={r} level={d.level} desktop={desktop} onChange={(g) => setRow(i, { grade: g })} />
                </div>
              </td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  aria-label={`Remove ${r.name}`}
                  onClick={() => remove(i)}
                  className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                >
                  <X className="size-4" strokeWidth={1.5} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AddSubject
        taken={new Set(d.rows.map((r) => r.name))}
        all={all}
        onAdd={(s) => set({ rows: [...d.rows, { code: s.code, name: s.name, grade: '', check: false, read_as: null, crop: null }] })}
      />
    </section>
  )
}

export const scannedText = (d: Draft) =>
  d.pages[0]
    ? `Scanned on your ${d.pages[0].capture_device?.startsWith('phone') ? 'phone' : 'computer'}, ${dayMonth.format(new Date(d.pages[0].received_at)).replace('Sept', 'Sep')} ${hm.format(new Date(d.pages[0].received_at))} · ${d.pages.length} ${d.pages.length === 1 ? 'page' : 'pages'}`
    : null
