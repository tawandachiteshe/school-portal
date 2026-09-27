import { useEffect, useState } from 'react'

// Current time, re-rendered every `ms` (default one minute) so "starts in 20 min" stays true.
export function useNow(ms = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
