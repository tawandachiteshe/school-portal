import { useMatches } from 'react-router'

// True when the current route has its own desktop layout (route handle { desk: true }).
export function useHasDeskLayout() {
  const matches = useMatches()
  return matches.some((m) => (m.handle as { desk?: boolean } | undefined)?.desk)
}
