// Fetch wrapper for the FastAPI BFF under /api (docs/10 §10.6). Sends the session cookie and the
// double-submit CSRF header on state-changing requests.

import { reportReachable } from './offline'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function readCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  const method = (rest.method ?? (json === undefined ? 'GET' : 'POST')).toUpperCase()
  const h = new Headers(headers)
  if (json !== undefined) h.set('Content-Type', 'application/json')
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie('portal_csrf')
    if (csrf) h.set('X-CSRF-Token', csrf)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...rest,
      method,
      headers: h,
      credentials: 'same-origin',
      body: json === undefined ? rest.body : JSON.stringify(json),
    })
  } catch (e) {
    // No response at all (not an aborted request): the portal can't be reached.
    if (!(e instanceof DOMException && e.name === 'AbortError')) reportReachable(false)
    throw e
  }
  reportReachable(true)
  if (!res.ok) {
    let message = 'Something went wrong. Try again.'
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') message = body.detail
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
