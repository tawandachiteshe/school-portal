import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { useDataSaver } from '@/lib/data-saver'
import { queueForWifi, shouldAsk, startDownload } from '@/lib/downloads'
import { invalidateStudentData } from '@/lib/student'
import { useIsDesktop } from '@/lib/use-desktop'
import { DownloadSheet, type PendingDownload } from './download-sheet'

// Download a note, asking first when it's large and the phone is saving data.
export function useNoteDownload() {
  const dataSaver = useDataSaver()
  const desktop = useIsDesktop()
  const qc = useQueryClient()
  const [pending, setPending] = useState<PendingDownload | null>(null)

  const go = (id: string) => {
    startDownload(id)
    // The API records the download; refresh "downloaded" / "new note" markers.
    setTimeout(() => void invalidateStudentData(qc), 1500)
  }

  const request = (note: Omit<PendingDownload, 'size_bytes'> & { size_bytes: number | null }, opts?: { ask?: boolean }) => {
    if (opts?.ask !== false && shouldAsk(note.size_bytes, dataSaver, desktop)) setPending({ ...note, size_bytes: note.size_bytes! })
    else go(note.id)
  }

  const sheet = (
    <DownloadSheet
      file={pending}
      onClose={() => setPending(null)}
      onDownload={() => {
        if (pending) go(pending.id)
        setPending(null)
      }}
      onWifi={() => {
        if (pending) {
          queueForWifi(pending)
          toast(`${pending.title} will download when you're on Wi-Fi.`)
        }
        setPending(null)
      }}
    />
  )

  return { request, sheet }
}
