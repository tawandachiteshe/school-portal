import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type TodayClass = {
  module_code: string
  module_name: string
  kind: string
  starts_at: string
  ends_at: string
  venue: string | null
  lecturer: string | null
  cancelled: boolean
  change_reason: string | null
  assessment_title: string | null
}

export type DueItem = {
  id: string
  kind: 'test' | 'assignment' | 'practical' | 'project' | 'exam'
  title: string
  module_code: string
  due_at: string
  venue: string | null
  submission_mode: 'online' | 'physical' | 'none'
  submitted: boolean
}

export type AnnouncementItem = {
  id: string
  title: string
  from_label: string | null
  publish_at: string
  is_pinned: boolean
  read: boolean
}

export type Announcements = { total: number; unread: number; items: AnnouncementItem[] }

export type NoteItem = {
  id: string
  title: string
  module_code: string
  week: number | null
  mime_type: string | null
  size_bytes: number | null
  published_at: string
}

export type LoanItem = {
  id: string
  title: string
  authors: string[]
  due_at: string
  renewals_left: number
  overdue: boolean
}

export type Dashboard = {
  today: TodayClass[]
  next_class: { module_code: string; starts_at: string; venue: string | null } | null
  due: DueItem[]
  announcements: Announcements
  notes: NoteItem[]
  loans: LoanItem[]
  results: { term_name: string | null; published: boolean }
}

export const dashboardKey = ['student', 'dashboard'] as const

export function useDashboard() {
  return useQuery({ queryKey: dashboardKey, queryFn: () => api<Dashboard>('/student/dashboard') })
}

export const KIND_LABEL: Record<DueItem['kind'], string> = {
  test: 'Test',
  assignment: 'Assignment',
  practical: 'Practical',
  project: 'Project',
  exam: 'Exam',
}
