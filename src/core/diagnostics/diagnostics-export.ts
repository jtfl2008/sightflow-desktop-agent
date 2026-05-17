import { createHash } from 'node:crypto'
import { isDiagnosticsContactHash } from './diagnostics-contact-hash'
import { checkDiagnosticsRedaction } from './diagnostics-redaction-checker'
import {
  DiagnosticsExportResponse,
  DiagnosticsRecordView,
  DiagnosticsTimelineNode
} from './diagnostics-types'

const SENSITIVE_CONTENT_PATTERN =
  /(data:image\/|[A-Za-z0-9+/]{200,}={0,2}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+\d[\d\s().-]{7,}\d|\b\d{3,4}[-.\s]\d{3,4}[-.\s]\d{3,4}\b)|Bearer\s+|sk-[A-Za-z0-9_-]+|\/(?:Users|home|workspace|tmp|var|private)\/)/i
const HASH_ASSIGNMENT_PATTERN =
  /['"]?\b(?:contactHash|contactKeyHash|sampleIdHash)\b['"]?\s*[:=]\s*['"]?([A-Za-z0-9_@.+-]{1,128})['"]?/g

export function exportDiagnosticsRecord(
  record: DiagnosticsRecordView,
  format: 'markdown' | 'json',
  now: () => Date = () => new Date()
): DiagnosticsExportResponse {
  if (record.redaction.status === 'blocked' || record.redaction.unknownFieldCount > 0) {
    return blocked(record)
  }
  const unsafeHashPaths = collectUnsafeHashPaths(record)
  if (unsafeHashPaths.length) {
    return {
      ok: false,
      errorCode: 'export_contains_sensitive_field',
      blockedTypes: ['plaintext_contact'],
      omittedFieldPaths: unsafeHashPaths
    }
  }
  const exportData = safeExportData(record)
  const redaction = checkDiagnosticsRedaction(exportData, { now })
  if (redaction.status === 'blocked' || redaction.unknownFieldCount > 0) {
    return {
      ok: false,
      errorCode: 'export_contains_sensitive_field',
      blockedTypes: redaction.blockedTypes,
      omittedFieldPaths: redaction.omittedFieldPaths
    }
  }
  const content =
    format === 'json' ? `${JSON.stringify(exportData, null, 2)}\n` : renderMarkdown(exportData)
  if (SENSITIVE_CONTENT_PATTERN.test(content)) {
    return {
      ok: false,
      errorCode: 'export_contains_sensitive_field',
      blockedTypes: ['secrets'],
      omittedFieldPaths: ['content']
    }
  }
  return {
    ok: true,
    exportId: createExportId(record.recordId, format, now()),
    fileName: `diagnostics-${safeFileName(record.recordId)}.${format === 'json' ? 'json' : 'md'}`,
    content,
    redaction
  }
}

function safeExportData(record: DiagnosticsRecordView): Record<string, unknown> {
  return {
    recordId: record.recordId,
    source: record.source,
    runId: record.runId,
    draftId: record.draftId,
    contactHash: record.contactHash ? shortHash(record.contactHash) : undefined,
    appType: record.appType,
    finalAction: record.finalAction,
    topErrorCode: record.topErrorCode,
    createdAt: record.createdAt,
    timeline: record.timeline.map(safeTimelineNode),
    redaction: {
      status: record.redaction.status,
      blockedTypes: record.redaction.blockedTypes,
      omittedFieldPaths: record.redaction.omittedFieldPaths,
      unknownFieldCount: record.redaction.unknownFieldCount,
      checkedAt: record.redaction.checkedAt
    },
    relatedSources: record.relatedSources.map((item) => ({
      source: item.source,
      count: item.count,
      topErrorCode: item.topErrorCode,
      createdAt: item.createdAt
    }))
  }
}

function safeTimelineNode(node: DiagnosticsTimelineNode): Record<string, unknown> {
  return {
    capability: node.capability,
    source: node.source,
    status: node.status,
    summary: node.summary,
    detail: node.detail,
    omittedReason: node.omittedReason,
    errorCode: node.errorCode,
    occurredAt: node.occurredAt
  }
}

function renderMarkdown(data: Record<string, unknown>): string {
  const timeline = Array.isArray(data.timeline) ? data.timeline : []
  const lines = [
    '# Diagnostics Record',
    '',
    `- Record ID: ${data.recordId ?? ''}`,
    `- Source: ${data.source ?? ''}`,
    `- Run ID: ${data.runId ?? ''}`,
    `- Draft ID: ${data.draftId ?? ''}`,
    `- Contact Hash: ${data.contactHash ?? ''}`,
    `- Final Action: ${data.finalAction ?? ''}`,
    `- Top Error: ${data.topErrorCode ?? ''}`,
    `- Created At: ${data.createdAt ?? ''}`,
    '',
    '## Timeline',
    ''
  ]
  for (const node of timeline) {
    if (!isRecord(node)) continue
    lines.push(
      `### ${node.capability ?? ''}`,
      '',
      `- Source: ${node.source ?? ''}`,
      `- Status: ${node.status ?? ''}`,
      `- Summary: ${node.summary ?? ''}`,
      `- Omitted Reason: ${node.omittedReason ?? ''}`,
      `- Error Code: ${node.errorCode ?? ''}`,
      '',
      '```json',
      JSON.stringify(node.detail ?? {}, null, 2),
      '```',
      ''
    )
  }
  lines.push('## Redaction', '', '```json', JSON.stringify(data.redaction ?? {}, null, 2), '```', '')
  return `${lines.join('\n')}\n`
}

function blocked(record: DiagnosticsRecordView): DiagnosticsExportResponse {
  return {
    ok: false,
    errorCode: 'export_contains_sensitive_field',
    blockedTypes: record.redaction.blockedTypes,
    omittedFieldPaths: record.redaction.omittedFieldPaths
  }
}

function createExportId(recordId: string, format: string, now: Date): string {
  return createHash('sha256')
    .update(`${recordId}:${format}:${now.toISOString()}`)
    .digest('hex')
    .slice(0, 16)
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80)
}

function shortHash(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value
}

function collectUnsafeHashPaths(value: unknown): string[] {
  const paths: string[] = []
  function visit(current: unknown, path: string): void {
    if (current === null || current === undefined) return
    if (typeof current === 'string') {
      if (isHashAssignmentTextPath(path) && containsUnsafeHashAssignment(current)) {
        paths.push(path)
      }
      return
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`))
      return
    }
    if (!isRecord(current)) return
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key
      if (isHashFieldKey(key)) {
        if (typeof child === 'string' && !isDiagnosticsContactHash(child)) {
          paths.push(childPath)
        }
        continue
      }
      visit(child, childPath)
    }
  }
  visit(value, '')
  return Array.from(new Set(paths)).sort()
}

function containsUnsafeHashAssignment(value: string): boolean {
  HASH_ASSIGNMENT_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null = HASH_ASSIGNMENT_PATTERN.exec(value)
  while (match) {
    const candidate = match[1]?.trim()
    if (candidate && !isDiagnosticsContactHash(candidate)) return true
    match = HASH_ASSIGNMENT_PATTERN.exec(value)
  }
  return false
}

function isHashAssignmentTextPath(path: string): boolean {
  return (
    path === 'recordId' ||
    path === 'sourcePartitionId' ||
    /^timeline\[\d+\]\.(summary|omittedReason|errorCode)$/.test(path)
  )
}

function isHashFieldKey(key: string): boolean {
  return key === 'contactHash' || key === 'contactKeyHash' || key === 'sampleIdHash'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
