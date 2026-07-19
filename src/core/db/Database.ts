import { mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import BetterSqlite3, { type Database as Sqlite } from 'better-sqlite3'
import type { ArtistQuery, ArtistRecord, ArtistStatus, DatabaseStats } from '@shared/types'
import { AppError } from '../utils/errors'

/** Row shape as stored in SQLite (booleans as 0/1). */
interface ArtistRow {
  artist_id: string
  name: string
  profile_url: string
  status: ArtistStatus
  updates_enabled: number
  retry_count: number
  failure_reason: string | null
  location_label: string | null
  profile_id: string | null
  duration_ms: number | null
  created_at: string
  processed_at: string | null
}

function toRecord(row: ArtistRow): ArtistRecord {
  return {
    artistId: row.artist_id,
    name: row.name,
    profileUrl: row.profile_url,
    status: row.status,
    updatesEnabled: row.updates_enabled === 1,
    retryCount: row.retry_count,
    failureReason: row.failure_reason,
    locationLabel: row.location_label,
    profileId: row.profile_id ?? null,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    processedAt: row.processed_at
  }
}

/**
 * SQLite persistence for artists and session bookkeeping. Uses better-sqlite3
 * (synchronous, in-process) which is ideal inside the Electron main process.
 * All writes go through prepared statements to prevent injection and for speed.
 */
export class Database {
  private readonly db: Sqlite
  private readonly dbPath: string

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.dbPath = dbPath
    this.db = new BetterSqlite3(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS artists (
        artist_id       TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        profile_url     TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        updates_enabled INTEGER NOT NULL DEFAULT 0,
        retry_count     INTEGER NOT NULL DEFAULT 0,
        failure_reason  TEXT,
        location_label  TEXT,
        profile_id      TEXT,
        duration_ms     INTEGER,
        created_at      TEXT NOT NULL,
        processed_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_artists_status ON artists(status);
      CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);

      CREATE TABLE IF NOT EXISTS sessions (
        id           TEXT PRIMARY KEY,
        started_at   TEXT NOT NULL,
        ended_at     TEXT,
        location     TEXT,
        target       INTEGER NOT NULL DEFAULT 0,
        processed    INTEGER NOT NULL DEFAULT 0,
        saved        INTEGER NOT NULL DEFAULT 0,
        failed       INTEGER NOT NULL DEFAULT 0,
        skipped      INTEGER NOT NULL DEFAULT 0
      );
    `)
    // Add profile_id to databases created before multi-account support — this
    // MUST run before any index references the column.
    const cols = this.db.prepare(`PRAGMA table_info(artists)`).all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'profile_id')) {
      this.db.exec(`ALTER TABLE artists ADD COLUMN profile_id TEXT`)
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_artists_profile ON artists(profile_id)`)
  }

  /* ----------------------------- Artists ---------------------------- */

  /** Insert if new, otherwise return the existing record untouched. */
  upsertDiscovered(artist: Pick<ArtistRecord, 'artistId' | 'name' | 'profileUrl' | 'locationLabel'>): ArtistRecord {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO artists (artist_id, name, profile_url, status, location_label, created_at)
         VALUES (@artistId, @name, @profileUrl, 'pending', @locationLabel, @now)
         ON CONFLICT(artist_id) DO UPDATE SET
           name = excluded.name,
           profile_url = excluded.profile_url`
      )
      .run({ ...artist, now })
    return this.getArtist(artist.artistId)!
  }

  getArtist(artistId: string): ArtistRecord | null {
    const row = this.db.prepare('SELECT * FROM artists WHERE artist_id = ?').get(artistId) as ArtistRow | undefined
    return row ? toRecord(row) : null
  }

  /**
   * True when the artist has already been saved by ANY account (global dedup).
   * A cheap COUNT so it can be called before every artist is opened.
   */
  isCompleted(artistId: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM artists WHERE artist_id = ? AND status = 'saved' LIMIT 1`)
      .get(artistId)
    return !!row
  }

  markProcessing(artistId: string): void {
    this.db.prepare(`UPDATE artists SET status = 'processing' WHERE artist_id = ?`).run(artistId)
  }

  /** Update the stored display name (resolved from the artist profile). */
  updateName(artistId: string, name: string): void {
    this.db.prepare('UPDATE artists SET name = ? WHERE artist_id = ?').run(name, artistId)
  }

  markResult(
    artistId: string,
    result: {
      status: ArtistStatus
      updatesEnabled?: boolean
      failureReason?: string | null
      durationMs?: number | null
      incrementRetry?: boolean
      /** The account that processed this artist (recorded on save). */
      profileId?: string | null
    }
  ): ArtistRecord {
    this.db
      .prepare(
        `UPDATE artists SET
           status = @status,
           updates_enabled = COALESCE(@updatesEnabled, updates_enabled),
           failure_reason = @failureReason,
           duration_ms = @durationMs,
           profile_id = COALESCE(@profileId, profile_id),
           retry_count = retry_count + @retryInc,
           processed_at = @now
         WHERE artist_id = @artistId`
      )
      .run({
        artistId,
        status: result.status,
        updatesEnabled: result.updatesEnabled === undefined ? null : result.updatesEnabled ? 1 : 0,
        failureReason: result.failureReason ?? null,
        durationMs: result.durationMs ?? null,
        profileId: result.profileId ?? null,
        retryInc: result.incrementRetry ? 1 : 0,
        now: new Date().toISOString()
      })
    const rec = this.getArtist(artistId)
    if (!rec) throw new AppError(`Artist ${artistId} vanished during update`, { code: 'DB' })
    return rec
  }

  /** Aggregate database statistics for the dashboard. */
  stats(): DatabaseStats {
    const one = <T>(sql: string): T => this.db.prepare(sql).get() as T
    const saved = this.countByStatus('saved')
    const skipped = this.countByStatus('skipped')
    const failed = this.countByStatus('failed')
    const total = (one<{ c: number }>('SELECT COUNT(*) AS c FROM artists')).c
    const profilesUsed = (one<{ c: number }>(`SELECT COUNT(DISTINCT profile_id) AS c FROM artists WHERE profile_id IS NOT NULL`)).c
    const avg = (one<{ a: number | null }>(`SELECT AVG(duration_ms) AS a FROM artists WHERE status = 'saved' AND duration_ms > 0`)).a
    const sessions = (one<{ c: number }>('SELECT COUNT(*) AS c FROM sessions')).c
    let sizeBytes = 0
    try {
      sizeBytes = statSync(this.dbPath).size
    } catch {
      sizeBytes = 0
    }
    return {
      totalArtists: total,
      saved,
      skipped,
      failed,
      duplicatesPrevented: skipped,
      profilesUsed,
      averageProcessingMs: avg ? Math.round(avg) : 0,
      sessions,
      sizeBytes
    }
  }

  /** Per-profile saved counts (for the account statistics panel). */
  savedCountByProfile(): Record<string, number> {
    const rows = this.db
      .prepare(`SELECT profile_id AS id, COUNT(*) AS c FROM artists WHERE status = 'saved' AND profile_id IS NOT NULL GROUP BY profile_id`)
      .all() as Array<{ id: string; c: number }>
    return Object.fromEntries(rows.map((r) => [r.id, r.c]))
  }

  /** Per-profile most-recent processed timestamp. */
  lastActivityByProfile(): Record<string, string> {
    const rows = this.db
      .prepare(`SELECT profile_id AS id, MAX(processed_at) AS t FROM artists WHERE profile_id IS NOT NULL AND processed_at IS NOT NULL GROUP BY profile_id`)
      .all() as Array<{ id: string; t: string | null }>
    return Object.fromEntries(rows.filter((r) => r.t).map((r) => [r.id, r.t as string]))
  }

  /** Count of artists in the 'saved' state (used for run targeting). */
  savedCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM artists WHERE status = 'saved'`).get() as { c: number }).c
  }

  countByStatus(status: ArtistStatus): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM artists WHERE status = ?').get(status) as { c: number }).c
  }

  /** Search / paginate artists for the database view. */
  query(q: ArtistQuery = {}): ArtistRecord[] {
    const clauses: string[] = []
    const params: Record<string, unknown> = {}
    if (q.search && q.search.trim()) {
      clauses.push('(name LIKE @search OR profile_url LIKE @search)')
      params.search = `%${q.search.trim()}%`
    }
    if (q.status && q.status !== 'all') {
      clauses.push('status = @status')
      params.status = q.status
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const limit = Math.min(Math.max(q.limit ?? 200, 1), 2000)
    const offset = Math.max(q.offset ?? 0, 0)
    const rows = this.db
      .prepare(`SELECT * FROM artists ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`)
      .all(params) as ArtistRow[]
    return rows.map(toRecord)
  }

  /** All records (used by report generation). */
  all(): ArtistRecord[] {
    return (this.db.prepare('SELECT * FROM artists ORDER BY created_at ASC').all() as ArtistRow[]).map(toRecord)
  }

  deleteArtist(artistId: string): boolean {
    return this.db.prepare('DELETE FROM artists WHERE artist_id = ?').run(artistId).changes > 0
  }

  clearAll(): number {
    const changes = this.db.prepare('DELETE FROM artists').run().changes
    this.db.prepare('DELETE FROM sessions').run()
    return changes
  }

  /* ---------------------------- Sessions ---------------------------- */

  createSession(id: string, location: string | null, target: number): void {
    this.db
      .prepare(`INSERT INTO sessions (id, started_at, location, target) VALUES (?, ?, ?, ?)`)
      .run(id, new Date().toISOString(), location, target)
  }

  finalizeSession(id: string, stats: { processed: number; saved: number; failed: number; skipped: number }): void {
    this.db
      .prepare(
        `UPDATE sessions SET ended_at = @now, processed = @processed, saved = @saved, failed = @failed, skipped = @skipped WHERE id = @id`
      )
      .run({ id, now: new Date().toISOString(), ...stats })
  }

  ok(): boolean {
    try {
      this.db.prepare('SELECT 1').get()
      return true
    } catch {
      return false
    }
  }

  close(): void {
    this.db.close()
  }
}
