export type DiagnosticsSource = 'runtime' | 'debug_console' | 'vision_eval' | 'workflow_preview'

export type DiagnosticsFinalAction =
  | 'draft_created'
  | 'sent'
  | 'skipped'
  | 'blocked'
  | 'manual_takeover'
  | 'provider_error'
  | 'device_error'

export interface DiagnosticsRedactionSummary {
  status: 'passed' | 'blocked'
  blockedTypes: string[]
  omittedFieldPaths: string[]
  unknownFieldCount: number
  checkedAt: string
}

export interface DiagnosticsTimelineNode {
  capability: string
  source: DiagnosticsSource
  status: string
  summary: string
  detail: Record<string, unknown>
  omittedReason?: string
  errorCode?: string
  occurredAt?: string
}

export interface DiagnosticsRecordView {
  recordId: string
  source: DiagnosticsSource
  sourcePartitionId: string
  runId?: string
  draftId?: string
  contactHash?: string
  appType?: string
  finalAction?: DiagnosticsFinalAction
  topErrorCode?: string
  primaryIntentId?: string
  routeAction?: string
  createdAt: string
  timeline: DiagnosticsTimelineNode[]
  redaction: DiagnosticsRedactionSummary
  relatedSources: Array<{ source: DiagnosticsSource; count: number; topErrorCode?: string; createdAt?: string }>
}

export type DiagnosticsQueryResponse =
  | { ok: true; records: DiagnosticsRecordView[]; total: number }
  | { ok: false; errorCode: string; message: string }

export type DiagnosticsExportResponse =
  | { ok: true; exportId: string; fileName: string; content: string; redaction: DiagnosticsRedactionSummary }
  | { ok: false; errorCode: string; blockedTypes: string[]; omittedFieldPaths: string[] }
