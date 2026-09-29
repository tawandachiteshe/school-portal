import { QueryClient } from '@tanstack/react-query'
import { claimOfflineData, keptOffline } from './offline'
import { markSignedIn, sessionEnded } from './session'

const q = (key: string, status: 'success' | 'error' = 'success', data: unknown = {}) =>
  ({ queryKey: [key], state: { status, data } }) as unknown as Parameters<typeof keptOffline>[0]

describe('what a phone keeps offline', () => {
  it('keeps the student’s own pages and who they are', () => {
    expect(keptOffline(q('/me'))).toBe(true)
    expect(keptOffline(q('/student/dashboard'))).toBe(true)
    expect(keptOffline(q('/library/home'))).toBe(true)
  })
  it('never keeps staff pages, Ask Campus, search or failed requests', () => {
    expect(keptOffline(q('/staff/admissions/applications'))).toBe(false)
    expect(keptOffline(q('/assistant'))).toBe(false)
    expect(keptOffline(q('/student/search'))).toBe(false)
    expect(keptOffline(q('/student/dashboard', 'error'))).toBe(false)
    expect(keptOffline(q('/me', 'success', null))).toBe(false) // signed out: never kept
  })
  it('drops the last person’s data when someone else signs in on the phone', () => {
    const qc = new QueryClient()
    qc.setQueryData(['/student/dashboard'], { mine: 'tariro' })
    qc.setQueryData(['/me'], { id: 'b' })
    claimOfflineData(qc, 'a')
    claimOfflineData(qc, 'b')
    expect(qc.getQueryData(['/student/dashboard'])).toBeUndefined()
    expect(qc.getQueryData(['/me'])).toEqual({ id: 'b' })
  })
})

describe('session ended', () => {
  it('only counts when this page was signed in', () => {
    expect(sessionEnded()).toBe(false) // a sign-in page getting a 401 is not "signed out"
    markSignedIn()
    expect(sessionEnded()).toBe(true)
  })
})
