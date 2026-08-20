const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/$/, '')

const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export class ApiError extends Error {
  status: number
  requestId?: string

  constructor(message: string, status: number, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.requestId = requestId
  }
}

export function getCsrfToken(cookie = document.cookie) {
  const value = cookie.split('; ').find(item => item.startsWith('opsai_csrf='))?.slice('opsai_csrf='.length)
  return value ? decodeURIComponent(value) : ''
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (mutationMethods.has(method)) {
    const token = getCsrfToken()
    if (token) headers.set('X-CSRF-Token', token)
  }

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, method, headers, credentials: 'include' })
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : 'Network request failed', 0)
  }

  if (!response.ok) {
    let body: { error?: string; message?: string; request_id?: string } = {}
    try { body = await response.json() as typeof body } catch { /* Non-JSON errors use status message. */ }
    throw new ApiError(body.error || body.message || `Request failed (${response.status})`, response.status, body.request_id)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function unwrapList<T>(body: T[] | Record<string, unknown>, key: string): T[] {
  if (Array.isArray(body)) return body
  const value = body[key] ?? body.data
  return Array.isArray(value) ? value as T[] : []
}

export function unwrapOne<T>(body: T | Record<string, unknown>, key: string): T {
  if (body && typeof body === 'object' && key in body) return (body as Record<string, T>)[key]
  if (body && typeof body === 'object' && 'data' in body) return (body as Record<string, T>).data
  return body as T
}
