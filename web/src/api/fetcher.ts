// Orval mutator: every generated request goes through here (web/orval.config.ts).
// Adds the /api prefix, the session cookie, the CSRF header on writes, and throws ApiError.
import { api } from '@/lib/api'

export const apiFetch = <T>(url: string, init: RequestInit = {}): Promise<T> => api<T>(url, init)

export default apiFetch
