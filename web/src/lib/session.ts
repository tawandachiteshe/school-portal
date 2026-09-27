// design/StateSession: when the portal session ends while someone is using a page, the page stays
// as it is under a "You've been signed out" sheet, instead of jumping to the sign-in screen.
import { useSyncExternalStore } from 'react'

let signedIn = false
let expired = false
const listeners = new Set<() => void>()

export function markSignedIn() {
  signedIn = true
  if (expired) {
    expired = false
    listeners.forEach((l) => l())
  }
}

// A request came back 401. Only counts if this page had a session to lose.
export function sessionEnded(): boolean {
  if (!signedIn || expired) return signedIn
  expired = true
  listeners.forEach((l) => l())
  return true
}

export function useSessionExpired(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => expired,
    () => false,
  )
}
