import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, type User } from '../lib/api'

type AuthCtx = {
  user: User | null
  loading: boolean
  login: (email: string, password: string, remember: boolean) => Promise<void>
  register: (name: string, email: string, password: string, remember?: boolean) => Promise<void>
  logout: () => Promise<void>
  setUser: (u: User) => void
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const d = await api<{ user: User | null }>('/api/auth/me')
    setUser(d.user)
  }, [])

  useEffect(() => {
    refresh()
      .catch((e) => console.warn(e))
      .finally(() => setLoading(false))
  }, [refresh])

  const login = useCallback(async (email: string, password: string, remember: boolean) => {
    const d = await api<{ user: User }>('/api/auth/login', { body: { email, password, remember } })
    setUser(d.user)
  }, [])

  const register = useCallback(async (name: string, email: string, password: string, remember = true) => {
    const d = await api<{ user: User }>('/api/auth/register', { body: { name, email, password, remember } })
    setUser(d.user)
  }, [])

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
  }, [])

  return <Ctx.Provider value={{ user, loading, login, register, logout, setUser, refresh }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth hors AuthProvider')
  return c
}

export { ApiError }
