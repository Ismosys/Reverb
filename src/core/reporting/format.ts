import type { ArtistRecord } from '@shared/types'

/**
 * Pure, dependency-free report formatting. Kept separate from ReportService so
 * the serialization logic is unit-testable without a database or filesystem.
 */

export interface ReportColumn {
  key: keyof ArtistRecord
  header: string
}

export const REPORT_COLUMNS: ReportColumn[] = [
  { key: 'artistId', header: 'Artist ID' },
  { key: 'name', header: 'Name' },
  { key: 'profileUrl', header: 'Profile URL' },
  { key: 'status', header: 'Status' },
  { key: 'updatesEnabled', header: 'Updates Enabled' },
  { key: 'retryCount', header: 'Retries' },
  { key: 'failureReason', header: 'Failure Reason' },
  { key: 'locationLabel', header: 'Location' },
  { key: 'durationMs', header: 'Duration (ms)' },
  { key: 'createdAt', header: 'Discovered' },
  { key: 'processedAt', header: 'Processed' }
]

/** Render a value for a delimited cell (null/undefined → ""). */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/** Escape a single CSV field per RFC 4180 (quote when it contains ",\n or "). */
export function csvEscape(value: unknown): string {
  const s = cellText(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Serialize artist records to CSV (with header row, trailing newline). */
export function recordsToCsv(rows: ArtistRecord[], columns: ReportColumn[] = REPORT_COLUMNS): string {
  const header = columns.map((c) => csvEscape(c.header)).join(',')
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c.key])).join(',')).join('\n')
  return body ? `${header}\n${body}\n` : `${header}\n`
}

/** Escape XML text content. */
export function xmlEscape(value: unknown): string {
  return cellText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Serialize to Excel-openable SpreadsheetML 2003 XML. */
export function recordsToSpreadsheetXml(rows: ArtistRecord[], columns: ReportColumn[] = REPORT_COLUMNS): string {
  const cell = (v: unknown): string => `<Cell><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`
  const headerRow = `<Row>${columns.map((c) => cell(c.header)).join('')}</Row>`
  const dataRows = rows.map((r) => `<Row>${columns.map((c) => cell(r[c.key])).join('')}</Row>`).join('')
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Artists"><Table>${headerRow}${dataRows}</Table></Worksheet>
</Workbook>`
}

/** Average of positive durations (ms), rounded. 0 when none. */
export function averageProcessingMs(rows: ArtistRecord[]): number {
  const durations = rows.map((r) => r.durationMs ?? 0).filter((d) => d > 0)
  if (durations.length === 0) return 0
  return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
}
