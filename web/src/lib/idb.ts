// Minimal IndexedDB key-value store for queued uploads (files are too big for localStorage).

const DB = 'tcfl'
const STORE = 'uploads'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const idbPut = (key: string, value: unknown) => tx('readwrite', (s) => s.put(value, key)).catch(() => undefined)
export const idbDelete = (key: string) => tx('readwrite', (s) => s.delete(key)).catch(() => undefined)
export const idbAll = <T,>() => tx<T[]>('readonly', (s) => s.getAll() as IDBRequest<T[]>).catch(() => [] as T[])
