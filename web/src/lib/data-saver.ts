import { useSyncExternalStore } from 'react'

// "Save mobile data" is a per-device choice, so it lives in this browser only.
const KEY = 'tcfl-data-saver'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off' // on by default: most students are on prepaid data
  } catch {
    return true
  }
}

export function setDataSaver(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l())
}

export function useDataSaver(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    read,
    () => true,
  )
}
