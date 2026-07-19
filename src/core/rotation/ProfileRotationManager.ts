import type { Profile, RotationStatus } from '@shared/types'
import type { ConfigManager } from '../config/ConfigManager'
import type { Logger } from '../logging/Logger'

/**
 * Coordinates the pool of logged-in accounts for a single automation run.
 *
 * All accounts with a saved session form one pool. The engine processes the
 * current account until it hits the per-account limit (or its source is
 * exhausted), then calls {@link advance} to rotate to the next account, all
 * toward a single global target. This module owns *which* account is active and
 * *how much* each has done this run — it knows nothing about artist processing.
 */
export class ProfileRotationManager {
  private queue: Profile[] = []
  private index = 0
  private readonly counts = new Map<string, number>()
  private readonly finished = new Set<string>()
  private rotating = false

  constructor(
    private readonly config: ConfigManager,
    private readonly log: Logger
  ) {}

  /** Accounts that have a persisted login and can be used in a run. */
  eligibleProfiles(): Profile[] {
    return this.config
      .profilesInfo()
      .filter((p) => p.hasSession)
      .map(({ id, name, createdAt }) => ({ id, name, createdAt }))
  }

  /**
   * Build the run queue. When rotating, all logged-in accounts join the pool
   * (active account first). Otherwise the pool is just the active account.
   */
  begin(rotate: boolean): void {
    this.index = 0
    this.counts.clear()
    this.finished.clear()
    const active = this.config.getActiveProfile()

    if (!rotate) {
      this.rotating = false
      this.queue = [active]
      return
    }

    const eligible = this.eligibleProfiles()
    const ordered = [...eligible.filter((p) => p.id === active.id), ...eligible.filter((p) => p.id !== active.id)]
    this.queue = ordered.length > 0 ? ordered : [active]
    this.rotating = this.queue.length > 1
    this.log.info(
      'rotation',
      `Account pool: ${this.queue.length} account(s) — ${this.queue.map((p) => p.name).join(', ')}`
    )
  }

  current(): Profile | null {
    return this.queue[this.index] ?? null
  }

  /** Record one saved artist against the current account. */
  recordSave(): void {
    const c = this.current()
    if (!c) return
    this.counts.set(c.id, (this.counts.get(c.id) ?? 0) + 1)
  }

  currentCount(): number {
    const c = this.current()
    return c ? this.counts.get(c.id) ?? 0 : 0
  }

  /** Whether the current account has hit its per-account limit (0 = never). */
  limitReached(perProfileLimit: number): boolean {
    return perProfileLimit > 0 && this.currentCount() >= perProfileLimit
  }

  /** Mark the current account finished and move to the next; returns it or null. */
  advance(): Profile | null {
    const c = this.current()
    if (c) {
      this.finished.add(c.id)
      this.log.info('rotation', `Account "${c.name}" finished (${this.counts.get(c.id) ?? 0} saved)`)
    }
    this.index++
    return this.current()
  }

  hasMore(): boolean {
    return this.index < this.queue.length
  }

  status(perProfileLimit: number): RotationStatus {
    const c = this.current()
    return {
      enabled: this.rotating,
      activeProfileId: c?.id ?? null,
      activeProfileName: c?.name ?? null,
      profileProcessed: this.currentCount(),
      profileLimit: perProfileLimit,
      profilesTotal: this.queue.length,
      profilesFinished: this.finished.size,
      rotationNumber: Math.min(this.index + 1, this.queue.length)
    }
  }
}
