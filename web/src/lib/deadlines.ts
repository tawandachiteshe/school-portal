import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { DueItem } from '@/lib/student'

export type DeadlineItem = {
  id: string
  kind: DueItem['kind']
  title: string
  module_code: string
  due_at: string
  week: number | null
  venue: string | null
  submission_mode: 'online' | 'physical' | 'none'
  accepted_extensions: string[] | null
  allow_late_until: string | null
  status: 'submitted' | 'late' | 'marked' | 'returned' | null
  submitted_at: string | null
  mark: number | null
  max_mark: number
  feedback: string | null
}

export type Deadlines = { week: number | null; items: DeadlineItem[] }

export const useDeadlines = () =>
  useQuery({ queryKey: ['student', 'deadlines'], queryFn: () => api<Deadlines>('/student/deadlines') })

export type AssessmentDetail = {
  id: string
  kind: DueItem['kind']
  title: string
  module_code: string
  due_at: string
  description: string | null
  lecturer: string | null
  submission_mode: 'online' | 'physical' | 'none'
  accepted_extensions: string[] | null
  max_file_mb: number
  allow_late_until: string | null
  can_submit: boolean
  reason: string | null
  submission: {
    status: string
    submitted_at: string | null
    note: string | null
    files: { filename: string; size_bytes: number; sha256: string; uploaded_at: string }[]
  } | null
  pending_upload: { id: string; filename: string; size_bytes: number; received_bytes: number } | null
  chunk_bytes: number
}

export const useAssessment = (id: string) =>
  useQuery({ queryKey: ['student', 'assessments', id], queryFn: () => api<AssessmentDetail>(`/student/assessments/${id}`) })

// [".c", ".pdf"] → "a .c file or PDF"
export function acceptedText(exts: string[] | null): string | null {
  if (!exts?.length) return null
  const words = exts.map((e) => (e === '.pdf' ? 'PDF' : `a ${e} file`))
  if (words[0] === 'PDF') words[0] = 'a PDF'
  return words.join(' or ')
}

export const isDone = (s: DeadlineItem['status']) => s !== null
