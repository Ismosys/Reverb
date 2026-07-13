import { cpuUsage, memoryUsage } from 'node:process'
import type { EngineState, HealthSnapshot } from '@shared/types'
import type { BrowserManager } from '../browser/BrowserManager'
import type { Database } from '../db/Database'
import { TypedEmitter } from '../utils/events'

type HealthEvents = { health: HealthSnapshot }

/**
 * Periodically samples process/browser/db/network health and emits snapshots
 * for the dashboard indicators. Network is probed cheaply against the site.
 */
export class HealthMonitor extends TypedEmitter<HealthEvents> {
  private timer: NodeJS.Timeout | null = null
  private lastCpu = cpuUsage()
  private lastSampleAt = Date.now()
  private engineState: EngineState = 'idle'
  private networkStatus: HealthSnapshot['network'] = 'online'

  constructor(
    private readonly browser: BrowserManager,
    private readonly db: Database,
    private readonly intervalMs = 3000
  ) {
    super()
  }

  setEngineState(state: EngineState): void {
    this.engineState = state
  }

  setNetworkStatus(status: HealthSnapshot['network']): void {
    this.networkStatus = status
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.emit('health', this.sample()), this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Take an immediate health sample. */
  sample(): HealthSnapshot {
    const mem = memoryUsage()
    const now = Date.now()
    const elapsedMs = Math.max(1, now - this.lastSampleAt)
    const usage = cpuUsage(this.lastCpu)
    this.lastCpu = cpuUsage()
    this.lastSampleAt = now
    // CPU percent for this process across the sample window.
    const cpuPercent = Math.min(100, Math.round(((usage.user + usage.system) / 1000 / elapsedMs) * 100))

    return {
      browser: this.browser.status,
      database: this.db.ok() ? 'ok' : 'error',
      network: this.networkStatus,
      automation: this.engineState,
      memoryMb: Math.round(mem.rss / (1024 * 1024)),
      cpuPercent,
      timestamp: new Date().toISOString()
    }
  }
}
