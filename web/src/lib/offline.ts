// Offline (design/StateOffline): on phones, the student's own pages are kept on the device so they
// still open without signal. Not on computers: lab PCs are shared (StaffSignIn "shared computer").
import type { Query, QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

export const OFFLINE_STORAGE_KEY = 'tcfl-offline-v1'
const OWNER_KEY = 'tcfl-offline-owner'
export const KEEP_MS = 7 * 24 * 3600_000

// Decided once at start-up: the same query as useIsDesktop.
export const keepsDataOnDevice =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 1024px)').matches

// Only the asker's own student pages (and who they are). Never staff pages or Ask Campus.
export function keptOffline(q: Pick<Query, 'queryKey' | 'state'>): boolean {
  const k = q.queryKey[0]
  return (
    q.state.status === 'success' &&
    // "Nobody signed in" is never kept: after signing in, a saved null would send them back to /login.
    q.state.data != null &&
    typeof k === 'string' &&
    (k === '/me' || (k.startsWith('/student/') && !k.startsWith('/student/search')) || k === '/library/home')
  )
}

function store(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function forgetOfflineData() {
  store()?.removeItem(OFFLINE_STORAGE_KEY)
  store()?.removeItem(OWNER_KEY)
}

// A different person signed in on this phone: drop what the last one left.
export function claimOfflineData(qc: QueryClient, userId: string) {
  const s = store()
  if (!s) return
  const owner = s.getItem(OWNER_KEY)
  if (owner && owner !== userId) {
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== '/me' })
    s.removeItem(OFFLINE_STORAGE_KEY)
  }
  s.setItem(OWNER_KEY, userId)
}

// Phones often say they're online with no data getting through (weak signal, no bundle left), so
// a request that can't reach the portal also counts as offline, until one gets through again.
let unreachable = false
const listeners = new Set<() => void>()

export function reportReachable(ok: boolean) {
  if (unreachable === !ok) return
  unreachable = !ok
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine && !unreachable, () => true)
}

// When the kept data was last fetched ("Showing what was saved at 07:40").
export function lastSaved(qc: QueryClient): Date | null {
  const times = qc
    .getQueryCache()
    .getAll()
    .filter((q) => keptOffline(q))
    .map((q) => q.state.dataUpdatedAt)
    .filter(Boolean)
  return times.length ? new Date(Math.max(...times)) : null
}
