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

export type AuditSource =
  | 'runtime'
  | 'debug_console'
  | 'vision_eval'
  | 'workflow_preview'
  | 'provider_lifecycle'
  | 'recovery_reconciliation'

export interface AuditEventInput {
  category: AuditCategory
  action: string
  source?: AuditSource
  severity?: AuditSeverity
  message?: string
  metadata?: Record<string, unknown>
  occurredAt?: string
}

export interface AuditRecord {
  id: string
  category: AuditCategory
  action: string
  source?: AuditSource
  severity: AuditSeverity
  message?: string
  metadata: Record<string, unknown>
  occurredAt: string
}

export interface AuditExport {
  exportedAt: string
  records: AuditRecord[]
}
