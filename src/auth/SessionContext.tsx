import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { API_URL } from '../api/client'

export type Session = {
  user: { id: string; full_name: string; email: string; platform_role: 'user' | 'admin' }
  workspace: { id: string; name: string; role: string }
}

type SessionState = {
  session: Session | null
  loading: boolean
  error: Error | null
  refresh: () => Promise<Session | null>
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
  const [state, setState] = useState<Omit<SessionState, 'refresh'>>({ session: null, loading: true, error: null })
  const refresh = async () => {
    clearSessionCache()
    setState(s => ({ ...s, loading: true }))
    try {
      const session = await requestSession()
      setState({ session, loading: false, error: null })
      return session
    } catch (error) {
      setState({ session: null, loading: false, error: error as Error })
      return null
    }
  }

  useEffect(() => {
    let active = true
    requestSession().then(session => {
      if (active) setState({ session, loading: false, error: null })
    }).catch(error => {
      if (active) setState({ session: null, loading: false, error: error as Error })
    })
    return () => { active = false }
  }, [])
  return <SessionContext.Provider value={{ ...state, refresh }}>{children}</SessionContext.Provider>
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used within SessionProvider')
  return value
}
