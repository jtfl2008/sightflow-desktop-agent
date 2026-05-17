import { createHash } from 'node:crypto'
import type {
  VisionEvalReportDetail,
  VisionEvalReportListItem,
  VisionFailureCategorySummary,
  VisionImportPrivacyGateResult,
  VisionPrivacyGateCheck,
  VisionRedactionSummary,
  VisionReplayExportRedactedReportRequest,
  VisionReplayExportResult,
  VisionReplaySamplePreview
} from '../core/rpa/vision-replay-ui-types'
import type { VisionReplayStore } from './vision-replay-store'

interface RedactedVisionReplayExportData {
  schemaVersion: 1
  exportedAt: string
  report: Pick<
    VisionEvalReportListItem,
    | 'reportId'
    | 'suiteIds'
    | 'scenario'
    | 'result'
    | 'generatedAt'
    | 'passRate'
    | 'totalSamples'
    | 'totalTasks'
    | 'failedTasks'
    | 'privacyGateStatus'
    | 'schemaStatus'
    | 'hashStatus'
    | 'failureCategoryCounts'
  >
  privacyGate: {
    status: VisionImportPrivacyGateResult['status']
    checks: VisionPrivacyGateCheck[]
  }
  failureCategories: VisionFailureCategorySummary[]
  selectedSample?: {
    sampleId: string
    suiteId: string
    appType: string
    locale: string
    platform: string
    imagePreview:
      | { kind: 'placeholder'; reason: string }
      | {
          kind: 'redacted_image'
          sha256Short: string
          redactionStatus: string
          width: number
          height: number
        }
    metrics: VisionReplaySamplePreview['metrics']
    overlays: VisionReplaySamplePreview['overlays']
    metadata: VisionReplaySamplePreview['metadata']
  }
  redactionSummary: VisionRedactionSummary
}

const DEFAULT_REDACTION_SUMMARY: VisionRedactionSummary = {
  contactNames: 0,
  avatars: 0,
  phones: 0,
  emails: 0,
  addresses: 0,
  qrCodes: 0,
  chatMessages: 0,
  keywords: 0,
  otherPii: 0
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE_PATTERN = /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3,4}\)?[-.\s]?){2,3}\d{3,4}/g
const SECRET_PATTERN =
  /(sk-[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]+|(?:api[-_]?key|token|secret|password)[:=]\s*[A-Za-z0-9._-]+)/gi
const PATH_PATTERN = /(?:[A-Za-z]:\\|\/(?:Users|home|workspace|tmp|var|private)\/)[^\s"'`),]+/g
const IMAGE_DATA_URI_PATTERN = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/gi
const LONG_BASE64_PATTERN = /\b[A-Za-z0-9+/]{2000,}={0,2}\b/g

export async function exportRedactedVisionReplayReport(
  store: VisionReplayStore,
  request: VisionReplayExportRedactedReportRequest,
  now: () => Date = () => new Date()
): Promise<VisionReplayExportResult> {
  const detail = await store.openReport(request.reportId)
  if (detail.privacyGate.status === 'blocked') {
    throw new Error(`vision replay export blocked: ${blockedReason(detail.privacyGate)}`)
  }

  const baseSummary = {
    ...DEFAULT_REDACTION_SUMMARY,
    ...detail.privacyGate.redactionSummary
  }
  const data = buildExportData(detail, request.includeFailureDetails, baseSummary, now)
  const sanitized = sanitizeForExport(data, { ...baseSummary })
  const content =
    request.format === 'json'
      ? `${JSON.stringify(sanitized.value, null, 2)}\n`
      : renderMarkdown(sanitized.value)

  return {
    success: true,
    exportId: createExportId(detail.report.reportId, request.format, now()),
    fileName: `vision-replay-${safeFileName(detail.report.reportId)}.${request.format === 'json' ? 'json' : 'md'}`,
    content,
    redactionSummary: sanitized.redactionSummary
  }
}

export function sanitizeForExport<T>(
  value: T,
  redactionSummary: VisionRedactionSummary = { ...DEFAULT_REDACTION_SUMMARY }
): { value: T; redactionSummary: VisionRedactionSummary } {
  return {
    value: sanitizeValue(value, redactionSummary) as T,
    redactionSummary
  }
}

function buildExportData(
  detail: VisionEvalReportDetail,
  includeFailureDetails: boolean,
  redactionSummary: VisionRedactionSummary,
  now: () => Date
): RedactedVisionReplayExportData {
  return {
    schemaVersion: 1,
    exportedAt: now().toISOString(),
    report: {
      reportId: detail.report.reportId,
      suiteIds: detail.report.suiteIds,
      scenario: detail.report.scenario,
      result: detail.report.result,
      generatedAt: detail.report.generatedAt,
      passRate: detail.report.passRate,
      totalSamples: detail.report.totalSamples,
      totalTasks: detail.report.totalTasks,
      failedTasks: detail.report.failedTasks,
      privacyGateStatus: detail.report.privacyGateStatus,
      schemaStatus: detail.report.schemaStatus,
      hashStatus: detail.report.hashStatus,
      failureCategoryCounts: detail.report.failureCategoryCounts
    },
    privacyGate: {
      status: detail.privacyGate.status,
      checks: detail.privacyGate.checks.map((check) => ({
        id: check.id,
        label: check.label,
        status: check.status,
        reason: check.reason
      }))
    },
    failureCategories: includeFailureDetails ? detail.failureCategories : [],
    selectedSample: detail.selectedSample ? safeSample(detail.selectedSample) : undefined,
    redactionSummary
  }
}

function safeSample(sample: VisionReplaySamplePreview): RedactedVisionReplayExportData['selectedSample'] {
  return {
    sampleId: sample.sampleId,
    suiteId: sample.suiteId,
    appType: sample.appType,
    locale: sample.locale,
    platform: sample.platform,
    imagePreview:
      sample.imagePreview.kind === 'placeholder'
        ? { kind: 'placeholder', reason: sample.imagePreview.reason }
        : {
            kind: 'redacted_image',
            sha256Short: sample.imagePreview.sha256Short,
            redactionStatus: sample.imagePreview.redactionStatus,
            width: sample.imagePreview.width,
            height: sample.imagePreview.height
          },
    metrics: sample.metrics,
    overlays: sample.overlays,
    metadata: sample.metadata
  }
}

function sanitizeValue(value: unknown, summary: VisionRedactionSummary, depth = 0): unknown {
  if (depth > 12) return '[REDACTED_MAX_DEPTH]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeString(value, summary)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, summary, depth + 1))
  if (typeof value !== 'object') return String(value)

  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenKey(key)) {
      out[key] = '[REDACTED]'
      increment(summary, key)
    } else {
      out[key] = sanitizeValue(child, summary, depth + 1)
    }
  }
  return out
}

function sanitizeString(value: string, summary: VisionRedactionSummary): string {
  return value
    .replace(IMAGE_DATA_URI_PATTERN, () => {
      summary.avatars += 1
      return '[REDACTED_IMAGE_BASE64]'
    })
    .replace(LONG_BASE64_PATTERN, () => {
      summary.otherPii += 1
      return '[REDACTED_BASE64]'
    })
    .replace(EMAIL_PATTERN, () => {
      summary.emails += 1
      return '[REDACTED_EMAIL]'
    })
    .replace(PHONE_PATTERN, () => {
      summary.phones += 1
      return '[REDACTED_PHONE]'
    })
    .replace(SECRET_PATTERN, () => {
      summary.otherPii += 1
      return '[REDACTED_SECRET]'
    })
    .replace(PATH_PATTERN, () => {
      summary.otherPii += 1
      return '[REDACTED_PATH]'
    })
}

function isForbiddenKey(key: string): boolean {
  return /(raw|full).*screenshot|screenshot.*(raw|full)|base64|imageBytes|fullChat|chatTranscript|contactName|displayName|avatar|qrCode|token|secret|apiKey|password|absolutePath|filePath/i.test(
    key
  )
}

function increment(summary: VisionRedactionSummary, key: string): void {
  if (/avatar/i.test(key)) summary.avatars += 1
  else if (/qr/i.test(key)) summary.qrCodes += 1
  else if (/chat/i.test(key)) summary.chatMessages += 1
  else if (/contact|displayName/i.test(key)) summary.contactNames += 1
  else summary.otherPii += 1
}

function renderMarkdown(data: RedactedVisionReplayExportData): string {
  const lines = [
    '# Vision Replay Redacted Export',
    '',
    `- Report ID: ${data.report.reportId}`,
    `- Result: ${data.report.result}`,
    `- Generated at: ${data.report.generatedAt}`,
    `- Exported at: ${data.exportedAt}`,
    `- Pass rate: ${data.report.passRate}`,
    `- Privacy gate: ${data.privacyGate.status}`,
    `- Schema status: ${data.report.schemaStatus}`,
    `- Hash status: ${data.report.hashStatus}`,
    '',
    '## Suites',
    '',
    ...data.report.suiteIds.map((suiteId) => `- ${suiteId}`),
    '',
    '## Redaction Summary',
    '',
    ...Object.entries(data.redactionSummary).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Privacy Checks',
    '',
    ...data.privacyGate.checks.map(
      (check) => `- ${check.id}: ${check.status}${check.reason ? ` (${check.reason})` : ''}`
    ),
    '',
    '## Failure Categories',
    '',
    ...(data.failureCategories.length
      ? data.failureCategories.map((item) => `- ${item.category}: ${item.count} ${item.ownerHint}`)
      : ['- none exported']),
    '',
    '## Selected Sample',
    '',
    data.selectedSample
      ? `- ${data.selectedSample.suiteId}/${data.selectedSample.sampleId}`
      : '- none',
    '',
    '```json',
    JSON.stringify(
      {
        metrics: data.selectedSample?.metrics ?? [],
        overlays: data.selectedSample?.overlays ?? [],
        imagePreview: data.selectedSample?.imagePreview,
        failureCategoryCounts: data.report.failureCategoryCounts
      },
      null,
      2
    ),
    '```',
    ''
  ]
  return `${lines.join('\n')}\n`
}

function blockedReason(gate: VisionImportPrivacyGateResult): string {
  return gate.checks.find((check) => check.status === 'blocked')?.reason ?? 'privacy gate blocked'
}

function createExportId(reportId: string, format: string, now: Date): string {
  return createHash('sha256')
    .update(`${reportId}:${format}:${now.toISOString()}`)
    .digest('hex')
    .slice(0, 24)
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'report'
}
