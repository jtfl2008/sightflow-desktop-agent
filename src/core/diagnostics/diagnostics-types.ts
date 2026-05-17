export type DiagnosticsSource =
  | 'runtime'
  | 'debug_console'
  | 'vision_eval'
  | 'workflow_preview'
  | 'provider_lifecycle'

export type DiagnosticsTimeRange = 'last_24h' | 'last_7d' | { from: string; to: string }

export interface DiagnosticsQuery {
  source: DiagnosticsSource
  runId?: string
  draftId?: string
  contactHash?: string
  timeRange?: DiagnosticsTimeRange
  includeRelatedSources?: boolean
  limit?: number
  offset?: number
}

export type DiagnosticsQueryErrorCode =
  | 'empty_query'
  | 'invalid_source'
  | 'invalid_run_id'
  | 'invalid_draft_id'
  | 'plaintext_contact_rejected'
  | 'invalid_contact_hash'

export type DiagnosticsFinalAction =
  | 'draft_created'
  | 'sent'
  | 'skipped'
  | 'blocked'
  | 'manual_takeover'
  | 'provider_error'
  | 'device_error'

export type DiagnosticsCapability =
  | 'intent'
  | 'route'
  | 'knowledge'
  | 'customer_memory'
  | 'provider'
  | 'workflow'
  | 'device'
  | 'vision'
  | 'final_action'

export type DiagnosticsNodeStatus =
  | 'ok'
  | 'omitted'
  | 'warning'
  | 'blocked'
  | 'error'
  | 'not_applicable'
  | 'not_recorded'

export type DiagnosticsOmittedReason =
  | 'disabled'
  | 'missing_contact'
  | 'not_found'
  | 'deleted'
  | 'expired'
  | 'not_confirmed'
  | 'sanitized'
  | 'over_budget'
  | 'missing_header'
  | 'contact_not_verified'

export type DiagnosticsNodeDetail =
  | {
      type: 'intent'
      primaryIntentId?: string
      confidence?: number
      fallbackUsed?: boolean
      matchedRuleIds?: string[]
    }
  | {
      type: 'route'
      routeId?: string
      routeAction?: string
      forcedReplyMode?: string
      policyHintIds?: string[]
    }
  | {
      type: 'knowledge'
      matched?: Array<{ id: string; title: string; sourceType: string; score?: number }>
      budgetApplied?: boolean
      omittedCount?: number
    }
  | {
      type: 'customer_memory'
      profileId?: string
      version?: string
      contactKeyHash?: string
      injectedFieldPaths?: string[]
      omittedReason?: DiagnosticsOmittedReason
    }
  | {
      type: 'provider'
      providerId?: string
      version?: string
      trustLevel?: string
      decision?: string
      reason?: string
      errorCode?: string
    }
  | {
      type: 'workflow'
      workflowId?: string
      nodeId?: string
      nodeType?: string
      decision?: string
      fallbackReason?: string
      errorCode?: string
    }
  | {
      type: 'device'
      channelAdapterId?: string
      multiSessionEnabled?: boolean
      currentMode?: string
      verificationState?: string
      errorCode?: string
      degradedReason?: string
    }
  | {
      type: 'vision'
      reportId?: string
      sampleIdHash?: string
      failureClass?: string
      privacyGateStatus?: string
      redactionStatus?: string
      errorCode?: string
    }
  | {
      type: 'final_action'
      finalAction?: DiagnosticsFinalAction
      policyDecision?: string
      reasons?: string[]
    }

export interface DiagnosticsTimelineNode {
  capability: DiagnosticsCapability
  source: DiagnosticsSource
  status: DiagnosticsNodeStatus
  summary: string
  detail: DiagnosticsNodeDetail
  omittedReason?: DiagnosticsOmittedReason
  errorCode?: string
  occurredAt?: string
}

export type DiagnosticsBlockedType = RedactionExportBlockedType
export type DiagnosticsRedactionSummary = RedactionExportSummary

export interface DiagnosticsRelatedSourceSummary {
  source: DiagnosticsSource
  count: number
  topErrorCode?: string
  createdAt?: string
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
  relatedSources: DiagnosticsRelatedSourceSummary[]
}

export interface DiagnosticsSourceRecord {
  source: DiagnosticsSource
  sourceRecordId: string
  raw: Record<string, unknown>
  createdAt: string
}

export interface DiagnosticsSourceAdapter {
  source: DiagnosticsSource
  query(input: NormalizedDiagnosticsQuery): Promise<DiagnosticsSourceRecord[]>
}

export type NormalizedDiagnosticsQuery = DiagnosticsQuery & {
  limit: number
  offset: number
}

export type DiagnosticsQueryResponse =
  | { ok: true; records: DiagnosticsRecordView[]; total: number }
  | { ok: false; errorCode: DiagnosticsQueryErrorCode; message: string }

export type DiagnosticsGetRecordResponse =
  | { ok: true; record: DiagnosticsRecordView }
  | { ok: false; errorCode: 'not_found' | 'invalid_source'; message: string }

export type DiagnosticsExportResponse =
  | {
      ok: true
      exportId: string
      fileName: string
      content: string
      redaction: DiagnosticsRedactionSummary
    }
  | {
      ok: false
      errorCode: 'export_redaction_failed' | 'export_contains_sensitive_field' | 'not_found'
      blockedTypes: DiagnosticsBlockedType[]
      omittedFieldPaths: string[]
    }

export const DIAGNOSTICS_SOURCES: DiagnosticsSource[] = [
  'runtime',
  'debug_console',
  'vision_eval',
  'workflow_preview',
  'provider_lifecycle'
]

export const DIAGNOSTICS_CAPABILITY_ORDER: DiagnosticsCapability[] = [
  'intent',
  'route',
  'knowledge',
  'customer_memory',
  'provider',
  'workflow',
  'device',
  'vision',
  'final_action'
]
import type { RedactionExportBlockedType, RedactionExportSummary } from '../redaction-export-summary'
