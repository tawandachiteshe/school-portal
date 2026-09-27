import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type ModuleSummary = {
  code: string
  name: string
  lecturer: string | null
  next_class: { starts_at: string; venue: string | null } | null
  new_notes: number
}

export type ModuleList = { term_name: string | null; class_group: string | null; modules: ModuleSummary[] }

export type WeekClass = {
  kind: string
  starts_at: string
  ends_at: string
  venue: string | null
  cancelled: boolean
  change_reason: string | null
  assessment_title: string | null
}

export type ModuleAssessment = {
  id: string
  kind: 'test' | 'assignment' | 'practical' | 'project' | 'exam'
  title: string
  weight: number
  due_at: string
  venue: string | null
  submission_mode: 'online' | 'physical' | 'none'
  status: 'submitted' | 'late' | 'marked' | 'returned' | null
  submitted_at: string | null
  mark: number | null
  max_mark: number
}

export type ModuleNote = {
  id: string
  title: string
  week: number | null
  topic: string | null
  mime_type: string | null
  size_bytes: number | null
  published_at: string
  downloaded: boolean
  external_url: string | null
}

export type ModuleDetail = {
  code: string
  name: string
  term_name: string
  class_group: string
  lecturer: { name: string; consultation_hours: string | null; office: string | null; email: string | null } | null
  coursework_weight: number
  exam_weight: number
  week: number | null
  week_classes: WeekClass[]
  assessments: ModuleAssessment[]
  exam_scheduled: boolean
  notes: ModuleNote[]
}

export const useModules = () =>
  useQuery({ queryKey: ['student', 'modules'], queryFn: () => api<ModuleList>('/student/modules') })

export const useModule = (code: string) =>
  useQuery({ queryKey: ['student', 'modules', code], queryFn: () => api<ModuleDetail>(`/student/modules/${code}`) })
