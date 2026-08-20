import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/$/, '')

export type Session = {
  user: { id: string; full_name: string; email: string; platform_role: 'user' | 'admin' }
  workspace: { id: string; name: string; role: string }
}

type SessionState = {
  session: Session | null
  loading: boolean
  error: Error | null
}

const SessionContext = createContext<SessionState | null>(null)
let sessionRequest: Promise<Session> | null = null

function requestSession() {
  if (!sessionRequest) {
    sessionRequest = fetch(`${API_URL}/api/v1/me`, { credentials: 'include' }).then(async response => {
      if (!response.ok) {
        const error = new Error(`Request failed (${response.status})`)
        Object.assign(error, { status: response.status })
        throw error
      }
      return response.json() as Promise<Session>
    }).catch(error => {
      sessionRequest = null
      throw error
    })
  }
  return sessionRequest
}

export function clearSessionCache() {
  sessionRequest = null
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, loading: true, error: null })
  useEffect(() => {
    let active = true
    requestSession().then(session => {
      if (active) setState({ session, loading: false, error: null })
    }).catch(error => {
      if (active) setState({ session: null, loading: false, error: error as Error })
    })
    return () => { active = false }
  }, [])
  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used within SessionProvider')
  return value
}
