// Resumable uploads for submitted work (design/SubmitWork: uploading, queued, failed).
//
// - The file goes up in chunks; after a drop it resumes from the byte the server last stored.
// - Offline, the upload waits ("Waiting for a signal") and starts again by itself when back online.
// - The file is kept in IndexedDB until the upload finishes, so closing the tab doesn't lose it.
// - Uploads live outside React, so leaving the page doesn't stop them.
import { useSyncExternalStore } from 'react'
import {
  cancelUpload as apiCancelUpload,
  completeUpload as apiCompleteUpload,
  startUpload as apiStartUpload,
  uploadStatus,
} from '@/api/generated/deadlines/deadlines'
import { ApiError, readCookie } from '@/lib/api'
import { idbAll, idbDelete, idbPut } from '@/lib/idb'

export type Phase = 'uploading' | 'queued' | 'failed' | 'done'

export type UploadState = {
  assessmentId: string
  uploadId: string
  filename: string
  size: number
  received: number
  phase: Phase
  secondsLeft: number | null
  error: string | null
}

type Saved = {
  assessmentId: string
  uploadId: string
  file: Blob
  filename: string
  size: number
  mime: string
  note: string
}

const states = new Map<string, UploadState>()
const listeners = new Set<() => void>()
const running = new Map<string, { xhr?: XMLHttpRequest; cancelled?: boolean }>()
let onComplete: (assessmentId: string) => void = () => {}

function set(id: string, patch: Partial<UploadState>) {
  const prev = states.get(id)
  if (!prev && !patch.uploadId) return
  states.set(id, { ...(prev as UploadState), ...patch })
  listeners.forEach((l) => l())
}

function clear(id: string) {
  states.delete(id)
  listeners.forEach((l) => l())
}

export function useUpload(assessmentId: string): UploadState | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => states.get(assessmentId),
  )
}

// PUT one chunk with progress. Resolves with the server's received_bytes.
function putChunk(s: Saved, offset: number, blob: Blob, onProgress: (loaded: number) => void, ctl: { xhr?: XMLHttpRequest }) {
  return new Promise<number>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    ctl.xhr = xhr
    xhr.open('PUT', `/api/student/uploads/${s.uploadId}?offset=${offset}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('X-CSRF-Token', readCookie('portal_csrf') ?? '')
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText)
        if (xhr.status === 200) return resolve(body.received_bytes)
        if (xhr.status === 409 && typeof body.detail?.received_bytes === 'number')
          return resolve(body.detail.received_bytes) // out of step: resume where the server is
        reject(new ApiError(xhr.status, typeof body.detail === 'string' ? body.detail : 'Upload failed.'))
      } catch {
        reject(new ApiError(xhr.status, 'Upload failed.'))
      }
    }
    xhr.onerror = () => reject(new TypeError('network'))
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'))
    xhr.send(blob)
  })
}

const waitOnline = () =>
  new Promise<void>((resolve) => window.addEventListener('online', () => resolve(), { once: true }))

async function run(s: Saved) {
  if (running.has(s.assessmentId)) return
  const ctl: { xhr?: XMLHttpRequest; cancelled?: boolean } = {}
  running.set(s.assessmentId, ctl)
  let failures = 0
  try {
    let { received_bytes: offset, chunk_bytes: chunk = 256 * 1024 } = await uploadStatus(s.uploadId)
    let lastT = performance.now()
    let lastB = offset
    let rate = 0 // bytes per second, smoothed
    set(s.assessmentId, { received: offset, phase: 'uploading', error: null })
    while (offset < s.size && !ctl.cancelled) {
      if (!navigator.onLine) {
        set(s.assessmentId, { phase: 'queued', secondsLeft: null })
        await waitOnline()
        set(s.assessmentId, { phase: 'uploading' })
      }
      try {
        const end = Math.min(offset + chunk, s.size)
        offset = await putChunk(
          s,
          offset,
          s.file.slice(offset, end),
          (loaded) => {
            const now = performance.now()
            const bytes = offset + loaded
            if (now - lastT > 500) {
              const r = ((bytes - lastB) * 1000) / (now - lastT)
              rate = rate ? rate * 0.7 + r * 0.3 : r
              lastT = now
              lastB = bytes
            }
            set(s.assessmentId, { received: bytes, secondsLeft: rate > 0 ? (s.size - bytes) / rate : null })
          },
          ctl,
        )
        failures = 0
        set(s.assessmentId, { received: offset })
      } catch (e) {
        if (ctl.cancelled) return
        if (e instanceof ApiError && e.status !== 0 && e.status < 500) throw e
        if (!navigator.onLine) continue // loop waits for the signal
        if (++failures >= 3) throw e
        await new Promise((r) => setTimeout(r, 1000 * 2 ** failures))
        ;({ received_bytes: offset, chunk_bytes: chunk = chunk } = await uploadStatus(s.uploadId))
      }
    }
    if (ctl.cancelled) return
    await apiCompleteUpload(s.uploadId, { note: s.note || null })
    await idbDelete(s.assessmentId)
    set(s.assessmentId, { phase: 'done', received: s.size, secondsLeft: 0 })
    onComplete(s.assessmentId)
  } catch (e) {
    if (ctl.cancelled) return
    if (!navigator.onLine) {
      // Dropped while finishing: try again once the signal is back.
      set(s.assessmentId, { phase: 'queued' })
      running.delete(s.assessmentId)
      await waitOnline()
      return run(s)
    }
    set(s.assessmentId, {
      phase: 'failed',
      error: e instanceof ApiError && e.status && e.status < 500 ? e.message : null,
    })
  } finally {
    running.delete(s.assessmentId)
  }
}

const saved = new Map<string, Saved>()

export async function startUpload(assessmentId: string, file: File, note: string) {
  const mime = file.type || 'application/octet-stream'
  const up = await apiStartUpload(assessmentId, { filename: file.name, size_bytes: file.size, mime_type: mime })
  const s: Saved = { assessmentId, uploadId: up.id, file, filename: file.name, size: file.size, mime, note }
  saved.set(assessmentId, s)
  await idbPut(assessmentId, s)
  states.set(assessmentId, {
    assessmentId,
    uploadId: up.id,
    filename: file.name,
    size: file.size,
    received: 0,
    phase: navigator.onLine ? 'uploading' : 'queued',
    secondsLeft: null,
    error: null,
  })
  listeners.forEach((l) => l())
  void run(s)
}

export function retryUpload(assessmentId: string) {
  const s = saved.get(assessmentId)
  if (s) void run(s)
}

export async function cancelUpload(assessmentId: string) {
  const s = saved.get(assessmentId)
  const ctl = running.get(assessmentId)
  if (ctl) {
    ctl.cancelled = true
    ctl.xhr?.abort()
  }
  saved.delete(assessmentId)
  clear(assessmentId)
  await idbDelete(assessmentId)
  if (s) await apiCancelUpload(s.uploadId).catch(() => undefined)
}

export function dismissUpload(assessmentId: string) {
  saved.delete(assessmentId)
  clear(assessmentId)
}

// Called once at start-up: resume uploads saved on this phone.
export async function resumeSavedUploads(done: (assessmentId: string) => void) {
  onComplete = done
  for (const s of await idbAll<Saved>()) {
    if (saved.has(s.assessmentId)) continue
    try {
      await uploadStatus(s.uploadId)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        await idbDelete(s.assessmentId) // finished or cancelled elsewhere
        continue
      }
    }
    saved.set(s.assessmentId, s)
    states.set(s.assessmentId, {
      assessmentId: s.assessmentId,
      uploadId: s.uploadId,
      filename: s.filename,
      size: s.size,
      received: 0,
      phase: navigator.onLine ? 'uploading' : 'queued',
      secondsLeft: null,
      error: null,
    })
    listeners.forEach((l) => l())
    void run(s)
  }
}
