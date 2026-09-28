import type { ApplyStep, MyApplication } from '@/api/generated/model'

export const STEP_PATH: Record<ApplyStep, string> = {
  programme: '/apply/programme',
  national_id: '/apply/id',
  birth_certificate: '/apply/birth-certificate',
  results: '/apply/results',
  review: '/apply/review',
  submit: '/apply/submit',
}

// Where an applicant belongs: the next unfinished step while drafting, otherwise the status or offer.
export function applyHome(app: MyApplication | null | undefined): string {
  if (!app) return STEP_PATH.programme
  if (app.status === 'draft' && app.payment_waiting) return '/apply/pay'
  if (app.status === 'draft') return STEP_PATH[app.next_step ?? 'programme']
  if (app.status === 'accepted') return '/apply/offer'
  return '/apply/status'
}
