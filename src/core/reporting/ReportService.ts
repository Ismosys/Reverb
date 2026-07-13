import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ArtistRecord, ReportFormat, SessionReport } from '@shared/types'
import type { Database } from '../db/Database'
import type { Logger } from '../logging/Logger'
import { AppError } from '../utils/errors'
import { averageProcessingMs, recordsToCsv, recordsToSpreadsheetXml } from './format'

/**
 * Generates session reports and exports the artist database in CSV / JSON /
 * "xlsx". The xlsx export is written as an Excel-openable SpreadsheetML 2003
 * XML document so we avoid a heavy binary-xlsx dependency while remaining fully
 * Excel-compatible.
 */
export class ReportService {
  constructor(
    private readonly db: Database,
    private readonly reportsDir: string,
    private readonly log: Logger
  ) {}

  /** Build an in-memory report object from a completed session. */
  buildSessionReport(input: {
    sessionId: string
    startTime: string
    endTime: string
    locationLabel: string | null
  }): SessionReport {
    const artists = this.db.all()
    return {
      sessionId: input.sessionId,
      startTime: input.startTime,
      endTime: input.endTime,
      durationMs: new Date(input.endTime).getTime() - new Date(input.startTime).getTime(),
      locationLabel: input.locationLabel,
      processed: artists.filter((a) => a.processedAt).length,
      saved: this.db.countByStatus('saved'),
      failed: this.db.countByStatus('failed'),
      skipped: this.db.countByStatus('skipped'),
      averageProcessingMs: averageProcessingMs(artists),
      artists
    }
  }

  /** Export the given artists (or the whole DB) to `format`. Returns path. */
  export(format: ReportFormat, records?: ArtistRecord[], filenameBase?: string): string {
    mkdirSync(this.reportsDir, { recursive: true })
    const rows = records ?? this.db.all()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const base = filenameBase ?? `reverb-report-${stamp}`

    let path: string
    switch (format) {
      case 'json':
        path = join(this.reportsDir, `${base}.json`)
        writeFileSync(path, JSON.stringify(rows, null, 2), 'utf-8')
        break
      case 'csv':
        path = join(this.reportsDir, `${base}.csv`)
        writeFileSync(path, recordsToCsv(rows), 'utf-8')
        break
      case 'xlsx':
        path = join(this.reportsDir, `${base}.xls`)
        writeFileSync(path, recordsToSpreadsheetXml(rows), 'utf-8')
        break
      default:
        throw new AppError(`Unsupported report format: ${format}`, { code: 'REPORT' })
    }
    this.log.info('report', `Exported ${rows.length} record(s) to ${path}`)
    return path
  }

  /** Write a full session summary as JSON alongside the artist export. */
  writeSessionReport(report: SessionReport): string {
    mkdirSync(this.reportsDir, { recursive: true })
    const path = join(this.reportsDir, `session-${report.sessionId}.json`)
    writeFileSync(path, JSON.stringify(report, null, 2), 'utf-8')
    this.log.info('report', `Session report written to ${path}`)
    return path
  }
}
