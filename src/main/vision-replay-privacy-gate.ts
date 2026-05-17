import * as path from 'node:path'
import type {
  VisionReplaySample,
  VisionReplaySuiteManifest,
  VisionSamplePrivacy
} from '../core/rpa/vision-eval-types'
import type {
  VisionHashStatus,
  VisionImportPrivacyGateResult,
  VisionPrivacyGateCheck,
  VisionRedactionSummary,
  VisionSchemaStatus
} from '../core/rpa/vision-replay-ui-types'

export interface VisionReplayPrivacyGateOptions {
  sourceKind: 'report' | 'suite' | 'sample'
  sampleRootKind?: 'repo_fixture' | 'user_data_redacted'
  repoRoot?: string
  suitePath?: string
  manifest?: VisionReplaySuiteManifest
  privacy?: VisionSamplePrivacy
  samples?: VisionReplaySample[]
  auditContext?: unknown
  retentionDays?: number
  consentId?: string
  schemaStatus?: VisionSchemaStatus
  hashStatus?: VisionHashStatus
  redactionSummary?: Partial<VisionRedactionSummary>
}

const MAX_RETENTION_DAYS = 30
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

const IMAGE_DATA_URI_PATTERN = /data:image\/[a-z0-9.+-]+;base64,/i
const IMAGE_BASE64_KEY_PATTERN =
  /(image|screenshot|avatar|qr|bitmap|png|jpe?g).*base64|base64.*(image|screenshot|avatar|qr|bitmap|png|jpe?g)/i
const LONG_BASE64_PATTERN = /^[A-Za-z0-9+/=\r\n]+$/
const SUSPICIOUS_REPO_RAW_PATH_PATTERN =
  /(^|[/\\])(?:raw|raw_opt_in|original|unredacted|full[-_ ]?screenshot|full[-_ ]?screen)(?:[/\\.]|$)/i

export function runVisionReplayPrivacyGate(
  options: VisionReplayPrivacyGateOptions
): VisionImportPrivacyGateResult {
  const privacy = options.manifest?.privacy ?? options.privacy
  const samples = options.manifest?.samples ?? options.samples ?? []
  const schemaStatus = options.schemaStatus ?? 'ok'
  const hashStatus = options.hashStatus ?? 'ok'
  const checks: VisionPrivacyGateCheck[] = [
    schemaCheck(schemaStatus),
    hashCheck(hashStatus),
    consentCheck(privacy, options.consentId),
    redactionCheck(privacy),
    auditBase64Check([options.auditContext, ...samples.map((sample) => sample.auditContext)]),
    rawFullScreenshotCheck(privacy),
    retentionCheck(options.retentionDays ?? privacy?.retentionDays),
    repoRawPathCheck({
      sampleRootKind: options.sampleRootKind,
      repoRoot: options.repoRoot,
      suitePath: options.suitePath,
      samples
    })
  ]

  return {
    status: summarizeChecks(checks),
    checks,
    redactionSummary: {
      ...DEFAULT_REDACTION_SUMMARY,
      ...options.redactionSummary
    }
  }
}

export function hasBlockedVisionReplayGate(result: VisionImportPrivacyGateResult): boolean {
  return result.status === 'blocked' || result.checks.some((check) => check.status === 'blocked')
}

function schemaCheck(schemaStatus: VisionSchemaStatus): VisionPrivacyGateCheck {
  return {
    id: 'schema_ok',
    label: 'Schema valid',
    status: schemaStatus === 'invalid' ? 'blocked' : 'passed',
    reason: schemaStatus === 'invalid' ? 'report or suite schema is invalid' : undefined
  }
}

function hashCheck(hashStatus: VisionHashStatus): VisionPrivacyGateCheck {
  return {
    id: 'hash_ok',
    label: 'Sample hash valid',
    status: hashStatus === 'mismatch' ? 'blocked' : hashStatus === 'unknown' ? 'warning' : 'passed',
    reason:
      hashStatus === 'mismatch'
        ? 'sample image hash mismatch'
        : hashStatus === 'unknown'
          ? 'sample image hash was not available'
          : undefined
  }
}

function consentCheck(
  privacy?: VisionSamplePrivacy,
  overrideConsentId?: string
): VisionPrivacyGateCheck {
  const consentId = cleanString(overrideConsentId ?? privacy?.consentId)
  const requiresConsent =
    privacy?.consentRequired === true || privacy?.storesFullScreenshot === true
  return {
    id: 'consent_required',
    label: 'Consent present when required',
    status: requiresConsent && !consentId ? 'blocked' : 'passed',
    reason:
      requiresConsent && !consentId
        ? 'missing consentId for consent-required or full screenshot sample'
        : undefined
  }
}

function redactionCheck(privacy?: VisionSamplePrivacy): VisionPrivacyGateCheck {
  const status = privacy?.redactionStatus
  const blocked = status === 'raw_opt_in' && !cleanString(privacy?.consentId)
  return {
    id: 'redaction_passed',
    label: 'Redaction safe',
    status: blocked
      ? 'blocked'
      : status === 'hash_only' || status === 'raw_opt_in'
        ? 'warning'
        : 'passed',
    reason: blocked
      ? 'raw opt-in sample is missing consentId'
      : status === 'raw_opt_in'
        ? 'raw opt-in sample must use placeholder or redacted preview only'
        : status === 'hash_only'
          ? 'hash-only sample has no safe preview image'
          : undefined
  }
}

function rawFullScreenshotCheck(privacy?: VisionSamplePrivacy): VisionPrivacyGateCheck {
  const blocked = privacy?.storesFullScreenshot === true && !cleanString(privacy.consentId)
  return {
    id: 'raw_full_screenshot_blocked',
    label: 'Raw full screenshot blocked',
    status: blocked ? 'blocked' : 'passed',
    reason: blocked ? 'storesFullScreenshot requires explicit consentId' : undefined
  }
}

function retentionCheck(retentionDays?: number): VisionPrivacyGateCheck {
  const blocked = typeof retentionDays === 'number' && retentionDays > MAX_RETENTION_DAYS
  return {
    id: 'retention_days',
    label: 'Retention <= 30 days',
    status: blocked ? 'blocked' : 'passed',
    reason: blocked ? `retentionDays ${retentionDays} exceeds ${MAX_RETENTION_DAYS}` : undefined
  }
}

function auditBase64Check(values: unknown[]): VisionPrivacyGateCheck {
  const finding = findBase64AuditFinding(values)
  return {
    id: 'base64_audit_scan',
    label: 'Audit has no base64 image payload',
    status: finding ? 'blocked' : 'passed',
    reason: finding
  }
}

function repoRawPathCheck(input: {
  sampleRootKind?: 'repo_fixture' | 'user_data_redacted'
  repoRoot?: string
  suitePath?: string
  samples: VisionReplaySample[]
}): VisionPrivacyGateCheck {
  const isRepoFixture =
    input.sampleRootKind === 'repo_fixture' ||
    (Boolean(input.repoRoot) &&
      Boolean(input.suitePath) &&
      isInsidePath(input.repoRoot!, input.suitePath!))
  const rawPath = isRepoFixture
    ? input.samples
        .map((sample) => sample.image.path)
        .find((item) => isRepoRawPath(item, input.repoRoot))
    : undefined
  return {
    id: 'repo_fixture_raw_path',
    label: 'Repository fixture does not point at raw screenshots',
    status: rawPath ? 'blocked' : 'passed',
    reason: rawPath
      ? `repo fixture references raw screenshot path: ${path.basename(rawPath)}`
      : undefined
  }
}

function summarizeChecks(checks: VisionPrivacyGateCheck[]): 'passed' | 'warning' | 'blocked' {
  if (checks.some((check) => check.status === 'blocked')) return 'blocked'
  if (checks.some((check) => check.status === 'warning')) return 'warning'
  return 'passed'
}

function findBase64AuditFinding(values: unknown[]): string | undefined {
  for (const value of values) {
    const finding = scanValueForBase64Audit(value)
    if (finding) return finding
  }
  return undefined
}

function scanValueForBase64Audit(
  value: unknown,
  keyPath: string[] = [],
  depth = 0
): string | undefined {
  if (depth > 12 || value === null || value === undefined) return undefined
  if (typeof value === 'string') {
    if (IMAGE_DATA_URI_PATTERN.test(value))
      return `audit field ${keyPath.join('.') || 'value'} contains data:image payload`
    if (IMAGE_BASE64_KEY_PATTERN.test(keyPath.join('.')) && looksLikeBase64Payload(value)) {
      return `audit field ${keyPath.join('.')} contains base64 image payload`
    }
    if (value.length > 2000 && looksLikeBase64Payload(value)) {
      return `audit field ${keyPath.join('.') || 'value'} contains long base64-like payload`
    }
    return undefined
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const finding = scanValueForBase64Audit(value[index], [...keyPath, String(index)], depth + 1)
      if (finding) return finding
    }
    return undefined
  }
  if (typeof value !== 'object') return undefined
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const finding = scanValueForBase64Audit(child, [...keyPath, key], depth + 1)
    if (finding) return finding
  }
  return undefined
}

function looksLikeBase64Payload(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return compact.length > 2000 && compact.length % 4 === 0 && LONG_BASE64_PATTERN.test(compact)
}

function isRepoRawPath(candidate?: string, repoRoot?: string): boolean {
  if (!candidate) return false
  if (SUSPICIOUS_REPO_RAW_PATH_PATTERN.test(candidate)) return true
  return (
    typeof repoRoot === 'string' && path.isAbsolute(candidate) && isInsidePath(repoRoot, candidate)
  )
}

function isInsidePath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function cleanString(value?: string): string {
  return typeof value === 'string' ? value.trim() : ''
}
