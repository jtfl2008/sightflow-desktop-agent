import { createRequire } from 'node:module'
import { AuditEventInput, AuditExport, AuditRecord } from './audit-types'

const nodeRequire = createRequire(__filename)

interface AuditStoreBackend {
  get(key: 'records'): AuditRecord[] | undefined
  set(key: 'records', value: AuditRecord[]): void
}

interface AuditStoreOptions {
  maxRecords?: number
  backend?: AuditStoreBackend
  now?: () => Date
}

const DEFAULT_MAX_RECORDS = 500
const REDACTED = '[REDACTED]'
const SENSITIVE_KEY_PATTERN =
  /(api[-_]?key|authorization|bearer|token|secret|password|provider[-_]?key|clipboard|clipboard[-_]?history|clipboard[-_]?text|screenshot|image|base64)/i

export class AuditStore {
  private readonly maxRecords: number
  private readonly backend: AuditStoreBackend
  private readonly now: () => Date
  private sequence = 0

  constructor(options: AuditStoreOptions = {}) {
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
    this.backend = options.backend ?? createElectronStoreBackend()
    this.now = options.now ?? (() => new Date())
  }

  record(input: AuditEventInput): AuditRecord {
    const occurredAt = input.occurredAt ?? this.now().toISOString()
    const record: AuditRecord = {
      id: this.createId(occurredAt),
      category: input.category,
      action: input.action,
      severity: input.severity ?? (input.category === 'error' ? 'error' : 'info'),
      message: input.message,
      metadata: sanitizeMetadata(input.metadata ?? {}),
      occurredAt
    }

    const records = [...this.readRecords(), record].slice(-this.maxRecords)
    this.backend.set('records', records)
    return record
  }

  getRecent(limit = this.maxRecords): AuditRecord[] {
    return this.readRecords().slice(-Math.max(0, limit)).reverse()
  }

  exportData(limit = this.maxRecords): AuditExport {
    return {
      exportedAt: this.now().toISOString(),
      records: this.getRecent(limit)
    }
  }

  exportJson(limit = this.maxRecords): string {
    return `${JSON.stringify(this.exportData(limit), null, 2)}\n`
  }

  exportMarkdown(limit = this.maxRecords): string {
    const lines = ['# Audit Log', '', `Exported at: ${this.now().toISOString()}`, '']
    for (const record of this.getRecent(limit)) {
      lines.push(
        `## ${record.occurredAt} ${record.category}.${record.action}`,
        '',
        `- Severity: ${record.severity}`,
        `- ID: ${record.id}`
      )
      if (record.message) lines.push(`- Message: ${record.message}`)
      lines.push('', '```json', JSON.stringify(record.metadata, null, 2), '```', '')
    }
    return `${lines.join('\n')}\n`
  }

  clear(): void {
    this.backend.set('records', [])
  }

  private readRecords(): AuditRecord[] {
    const records = this.backend.get('records')
    return Array.isArray(records) ? records : []
  }

  private createId(occurredAt: string): string {
    this.sequence += 1
    return `${occurredAt.replace(/[^0-9]/g, '')}-${this.sequence.toString().padStart(4, '0')}`
  }
}

export function sanitizeMetadata(value: unknown, depth = 0): Record<string, unknown> {
  const sanitized = sanitizeValue(value, depth)
  return isPlainRecord(sanitized) ? sanitized : { value: sanitized }
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 8) return '[MAX_DEPTH]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1))
  if (!isPlainRecord(value)) return String(value)

  return Object.entries(value).reduce<Record<string, unknown>>((acc, [key, item]) => {
    acc[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitizeValue(item, depth + 1)
    return acc
  }, {})
}

function sanitizeString(value: string): string {
  if (value.startsWith('data:image/') || value.length > 2000) return REDACTED
  return value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createElectronStoreBackend(): AuditStoreBackend {
  const storeModule = nodeRequire('electron-store') as {
    default?: new (options: Record<string, unknown>) => unknown
  }
  const StoreClass =
    storeModule.default ??
    (storeModule as unknown as new (options: Record<string, unknown>) => unknown)
  return new StoreClass({
    name: 'audit-log',
    defaults: { records: [] }
  }) as AuditStoreBackend
}
