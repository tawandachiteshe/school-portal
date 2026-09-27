import { useQueryClient } from '@tanstack/react-query'
import { WifiOff } from 'lucide-react'
import { useEffect } from 'react'
import { healthz } from '@/api/generated/ops/ops'
import { lastSaved, useOnline } from '@/lib/offline'
import { time } from '@/lib/format'

// design/StateOffline: "You're offline. Showing what was saved at 07:40." Retry asks again; the
// browser also refetches by itself as soon as the signal is back.
export function OfflineBar() {
  const online = useOnline()
  const qc = useQueryClient()
  // Pages opened from the saved copy may not ask the server for a while: check once on opening,
  // then every 30 seconds while it can't be reached (api() records the result).
  useEffect(() => {
    const check = () => void healthz().catch(() => undefined)
    check()
    if (online) return
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [online])
  if (online) return null
  const saved = lastSaved(qc)
  return (
    <div role="status" className="flex items-center gap-3 bg-foreground px-4 py-2.5 text-background">
      <WifiOff className="size-5 shrink-0" strokeWidth={1.5} aria-hidden />
      <span className="grow text-sm">
        <span className="font-semibold">You're offline.</span>{' '}
        {saved ? (
          <>
            Showing what was saved at <span className="font-mono">{time(saved)}</span>.
          </>
        ) : (
          'Nothing is saved on this device yet.'
        )}
      </span>
      <button type="button" onClick={() => void qc.refetchQueries({ type: 'active' })} className="h-11 px-1 text-sm underline">
        Retry
      </button>
    </div>
  )
}
