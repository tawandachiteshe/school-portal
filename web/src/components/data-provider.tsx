import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import type { ReactNode } from 'react'
import { ApiError } from '@/lib/api'
import { KEEP_MS, keepsDataOnDevice, keptOffline, OFFLINE_STORAGE_KEY } from '@/lib/offline'
import { sessionEnded } from '@/lib/session'

// Any 401 while signed in means the session ended (design/StateSession).
const on401 = (e: unknown) => {
  if (e instanceof ApiError && e.status === 401) sessionEnded()
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: on401 }),
  mutationCache: new MutationCache({ onError: on401 }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 1,
      // Kept pages must outlive the default 5 minutes, or they vanish from the saved copy.
      gcTime: keepsDataOnDevice ? KEEP_MS : undefined,
    },
  },
})

// design/StateOffline: phones keep the student's own pages (lib/offline.ts).
export function DataProvider({ children }: { children: ReactNode }) {
  if (!keepsDataOnDevice) return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  let storage: Storage | undefined
  try {
    storage = window.localStorage
  } catch {
    storage = undefined
  }
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: createSyncStoragePersister({ storage, key: OFFLINE_STORAGE_KEY, throttleTime: 2000 }),
        maxAge: KEEP_MS,
        dehydrateOptions: { shouldDehydrateQuery: keptOffline },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
