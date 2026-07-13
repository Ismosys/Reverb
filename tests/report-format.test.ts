import { describe, expect, it } from 'vitest'
import type { ArtistRecord } from '@shared/types'
import {
  averageProcessingMs,
  csvEscape,
  recordsToCsv,
  recordsToSpreadsheetXml,
  xmlEscape
} from '@core/reporting/format'

function makeRecord(over: Partial<ArtistRecord> = {}): ArtistRecord {
  return {
    artistId: '1',
    name: 'Alpha',
    profileUrl: 'https://www.reverbnation.com/artist/1',
    status: 'saved',
    updatesEnabled: true,
    retryCount: 0,
    failureReason: null,
    locationLabel: 'Austin, TX',
    durationMs: 1200,
    createdAt: '2026-07-13T00:00:00.000Z',
    processedAt: '2026-07-13T00:01:00.000Z',
    ...over
  }
}

describe('csvEscape', () => {
  it('leaves simple values untouched', () => {
    expect(csvEscape('hello')).toBe('hello')
    expect(csvEscape(42)).toBe('42')
  })

  it('renders null/undefined as empty', () => {
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
  })

  it('quotes and doubles quotes when needed', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
  })
})

describe('recordsToCsv', () => {
  it('emits a header even with no rows', () => {
    const csv = recordsToCsv([])
    expect(csv.startsWith('Artist ID,Name,Profile URL')).toBe(true)
    expect(csv.trim().split('\n')).toHaveLength(1)
  })

  it('emits header + one line per record with a trailing newline', () => {
    const csv = recordsToCsv([makeRecord(), makeRecord({ artistId: '2', name: 'Beta' })])
    const lines = csv.trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(csv.endsWith('\n')).toBe(true)
    expect(lines[1]).toContain('Alpha')
    expect(lines[2]).toContain('Beta')
  })

  it('escapes a name containing a comma', () => {
    const csv = recordsToCsv([makeRecord({ name: 'Smith, John' })])
    expect(csv).toContain('"Smith, John"')
  })

  it('renders booleans and nulls', () => {
    const csv = recordsToCsv([makeRecord({ updatesEnabled: false, failureReason: null })])
    const cells = csv.trimEnd().split('\n')[1].split(',')
    // updates_enabled column (index 4) is "false"
    expect(cells[4]).toBe('false')
  })
})

describe('xmlEscape', () => {
  it('escapes markup metacharacters', () => {
    expect(xmlEscape('a<b>&"c"')).toBe('a&lt;b&gt;&amp;&quot;c&quot;')
  })
})

describe('recordsToSpreadsheetXml', () => {
  it('produces a valid Excel workbook envelope', () => {
    const xml = recordsToSpreadsheetXml([makeRecord()])
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>')
    expect(xml).toContain('<Worksheet ss:Name="Artists">')
    expect(xml).toContain('Alpha')
  })

  it('escapes special characters in cell data', () => {
    const xml = recordsToSpreadsheetXml([makeRecord({ name: 'Tom & Jerry <Live>' })])
    expect(xml).toContain('Tom &amp; Jerry &lt;Live&gt;')
    expect(xml).not.toContain('<Live>')
  })
})

describe('averageProcessingMs', () => {
  it('averages positive durations and rounds', () => {
    const rows = [makeRecord({ durationMs: 100 }), makeRecord({ durationMs: 201 })]
    expect(averageProcessingMs(rows)).toBe(151)
  })

  it('ignores zero/null durations', () => {
    const rows = [makeRecord({ durationMs: 0 }), makeRecord({ durationMs: null }), makeRecord({ durationMs: 300 })]
    expect(averageProcessingMs(rows)).toBe(300)
  })

  it('returns 0 when there are no positive durations', () => {
    expect(averageProcessingMs([makeRecord({ durationMs: null })])).toBe(0)
    expect(averageProcessingMs([])).toBe(0)
  })
})
