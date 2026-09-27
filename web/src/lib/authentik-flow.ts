// Drive an Authentik flow from our own screens (docs/10 §10.2). Each response is a challenge; the
// screen for it sends back an answer, and the next challenge comes back. Anything we don't render
// falls back to Authentik's own page for that flow, so a new stage never locks anyone out.

import { readCookie } from './api'

export type FieldErrors = Record<string, { string: string; code: string }[]>

export type Challenge =
  | {
      component: 'ak-stage-identification'
      user_fields: string[] | null
      password_fields: boolean
      enroll_url?: string
      recovery_url?: string
      response_errors?: FieldErrors
    }
  | { component: 'ak-stage-password'; response_errors?: FieldErrors }
  | {
      component: 'ak-stage-prompt'
      fields: { field_key: string; label: string; type: string; required: boolean; placeholder?: string; initial_value?: string }[]
      response_errors?: FieldErrors
    }
  | { component: 'ak-stage-authenticator-sms'; phone_number_required: boolean; response_errors?: FieldErrors }
  | { component: 'ak-stage-access-denied'; error_message?: string }
  | { component: 'xak-flow-redirect'; to: string }
  | { component: 'ak-stage-flow-error'; error?: string }
  | { component: string; response_errors?: FieldErrors }

const base = (slug: string, query = '') => `/auth/api/v3/flows/executor/${slug}/${query ? `?query=${encodeURIComponent(query)}` : ''}`

export const fallbackUrl = (slug: string) => `/auth/if/flow/${slug}/`

async function call(slug: string, init?: RequestInit): Promise<Challenge> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body) {
    headers.set('Content-Type', 'application/json')
    const csrf = readCookie('authentik_csrf')
    if (csrf) headers.set('X-authentik-CSRF', csrf)
  }
  const res = await fetch(base(slug), { ...init, headers, credentials: 'same-origin' })
  if (!res.ok && res.status !== 400) throw new Error(`Sign-in isn't available right now (${res.status}).`)
  return (await res.json()) as Challenge
}

export const startFlow = (slug: string) => call(slug)

export function answer(slug: string, body: Record<string, unknown>): Promise<Challenge> {
  return call(slug, { method: 'POST', body: JSON.stringify(body) })
}

// Mobile numbers are usernames as 263773184521 (sign-up). 0773184521 / +263 77 318 4521 → +263773184521.
export function e164(raw: string): string | null {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('0') && d.length === 10) d = '263' + d.slice(1)
  return /^2637\d{8}$/.test(d) ? `+${d}` : null
}

// What to send as the username: a mobile number in any form becomes 263…; anything else as typed.
export const signInName = (raw: string) => e164(raw)?.slice(1) ?? raw.trim()

// Authentik's wording → the portal's (CLAUDE.md: plain and specific).
const PLAIN: Record<string, string> = {
  'Failed to authenticate.': "That number or password isn't right. Check them, or reset your password.",
  'Invalid password': "That password isn't right.",
  'Code does not match': "That code isn't right.",
}
const plain = (s?: string) => (s ? (PLAIN[s] ?? s) : s)

// The first error for a field, or the stage's general error.
export function fieldError(c: Challenge | null, field: string): string | undefined {
  const e = c && 'response_errors' in c ? c.response_errors : undefined
  return plain(e?.[field]?.[0]?.string)
}

export function generalError(c: Challenge | null): string | undefined {
  if (!c) return undefined
  if (c.component === 'ak-stage-access-denied') return plain((c as { error_message?: string }).error_message) || "You can't sign in with this account."
  if (c.component === 'ak-stage-flow-error') return (c as { error?: string }).error || 'Something went wrong. Try again.'
  return fieldError(c, 'non_field_errors')
}

// The flow finished and Authentik has a session: the portal turns it into its own (OIDC, BFF).
export function finishSignIn(next: string, shared = false) {
  const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/'
  window.location.assign(`/api/auth/login?next=${encodeURIComponent(safe)}${shared ? '&shared=1' : ''}`)
}

// Who is signed in to Authentik (a GET, so no CSRF token is needed). Authentik's CSRF cookie is
// scoped to /auth/, so our screens can't answer a flow for an already signed-in session; they
// offer to continue as that person instead.
export async function authentikUser(): Promise<{ name: string; username: string } | null> {
  try {
    const r = await fetch('/auth/api/v3/core/users/me/', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
    if (!r.ok) return null
    const u = (await r.json()).user
    return u ? { name: u.name || u.username, username: u.username } : null
  } catch {
    return null
  }
}

// Ends the Authentik session. Opening the invalidation flow (a GET, so no CSRF token) runs its
// logout stage; Authentik's own page for it would ignore ?next and show its sign-in screen.
export async function signOutAuthentik(): Promise<void> {
  await fetch('/auth/api/v3/flows/executor/default-invalidation-flow/', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
}
