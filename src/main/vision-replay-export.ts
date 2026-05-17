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
import type { RedactionExportBlockedType, RedactionExportSummary } from '../core/redaction-export-summary'
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
  redactionExportSummary: RedactionExportSummary
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

const ALLOWED_NESTED_OBJECT_PATHS = new Set([
  '',
  'report',
  'report.failureCategoryCounts',
  'privacyGate',
  'privacyGate.checks[]',
  'failureCategories[]',
  'selectedSample',
  'selectedSample.imagePreview',
  'selectedSample.metrics[]',
  'selectedSample.overlays[]',
  'selectedSample.metadata',
  'redactionSummary',
  'redactionExportSummary'
])

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
  const sanitized = sanitizeForExport(data, { ...baseSummary }, now)
  const content =
    request.format === 'json'
      ? `${JSON.stringify(sanitized.value, null, 2)}\n`
      : renderMarkdown(sanitized.value)

  return {
    success: true,
    exportId: createExportId(detail.report.reportId, request.format, now()),
    fileName: `vision-replay-${safeFileName(detail.report.reportId)}.${request.format === 'json' ? 'json' : 'md'}`,
    content,
    redactionSummary: sanitized.redactionSummary,
    redactionExportSummary: sanitized.redactionExportSummary
  }
}

export function sanitizeForExport<T>(
  value: T,
  redactionSummary: VisionRedactionSummary = { ...DEFAULT_REDACTION_SUMMARY },
  now: () => Date = () => new Date()
): { value: T; redactionSummary: VisionRedactionSummary; redactionExportSummary: RedactionExportSummary } {
  const state: VisionExportRedactionState = {
    redactionSummary,
    blockedTypes: new Set(),
    omittedFieldPaths: new Set(),
    unknownFieldCount: 0
  }
  const sanitizedValue = sanitizeValue(value, state, '', 0) as T
  const redactionExportSummary = buildVisionExportSummary(state, now)
  if (isRecord(sanitizedValue)) {
    ;(sanitizedValue as Record<string, unknown>).redactionExportSummary = redactionExportSummary
  }
  return {
    value: sanitizedValue,
    redactionSummary,
    redactionExportSummary
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
    redactionSummary,
    redactionExportSummary: emptyVisionExportSummary(now)
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

interface VisionExportRedactionState {
  redactionSummary: VisionRedactionSummary
  blockedTypes: Set<RedactionExportBlockedType>
  omittedFieldPaths: Set<string>
  unknownFieldCount: number
}

function sanitizeValue(
  value: unknown,
  state: VisionExportRedactionState,
  path: string,
  depth = 0
): unknown {
  if (depth > 12) return '[REDACTED_MAX_DEPTH]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeString(value, state, path)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, state, `${path}[${index}]`, depth + 1))
  }
  if (typeof value !== 'object') return String(value)

  if (!ALLOWED_NESTED_OBJECT_PATHS.has(normalizeObjectPath(path))) {
    state.unknownFieldCount += 1
    addBlocked(state, 'unknown_nested_object', path || '$')
    return undefined
  }

  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key
    if (isForbiddenKey(key)) {
      addBlocked(state, blockedTypeForKey(key), childPath)
      increment(state.redactionSummary, key)
    } else {
      const sanitized = sanitizeValue(child, state, childPath, depth + 1)
      if (sanitized !== undefined) out[key] = sanitized
    }
  }
  return out
}

function sanitizeString(value: string, state: VisionExportRedactionState, path: string): string {
  return value
    .replace(IMAGE_DATA_URI_PATTERN, () => {
      state.redactionSummary.avatars += 1
      addBlocked(state, 'base64', path)
      return '[REDACTED_IMAGE_BASE64]'
    })
    .replace(LONG_BASE64_PATTERN, () => {
      state.redactionSummary.otherPii += 1
      addBlocked(state, 'base64', path)
      return '[REDACTED_BASE64]'
    })
    .replace(EMAIL_PATTERN, () => {
      state.redactionSummary.emails += 1
      addBlocked(state, 'plaintext_contact', path)
      return '[REDACTED_EMAIL]'
    })
    .replace(PHONE_PATTERN, () => {
      state.redactionSummary.phones += 1
      addBlocked(state, 'plaintext_contact', path)
      return '[REDACTED_PHONE]'
    })
    .replace(SECRET_PATTERN, () => {
      state.redactionSummary.otherPii += 1
      addBlocked(state, 'secrets', path)
      return '[REDACTED_SECRET]'
    })
    .replace(PATH_PATTERN, () => {
      state.redactionSummary.otherPii += 1
      addBlocked(state, 'secrets', path)
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

function blockedTypeForKey(key: string): RedactionExportBlockedType {
  if (/(raw|full).*screenshot|screenshot.*(raw|full)|imageBytes/i.test(key)) return 'raw_screenshot'
  if (/base64/i.test(key)) return 'base64'
  if (/fullChat|chatTranscript/i.test(key)) return 'full_chat'
  if (/contactName|displayName|avatar|qrCode/i.test(key)) return 'plaintext_contact'
  if (/token|secret|apiKey|password/i.test(key)) return 'secrets'
  return 'secrets'
}

function addBlocked(
  state: VisionExportRedactionState,
  type: RedactionExportBlockedType,
  path: string
): void {
  state.blockedTypes.add(type)
  state.omittedFieldPaths.add(path)
}

function buildVisionExportSummary(
  state: VisionExportRedactionState,
  now: () => Date
): RedactionExportSummary {
  const blockedTypes = Array.from(state.blockedTypes).sort()
  return {
    status: blockedTypes.length > 0 || state.unknownFieldCount > 0 ? 'blocked' : 'passed',
    blockedTypes,
    omittedFieldPaths: Array.from(state.omittedFieldPaths).sort(),
    unknownFieldCount: state.unknownFieldCount,
    checkedAt: now().toISOString()
  }
}

function emptyVisionExportSummary(now: () => Date): RedactionExportSummary {
  return {
    status: 'passed',
    blockedTypes: [],
    omittedFieldPaths: [],
    unknownFieldCount: 0,
    checkedAt: now().toISOString()
  }
}

function normalizeObjectPath(path: string): string {
  return path.replace(/\[\d+\]/g, '[]')
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
