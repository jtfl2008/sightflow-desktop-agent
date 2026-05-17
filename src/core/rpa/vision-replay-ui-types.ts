import type { ScreenRect } from './types'
import type { VisionFailureCategory } from './vision-eval-types'

export type VisionPrivacyGateStatus = 'passed' | 'warning' | 'blocked'
export type VisionPrivacyGateCheckStatus = VisionPrivacyGateStatus
export type VisionSchemaStatus = 'ok' | 'invalid'
export type VisionHashStatus = 'ok' | 'mismatch' | 'unknown'

export interface VisionReplaySettings {
  localOnly: true
  retentionDays: number
  sampleRoots: VisionSampleRoot[]
  allowRawPreview: false
  allowFullScreenshotExport: false
  requireConsentForUserSamples: true
}

export interface VisionSampleRoot {
  rootId: string
  kind: 'repo_fixture' | 'user_data_redacted'
  absolutePath: string
  writable: boolean
}

export interface VisionEvalReportListItem {
  reportId: string
  suiteIds: string[]
  scenario: string
  result: 'passed' | 'failed' | 'warning' | 'blocked'
  generatedAt: string
  passRate: number
  totalSamples: number
  totalTasks: number
  failedTasks: number
  privacyGateStatus: VisionPrivacyGateStatus
  schemaStatus: VisionSchemaStatus
  hashStatus: VisionHashStatus
  failureCategoryCounts: Record<VisionFailureCategory, number>
}

export interface VisionEvalReportDetail {
  report: VisionEvalReportListItem
  privacyGate: VisionImportPrivacyGateResult
  selectedSample?: VisionReplaySamplePreview
  failureCategories: VisionFailureCategorySummary[]
  exportAvailability: {
    markdown: boolean
    json: boolean
    blockedReason?: string
  }
}

export interface VisionReplayListReportsRequest {
  query?: string
  result?: VisionEvalReportListItem['result']
  category?: VisionFailureCategory
  limit?: number
  offset?: number
}

export interface VisionReplayListReportsResponse {
  success: true
  reports: VisionEvalReportListItem[]
  total: number
}

export interface VisionReplayOpenReportRequest {
  reportId: string
  sampleId?: string
}

export interface VisionReplayOpenReportResponse {
  success: true
  detail: VisionEvalReportDetail
}

export interface VisionReplayListSamplesRequest {
  suiteId?: string
  reportId?: string
  category?: VisionFailureCategory
}

export interface VisionReplayListSamplesResponse {
  success: true
  samples: VisionReplaySamplePreview[]
}

export interface VisionReplayRunPrivacyGateRequest {
  sourceKind: 'report' | 'suite' | 'sample'
  reportId?: string
  suitePathToken?: string
  sampleId?: string
}

export interface VisionReplayRunPrivacyGateResponse {
  success: true
  gate: VisionImportPrivacyGateResult
}

export interface VisionReplayExportRedactedReportRequest {
  reportId: string
  format: 'markdown' | 'json'
  includeFailureDetails: boolean
}

export interface VisionReplayExportRedactedReportResponse {
  success: true
  export: VisionReplayExportResult
}

export interface VisionReplaySamplePreview {
  sampleId: string
  suiteId: string
  title: string
  appType: string
  locale: string
  platform: string
  imagePreview: VisionSafeImagePreview
  overlays: VisionOverlayAnnotation[]
  metrics: VisionSampleMetric[]
  metadata: VisionSafeSampleMetadata
}

export type VisionSafeImagePreview =
  | {
      kind: 'redacted_image'
      objectUrlToken: string
      width: number
      height: number
      sha256Short: string
      redactionStatus: 'synthetic' | 'redacted' | 'hash_only'
    }
  | {
      kind: 'placeholder'
      reason:
        | 'privacy_blocked'
        | 'sample_hash_mismatch'
        | 'schema_invalid'
        | 'sample_file_missing'
        | 'hash_only'
    }

export type VisionOverlayAnnotation =
  | {
      type: 'bbox'
      target: string
      expected?: NormalizedBbox
      actual?: NormalizedBbox
      expectedScreen?: ScreenRect
      actualScreen?: ScreenRect
      iou?: number
      centerDistancePx?: number
      status: 'passed' | 'failed' | 'missing'
    }
  | {
      type: 'point'
      target: string
      expected?: ScreenPoint
      actual?: ScreenPoint
      distancePx?: number
      status: 'passed' | 'failed' | 'missing'
    }

export type NormalizedBbox = [number, number, number, number]

export interface ScreenPoint {
  x: number
  y: number
}

export interface VisionSampleMetric {
  id: string
  label: string
  value: number
  unit?: string
  threshold?: number
  status: 'passed' | 'failed' | 'warning'
}

export interface VisionSafeSampleMetadata {
  tags: string[]
  createdAt: string
  source: 'synthetic' | 'manual_redacted' | 'user_opt_in_redacted' | 'unknown'
  redactionStatus: 'synthetic' | 'redacted' | 'hash_only'
  sha256Short?: string
}

export interface VisionFailureCategorySummary {
  category: VisionFailureCategory
  count: number
  ownerHint: '@dev' | '@cv' | '@ui' | '@qa'
}

export interface VisionImportPrivacyGateResult {
  status: VisionPrivacyGateStatus
  checks: VisionPrivacyGateCheck[]
  redactionSummary: VisionRedactionSummary
}

export interface VisionPrivacyGateCheck {
  id:
    | 'schema_ok'
    | 'hash_ok'
    | 'consent_required'
    | 'redaction_passed'
    | 'base64_audit_scan'
    | 'raw_full_screenshot_blocked'
    | 'retention_days'
    | 'repo_fixture_raw_path'
  label: string
  status: VisionPrivacyGateCheckStatus
  reason?: string
}

export interface VisionRedactionSummary {
  contactNames: number
  avatars: number
  phones: number
  emails: number
  addresses: number
  qrCodes: number
  chatMessages: number
  keywords: number
  otherPii: number
}

export interface VisionReplayExportResult {
  success: true
  exportId: string
  fileName: string
  content: string
  redactionSummary: VisionRedactionSummary
}
