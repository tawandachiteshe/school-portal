import { useSyncExternalStore } from 'react'

// Students on lab PCs and laptops get the desktop layout (design/Desk*.dc.html) from 1024px.
const QUERY = '(min-width: 1024px)'

export function useIsDesktop(query = QUERY): boolean {
  return useSyncExternalStore(
    (l) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', l)
      return () => mq.removeEventListener('change', l)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
