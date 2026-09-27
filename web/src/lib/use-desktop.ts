import { useSyncExternalStore } from 'react'

// Students on lab PCs and laptops get the desktop layout (design/Desk*.dc.html) from 1024px.
const QUERY = '(min-width: 1024px)'

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (l) => {
      const mq = window.matchMedia(QUERY)
      mq.addEventListener('change', l)
      return () => mq.removeEventListener('change', l)
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
