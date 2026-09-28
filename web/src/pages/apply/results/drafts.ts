// The applicant's ZIMSEC results as they edit them (design/Zimsec, ZimsecDesktop): from what the
// API read, to what it saves. Shared by the phone and desktop results pages.
import type { ResultsState, SittingIn, SittingOut, SubjectOut } from '@/api/generated/model'
import { shortDayMonth, time } from '@/lib/format'

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

export const scannedText = (d: Draft) =>
  d.pages[0]
    ? `Scanned on your ${d.pages[0].capture_device?.startsWith('phone') ? 'phone' : 'computer'}, ${shortDayMonth(new Date(d.pages[0].received_at))} ${time(new Date(d.pages[0].received_at))} · ${d.pages.length} ${d.pages.length === 1 ? 'page' : 'pages'}`
    : null
