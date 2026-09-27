// POST /assistant/ask answers as Server-Sent Events, which the generated client can't read. The
// URL and types still come from Orval; this only reads the stream. Aborting the signal is "Stop".

import { getAskUrl } from '@/api/generated/assistant/assistant'
import type { AskEvent, AskIn } from '@/api/generated/model'
import { ApiError, readCookie } from './api'

export async function askStream(body: AskIn, onEvent: (e: AskEvent) => void, signal: AbortSignal): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' })
  const csrf = readCookie('portal_csrf')
  if (csrf) headers.set('X-CSRF-Token', csrf)
  const res = await fetch(`/api${getAskUrl()}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok || !res.body) {
    let message = "Ask TCFL couldn't answer just now. Try again in a minute."
    try {
      const b = await res.json()
      if (typeof b.detail === 'string') message = b.detail
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      for (const line of chunk.split('\n')) if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)) as AskEvent)
    }
  }
}
