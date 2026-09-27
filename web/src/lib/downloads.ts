// Note downloads on slow, prepaid connections (design/DownloadSheet):
// - warn before large files on mobile data or with "Save mobile data" on
// - "Download when I'm on Wi-Fi" queues the file (only offered where the browser reports the
//   connection type, e.g. Chrome on Android)
// - remember what this phone has downloaded

type Connection = EventTarget & { type?: string; saveData?: boolean; effectiveType?: string }

const conn = (): Connection | undefined => (navigator as Navigator & { connection?: Connection }).connection

export const WARN_BYTES = 1_000_000 // ask before anything over 1 MB
export const DONT_ASK_LIMIT = 10_000_000 // "Don't ask again for files under 10 MB"

const DONT_ASK_KEY = 'tcfl-dl-dont-ask-under-10mb'
const QUEUE_KEY = 'tcfl-dl-wifi-queue'

export type Downloadable = { id: string; title: string; size_bytes: number | null }

function store<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

export const onMobileData = () => conn()?.type === 'cellular'
export const canWaitForWifi = () => conn()?.type !== undefined

// `desktop`: lab PCs and laptops aren't on a phone bundle, so there we ask only when the browser
// actually reports mobile data (e.g. a laptop tethered to a phone), never because of "Save mobile data".
export function shouldAsk(size: number | null, dataSaver: boolean, desktop = false): boolean {
  if (!size || size <= WARN_BYTES) return false
  if (desktop ? !onMobileData() : !onMobileData() && !dataSaver && !conn()?.saveData) return false
  if (size < DONT_ASK_LIMIT && store(DONT_ASK_KEY, false)) return false
  return true
}

export function setDontAskUnder10MB(on: boolean) {
  save(DONT_ASK_KEY, on)
}

export const downloadUrl = (id: string) => `/api/student/materials/${id}/download`

export function startDownload(id: string) {
  const a = document.createElement('a')
  a.href = downloadUrl(id)
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

type Queued = { id: string; title: string }

export function queuedForWifi(): Queued[] {
  return store<Queued[]>(QUEUE_KEY, [])
}

export function queueForWifi(item: Downloadable) {
  const q = queuedForWifi().filter((x) => x.id !== item.id)
  save(QUEUE_KEY, [...q, { id: item.id, title: item.title }])
}

// Call once at start-up: downloads queued files as soon as the phone is on Wi-Fi.
export function watchWifiQueue(onStart: (titles: string[]) => void) {
  const c = conn()
  if (!c) return () => {}
  const flush = () => {
    if (c.type !== 'wifi' && c.type !== 'ethernet') return
    const q = queuedForWifi()
    if (!q.length) return
    save(QUEUE_KEY, [])
    q.forEach((x, i) => setTimeout(() => startDownload(x.id), i * 500))
    onStart(q.map((x) => x.title))
  }
  flush()
  c.addEventListener('change', flush)
  return () => c.removeEventListener('change', flush)
}
