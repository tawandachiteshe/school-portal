import type { QueryClient } from '@tanstack/react-query'
import type { AssessmentKind } from '@/api/generated/model'

export const KIND_LABEL: Record<AssessmentKind, string> = {
  test: 'Test',
  assignment: 'Assignment',
  practical: 'Practical',
  project: 'Project',
  exam: 'Exam',
}

// Generated query keys start with the request path ("/student/dashboard"). After a change that
// touches a student's data (a submission, a renewal, a download), refresh all of it.
export function invalidateStudentData(qc: QueryClient) {
  return qc.invalidateQueries({
    predicate: (q) => typeof q.queryKey[0] === 'string' && /^\/(student|library)\//.test(q.queryKey[0]),
  })
}
