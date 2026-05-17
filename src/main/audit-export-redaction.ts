import { AuditExport, AuditRecord } from './audit-types'

export type AuditExportBlockedType =
  | 'raw_screenshot'
  | 'base64'
  | 'full_chat'
  | 'plaintext_contact'
  | 'full_profile'
  | 'provider_config_values'
  | 'webhook_body'
  | 'secrets'
  | 'unknown_nested_object'

export interface AuditExportRedactionSummary {
  status: 'passed' | 'blocked'
  blockedTypes: AuditExportBlockedType[]
  omittedFieldPaths: string[]
  unknownFieldCount: number
  checkedAt: string
}

export interface RedactedAuditExport extends AuditExport {
  redaction: AuditExportRedactionSummary
  blocked: boolean
}

const REDACTED = '[REDACTED]'

const RAW_SCREENSHOT_KEY = /(raw|full).*screenshot|screenshot.*(raw|full)|imageBytes|rawImage|screenshot|image/i
const BASE64_KEY = /base64|dataUrl|data:image/i
const FULL_CHAT_KEY = /fullChat|chatTranscript|ocrText|messageText|pendingText|fullConversation/i
const PLAINTEXT_CONTACT_KEY = /currentContact|contactName|displayName|phone|email|address|avatar|qrCode/i
const FULL_PROFILE_KEY =
  /customerProfile\.fields|profileFields|preferenceNotes|businessContext|doNotMention|lastConfirmedSummary|pendingSuggestion/i
const PROVIDER_CONFIG_KEY =
  /providerConfig|provider\.config|configValues|apiKey|token|secret|password|authorization|cookie|clipboard/i
const WEBHOOK_BODY_KEY = /webhookBody|requestBody|responseBody|headers/i

const DATA_IMAGE_PATTERN = /data:image\//i
const LONG_BASE64_PATTERN = /\b[A-Za-z0-9+/]{200,}={0,2}\b/
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE_PATTERN = /(?:\+\d[\d\s().-]{7,}\d|\b\d{3,4}[-.\s]\d{3,4}[-.\s]\d{3,4}\b)/
const SECRET_VALUE_PATTERN =
  /(Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]+|(?:api[-_]?key|token|secret|password)[:=]\s*[A-Za-z0-9._-]+)/i
const URL_QUERY_SECRET_PATTERN = /https?:\/\/\S+[?&](token|secret|api_key|apikey|key)=/i
const LOCAL_PATH_PATTERN = /(?:\/Users\/|\/home\/|\/workspace\/|[A-Z]:\\)/i

const ALLOWED_NESTED_OBJECT_PATHS = new Set([
  'metadata.artifactHashes',
  'metadata.channelContext',
  'metadata.customerProfile',
  'metadata.customerProfile.sourceSummary',
  'metadata.matchedKnowledge'
])

const ALLOWED_NESTED_OBJECT_PREFIXES = [
  'metadata.artifactHashes.',
  'metadata.channelContext.',
  'metadata.customerProfile.sourceSummary.',
  'metadata.matchedKnowledge.'
]

export function buildRedactedAuditExport(
  value: AuditExport,
  checkedAt: string
): RedactedAuditExport {
  const state: RedactionState = {
    blockedTypes: new Set(),
    omittedFieldPaths: new Set(),
    unknownFieldCount: 0
  }
  const records = value.records.map((record, index) => redactRecord(record, index, state))
  const summary = buildSummary(state, checkedAt)
  const unknownNestedBlocked = summary.unknownFieldCount > 0

  return {
    exportedAt: sanitizeString(value.exportedAt, 'exportedAt', state),
    records: unknownNestedBlocked ? [] : records,
    redaction: summary,
    blocked: unknownNestedBlocked
  }
}

export function formatAuditExportMarkdown(value: RedactedAuditExport): string {
  const lines = [
    '# Audit Log',
    '',
    `Exported at: ${value.exportedAt}`,
    '',
    '## Redaction Summary',
    '',
    `- Status: ${value.redaction.status}`,
    `- Blocked types: ${value.redaction.blockedTypes.join(', ') || 'none'}`,
    `- Omitted field paths: ${value.redaction.omittedFieldPaths.join(', ') || 'none'}`,
    `- Unknown field count: ${value.redaction.unknownFieldCount}`,
    `- Checked at: ${value.redaction.checkedAt}`,
    ''
  ]

  if (value.blocked) {
    lines.push('Export blocked: unknown nested fields were found outside the audit export allowlist.', '')
    return `${lines.join('\n')}\n`
  }

  for (const record of value.records) {
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

interface RedactionState {
  blockedTypes: Set<AuditExportBlockedType>
  omittedFieldPaths: Set<string>
  unknownFieldCount: number
}

function redactRecord(record: AuditRecord, index: number, state: RedactionState): AuditRecord {
  const path = `records[${index}]`
  return {
    id: sanitizeString(record.id, `${path}.id`, state),
    category: record.category,
    action: sanitizeString(record.action, `${path}.action`, state),
    severity: record.severity,
    message:
      record.message === undefined
        ? undefined
        : sanitizeString(record.message, `${path}.message`, state),
    metadata: redactMetadata(record.metadata, `${path}.metadata`, state),
    occurredAt: sanitizeString(record.occurredAt, `${path}.occurredAt`, state)
  }
}

function redactMetadata(
  value: Record<string, unknown>,
  recordPath: string,
  state: RedactionState
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const path = `${recordPath}.${key}`
    const normalizedPath = `metadata.${key}`
    const blockedType = blockedTypeForPath(normalizedPath)
    if (blockedType) {
      addBlocked(state, blockedType, path)
      continue
    }
    const redacted = redactValue(child, path, normalizedPath, state)
    if (redacted !== undefined) out[key] = redacted
  }
  return out
}

function redactValue(
  value: unknown,
  recordPath: string,
  normalizedPath: string,
  state: RedactionState
): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeString(value, recordPath, state)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value
      .map((item, index) => redactValue(item, `${recordPath}[${index}]`, `${normalizedPath}.`, state))
      .filter((item) => item !== undefined)
  }
  if (!isPlainRecord(value)) return sanitizeString(String(value), recordPath, state)

  if (!isAllowedNestedObjectPath(normalizedPath)) {
    state.unknownFieldCount += 1
    addBlocked(state, 'unknown_nested_object', recordPath)
    return undefined
  }

  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const childRecordPath = `${recordPath}.${key}`
    const childNormalizedPath = `${normalizedPath}.${key}`
    const blockedType = blockedTypeForPath(childNormalizedPath)
    if (blockedType) {
      addBlocked(state, blockedType, childRecordPath)
      continue
    }
    const redacted = redactValue(child, childRecordPath, childNormalizedPath, state)
    if (redacted !== undefined) out[key] = redacted
  }
  return out
}

function sanitizeString(value: string, path: string, state: RedactionState): string {
  const types = blockedTypesForString(value)
  if (types.length === 0) return value
  for (const type of types) addBlocked(state, type, path)
  return REDACTED
}

function blockedTypeForPath(path: string): AuditExportBlockedType | null {
  if (RAW_SCREENSHOT_KEY.test(path)) return 'raw_screenshot'
  if (BASE64_KEY.test(path)) return 'base64'
  if (FULL_CHAT_KEY.test(path)) return 'full_chat'
  if (PLAINTEXT_CONTACT_KEY.test(path)) return 'plaintext_contact'
  if (FULL_PROFILE_KEY.test(path)) return 'full_profile'
  if (PROVIDER_CONFIG_KEY.test(path)) return 'provider_config_values'
  if (WEBHOOK_BODY_KEY.test(path)) return 'webhook_body'
  return null
}

function blockedTypesForString(value: string): AuditExportBlockedType[] {
  const out = new Set<AuditExportBlockedType>()
  if (DATA_IMAGE_PATTERN.test(value) || LONG_BASE64_PATTERN.test(value)) out.add('base64')
  if (EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value)) out.add('plaintext_contact')
  if (SECRET_VALUE_PATTERN.test(value) || URL_QUERY_SECRET_PATTERN.test(value)) out.add('secrets')
  if (/full chat|chat transcript/i.test(value)) out.add('full_chat')
  if (LOCAL_PATH_PATTERN.test(value)) out.add('secrets')
  return Array.from(out)
}

function isAllowedNestedObjectPath(path: string): boolean {
  return (
    ALLOWED_NESTED_OBJECT_PATHS.has(path) ||
    ALLOWED_NESTED_OBJECT_PREFIXES.some((prefix) => path.startsWith(prefix))
  )
}

function addBlocked(
  state: RedactionState,
  type: AuditExportBlockedType,
  path: string
): void {
  state.blockedTypes.add(type)
  state.omittedFieldPaths.add(path)
}

function buildSummary(state: RedactionState, checkedAt: string): AuditExportRedactionSummary {
  const blockedTypes = Array.from(state.blockedTypes).sort()
  return {
    status: blockedTypes.length > 0 || state.unknownFieldCount > 0 ? 'blocked' : 'passed',
    blockedTypes,
    omittedFieldPaths: Array.from(state.omittedFieldPaths).sort(),
    unknownFieldCount: state.unknownFieldCount,
    checkedAt
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
