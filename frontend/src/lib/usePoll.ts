import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

/** Charge une ressource puis la rafraîchit à intervalle régulier. */
export function usePoll<T>(path: string, intervalMs = 3000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    try {
      const d = await api<T>(path)
      if (alive.current) {
        setData(d)
        setError(null)
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Erreur')
    }
  }, [path])

  useEffect(() => {
    alive.current = true
    reload()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload()
    }, intervalMs)
    return () => {
      alive.current = false
      window.clearInterval(id)
    }
  }, [reload, intervalMs])

  return { data, error, reload }
}
