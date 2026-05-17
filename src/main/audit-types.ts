export type AuditCategory =
  | 'engine'
  | 'layout'
  | 'provider'
  | 'draft'
  | 'policy'
  | 'intent'
  | 'message'
  | 'error'

export type AuditSeverity = 'debug' | 'info' | 'warn' | 'error'

export interface AuditEventInput {
  category: AuditCategory
  action: string
  severity?: AuditSeverity
  message?: string
  metadata?: Record<string, unknown>
  occurredAt?: string
}

export interface AuditRecord {
  id: string
  category: AuditCategory
  action: string
  severity: AuditSeverity
  message?: string
  metadata: Record<string, unknown>
  occurredAt: string
}

export interface AuditExport {
  exportedAt: string
  records: AuditRecord[]
}
