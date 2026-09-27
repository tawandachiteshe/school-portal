// State for the results pages (design/Zimsec, ZimsecPages): sending page photos, and the sittings
// the applicant is editing.
import { useState } from 'react'
import { toast } from 'sonner'
import type { ResultsState, SittingIn } from '@/api/generated/model'
import { errorMessage } from '@/lib/api'
import { asFile, assessImage, compressImage } from '../id/compress'
import type { PhotoQuality } from '../id/IdCamera'
import { checkable, type Draft, toDraft } from './drafts'

export type ResultsApi = {
  state: ResultsState | undefined
  addPage: (file: File, scan: string | undefined, quality: string | null) => Promise<unknown>
  removePage: (documentId: string) => Promise<unknown>
  read: (scan: string) => Promise<unknown>
  save: (body: { sittings: SittingIn[] }) => Promise<unknown>
  fileUrl: (documentId: string) => string
}

// Photos → upload one page at a time, with a quality label.
export function usePageUpload(api: ResultsApi) {
  const [busy, setBusy] = useState(false)
  async function send(photo: Blob, scan: string | undefined, quality: PhotoQuality | null) {
    setBusy(true)
    try {
      const q = quality ?? (await assessImage(photo))
      await api.addPage(asFile(await compressImage(photo), 'zimsec-slip.jpg'), scan, q)
      return true
    } catch (e) {
      toast(errorMessage(e, "Couldn't send the photo. Check your signal and try again."))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { send, busy }
}

const blank = (key: string): Draft => ({
  key,
  status: 'read',
  level: 'O',
  session: 'NOVEMBER',
  year: '',
  centre: '',
  candidate: '',
  name: null,
  rows: [],
  pages: [],
  read_at: null,
  editing: true,
})

// Edits are kept per sitting until saved; the server's copy fills in the rest.
export function useDrafts(state: ResultsState | undefined) {
  const [edits, setEdits] = useState<Record<string, Draft>>({})
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [typed, setTyped] = useState<string[]>([]) // sittings typed in by hand, not read from a photo
  const drafts = state
    ? [
        ...checkable(state)
          .filter((s) => !removed.has(s.key))
          .map((s) => (edits[s.key] && edits[s.key].status === s.status ? edits[s.key] : toDraft(s))),
        ...typed.filter((k) => !removed.has(k)).map((k) => edits[k] ?? blank(k)),
      ]
    : []
  const addBlank = () => setTyped((t) => [...t, `typed-${t.length + 1}`])
  const set = (key: string, p: Partial<Draft>) =>
    setEdits((e) => ({ ...e, [key]: { ...(e[key] ?? drafts.find((d) => d.key === key)!), ...p } }))
  const remove = (key: string) => setRemoved((r) => new Set(r).add(key))
  const reset = () => {
    setEdits({})
    setRemoved(new Set())
    setTyped([])
  }
  return { drafts, set, remove, reset, addBlank }
}
