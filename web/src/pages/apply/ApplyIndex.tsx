import { Navigate } from 'react-router'
import { useMyApplication } from '@/api/generated/apply/apply'
import { applyHome } from './common'

// /apply: send the applicant to wherever they are in the process.
export default function ApplyIndex() {
  const { data, isPending } = useMyApplication()
  if (isPending) return <div className="min-h-dvh bg-background" aria-busy="true" />
  return <Navigate to={applyHome(data)} replace />
}
