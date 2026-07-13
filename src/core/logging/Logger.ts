import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { dirname } from 'node:path'
import pino, { type Logger as PinoLogger } from 'pino'
import { TypedEmitter } from '../utils/events'
import type { LogEntry } from '@shared/types'

let counter = 0
function nextId(): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER
  return `${Date.now().toString(36)}-${counter.toString(36)}`
}

export interface LogInput {
  level?: LogEntry['level']
  action: string
  status?: string
  message: string
  artist?: string | null
  retryCount?: number
  durationMs?: number | null
  error?: string | null
}

type LoggerEvents = { log: LogEntry }

/**
 * Structured application logger.
 *
 * - Writes newline-delimited JSON to a rotating-ish file via Pino.
 * - Keeps an in-memory ring buffer so the UI can hydrate recent history.
 * - Emits every entry so the main process can stream it to the renderer.
 */
export class Logger extends TypedEmitter<LoggerEvents> {
  private readonly pino: PinoLogger
  private readonly fileStream: WriteStream
  private readonly ring: LogEntry[] = []
  private readonly ringSize = 1000

  constructor(logFilePath: string, level: LogEntry['level'] = 'info') {
    super()
    mkdirSync(dirname(logFilePath), { recursive: true })
    this.fileStream = createWriteStream(logFilePath, { flags: 'a' })
    this.pino = pino({ level, base: undefined }, this.fileStream)
  }

  /** Record a structured event; returns the normalized entry. */
  log(input: LogInput): LogEntry {
    const entry: LogEntry = {
      id: nextId(),
      timestamp: new Date().toISOString(),
      level: input.level ?? 'info',
      action: input.action,
      status: input.status ?? 'ok',
      message: input.message,
      artist: input.artist ?? null,
      retryCount: input.retryCount ?? 0,
      durationMs: input.durationMs ?? null,
      error: input.error ?? null
    }

    this.pino[entry.level]({
      action: entry.action,
      status: entry.status,
      artist: entry.artist,
      retryCount: entry.retryCount,
      durationMs: entry.durationMs,
      error: entry.error
    }, entry.message)

    this.ring.push(entry)
    if (this.ring.length > this.ringSize) this.ring.shift()
    this.emit('log', entry)
    return entry
  }

  info(action: string, message: string, extra: Partial<LogInput> = {}): LogEntry {
    return this.log({ ...extra, level: 'info', action, message })
  }

  warn(action: string, message: string, extra: Partial<LogInput> = {}): LogEntry {
    return this.log({ ...extra, level: 'warn', action, message })
  }

  error(action: string, message: string, extra: Partial<LogInput> = {}): LogEntry {
    return this.log({ ...extra, level: 'error', action, message })
  }

  debug(action: string, message: string, extra: Partial<LogInput> = {}): LogEntry {
    return this.log({ ...extra, level: 'debug', action, message })
  }

  /** Recent entries, newest last. */
  recent(limit = 200): LogEntry[] {
    return this.ring.slice(-limit)
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.fileStream.end(() => resolve()))
  }
}
