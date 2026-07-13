import { useCallback, useEffect, useState } from 'react'
import type { AppConfig, HealthSnapshot, LogEntry, RunStatus } from '@shared/types'
import { api, unwrap } from './api'

/** Live engine status: seeds from a call then subscribes to pushes. */
export function useEngineStatus(): RunStatus | null {
  const [status, setStatus] = useState<RunStatus | null>(null)
  useEffect(() => api.on.status(setStatus), [])
  return status
}

/** Live health snapshot. */
export function useHealth(): HealthSnapshot | null {
  const [health, setHealth] = useState<HealthSnapshot | null>(null)
  useEffect(() => {
    unwrap(api.health.get()).then(setHealth).catch(() => undefined)
    return api.on.health(setHealth)
  }, [])
  return health
}

/** Streaming log buffer (capped). */
export function useLogs(cap = 500): LogEntry[] {
  const [logs, setLogs] = useState<LogEntry[]>([])
  useEffect(
    () =>
      api.on.log((entry) => {
        setLogs((prev) => {
          const next = [...prev, entry]
          return next.length > cap ? next.slice(next.length - cap) : next
        })
      }),
    [cap]
  )
  return logs
}

/** Config loader with reload + save helpers. */
export function useConfig(): {
  config: AppConfig | null
  reload: () => Promise<void>
  setConfig: (c: AppConfig) => void
} {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const reload = useCallback(async () => {
    setConfig(await unwrap(api.config.get()))
  }, [])
  useEffect(() => {
    reload().catch(() => undefined)
  }, [reload])
  return { config, reload, setConfig }
}
