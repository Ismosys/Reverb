import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import BetterSqlite3, { type Database as Sqlite } from 'better-sqlite3'
import type { ArtistQuery, ArtistRecord, ArtistStatus } from '@shared/types'
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

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
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

  /** True when the artist already reached a terminal, successful state. */
  isCompleted(artistId: string): boolean {
    const row = this.getArtist(artistId)
    return row?.status === 'saved'
  }

  markProcessing(artistId: string): void {
    this.db.prepare(`UPDATE artists SET status = 'processing' WHERE artist_id = ?`).run(artistId)
  }

  markResult(
    artistId: string,
    result: {
      status: ArtistStatus
      updatesEnabled?: boolean
      failureReason?: string | null
      durationMs?: number | null
      incrementRetry?: boolean
    }
  ): ArtistRecord {
    this.db
      .prepare(
        `UPDATE artists SET
           status = @status,
           updates_enabled = COALESCE(@updatesEnabled, updates_enabled),
           failure_reason = @failureReason,
           duration_ms = @durationMs,
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
        retryInc: result.incrementRetry ? 1 : 0,
        now: new Date().toISOString()
      })
    const rec = this.getArtist(artistId)
    if (!rec) throw new AppError(`Artist ${artistId} vanished during update`, { code: 'DB' })
    return rec
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
