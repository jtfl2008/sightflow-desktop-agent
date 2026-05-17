import { AuditStore } from './audit-store'
import { VisionReplayStore } from './vision-replay-store'
import type {
  DiagnosticsSource,
  DiagnosticsSourceAdapter,
  DiagnosticsSourceRecord,
  NormalizedDiagnosticsQuery
} from '../core/diagnostics/diagnostics-types'

export function createRuntimeDiagnosticsAdapter(auditStore: AuditStore): DiagnosticsSourceAdapter {
  return {
    source: 'runtime',
    async query(input) {
      return auditStore
        .getRecent(input.limit + input.offset)
        .filter((record) => isRuntimeAuditRecord(record.metadata))
        .filter((record) => matchesQuery(record as unknown as Record<string, unknown>, input))
        .slice(input.offset, input.offset + input.limit)
        .map((record) => ({
          source: 'runtime' as const,
          sourceRecordId: record.id,
          raw: record as unknown as Record<string, unknown>,
          createdAt: record.occurredAt
        }))
    }
  }
}

export function createVisionEvalDiagnosticsAdapter(store: VisionReplayStore): DiagnosticsSourceAdapter {
  return {
    source: 'vision_eval',
    async query(input) {
      const result = await store.listReports({ limit: input.limit + input.offset })
      return result.reports
        .filter((report) => {
          if (input.runId && report.reportId !== input.runId) return false
          if (input.draftId && report.reportId !== input.draftId) return false
          if (input.contactHash) return false
          return true
        })
        .slice(input.offset, input.offset + input.limit)
        .map((report): DiagnosticsSourceRecord => ({
          source: 'vision_eval',
          sourceRecordId: report.reportId,
          raw: {
            ...report,
            reportId: report.reportId,
            runId: report.reportId,
            finalAction: report.result === 'blocked' ? 'blocked' : undefined,
            topErrorCode: visionTopErrorCode(report),
            privacyGateStatus: report.privacyGateStatus,
            redactionStatus: report.privacyGateStatus === 'blocked' ? 'blocked' : 'passed',
            failureClass: topFailureClass(report.failureCategoryCounts)
          },
          createdAt: report.generatedAt
        }))
    }
  }
}

export function createEmptyDiagnosticsAdapter(source: DiagnosticsSource): DiagnosticsSourceAdapter {
  return {
    source,
    async query(_input: NormalizedDiagnosticsQuery): Promise<DiagnosticsSourceRecord[]> {
      return []
    }
  }
}

function isRuntimeAuditRecord(metadata: Record<string, unknown>): boolean {
  const source = typeof metadata.source === 'string' ? metadata.source : undefined
  return source === undefined || source === 'runtime'
}

function matchesQuery(raw: Record<string, unknown>, input: NormalizedDiagnosticsQuery): boolean {
  if (input.runId && !pathEquals(raw, input.runId, ['runId', 'metadata.runId'])) return false
  if (input.draftId && !pathEquals(raw, input.draftId, ['draftId', 'metadata.draftId'])) return false
  if (
    input.contactHash &&
    !pathEquals(raw, input.contactHash, [
      'contactHash',
      'contactKeyHash',
      'metadata.contactHash',
      'metadata.contactKeyHash',
      'metadata.customerProfile.contactKeyHash',
      'metadata.channelContext.contactKeyHash'
    ])
  ) {
    return false
  }
  return true
}

function pathEquals(raw: Record<string, unknown>, expected: string, paths: string[]): boolean {
  return paths.some((path) => getPath(raw, path) === expected)
}

function getPath(raw: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    return (current as Record<string, unknown>)[segment]
  }, raw)
}

function visionTopErrorCode(report: {
  privacyGateStatus: string
  hashStatus: string
  schemaStatus: string
}): string | undefined {
  if (report.privacyGateStatus === 'blocked') return 'vision_privacy_gate_blocked'
  if (report.hashStatus === 'mismatch') return 'vision_hash_mismatch'
  if (report.schemaStatus === 'invalid') return 'vision_schema_invalid'
  return undefined
}

function topFailureClass(counts: Record<string, number>): string | undefined {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])[0]?.[0]
}
