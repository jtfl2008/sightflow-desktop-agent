import { whitelistDiagnosticsNodeDetail } from './diagnostics-field-whitelist'
import { checkDiagnosticsRedaction } from './diagnostics-redaction-checker'
import { validateDiagnosticsQuery } from './diagnostics-contact-hash'
import {
  DIAGNOSTICS_CAPABILITY_ORDER,
  DiagnosticsCapability,
  DiagnosticsFinalAction,
  DiagnosticsNodeStatus,
  DiagnosticsQuery,
  DiagnosticsQueryResponse,
  DiagnosticsRecordView,
  DiagnosticsRelatedSourceSummary,
  DiagnosticsSourceAdapter,
  DiagnosticsSourceRecord,
  DiagnosticsTimelineNode
} from './diagnostics-types'

export async function queryDiagnostics(
  adapters: DiagnosticsSourceAdapter[],
  query: DiagnosticsQuery,
  now: () => Date = () => new Date()
): Promise<DiagnosticsQueryResponse> {
  const validated = validateDiagnosticsQuery(query)
  if (!validated.ok) {
    return {
      ok: false,
      errorCode: validated.errorCode,
      message: validated.message
    }
  }

  const adapterBySource = new Map(adapters.map((adapter) => [adapter.source, adapter]))
  const adapter = adapterBySource.get(validated.query.source)
  if (!adapter) return { ok: true, records: [], total: 0 }

  const records = await adapter.query(validated.query)
  const relatedByKey = new Map<string, DiagnosticsRelatedSourceSummary[]>()
  if (validated.query.includeRelatedSources) {
    await Promise.all(
      adapters
        .filter((item) => item.source !== validated.query.source)
        .map(async (relatedAdapter) => {
          const relatedRecords = await relatedAdapter.query(validated.query)
          for (const record of records) {
            const matches = relatedRecords.filter((candidate) => relatedMatches(record, candidate))
            if (!matches.length) continue
            const key = record.sourceRecordId
            const current = relatedByKey.get(key) ?? []
            current.push({
              source: relatedAdapter.source,
              count: matches.length,
              topErrorCode: stringAt(matches[0].raw, ['topErrorCode', 'metadata.topErrorCode', 'metadata.errorCode']),
              createdAt: matches[0].createdAt
            })
            relatedByKey.set(key, current)
          }
        })
    )
  }

  const views = records.map((record) =>
    toDiagnosticsRecordView(record, relatedByKey.get(record.sourceRecordId) ?? [], now)
  )
  return { ok: true, records: views, total: views.length }
}

export function toDiagnosticsRecordView(
  record: DiagnosticsSourceRecord,
  relatedSources: DiagnosticsRelatedSourceSummary[] = [],
  now: () => Date = () => new Date()
): DiagnosticsRecordView {
  const runId = stringAt(record.raw, ['runId', 'metadata.runId', 'reportId'])
  const draftId = stringAt(record.raw, ['draftId', 'metadata.draftId'])
  const contactHash = stringAt(record.raw, [
    'contactHash',
    'contactKeyHash',
    'metadata.contactHash',
    'metadata.contactKeyHash',
    'metadata.customerProfile.contactKeyHash',
    'metadata.channelContext.contactKeyHash'
  ])
  const primaryIntentId = stringAt(record.raw, ['primaryIntentId', 'metadata.primaryIntentId'])
  const routeAction = stringAt(record.raw, ['routeAction', 'metadata.routeAction'])
  const finalAction = inferFinalAction(record)
  const topErrorCode = inferTopErrorCode(record.raw)
  const redaction = checkDiagnosticsRedaction(record.raw, { now })
  const timeline = DIAGNOSTICS_CAPABILITY_ORDER.map((capability) =>
    buildTimelineNode(record, capability, finalAction)
  )
  const stableId = record.sourceRecordId || runId || draftId || contactHash || record.createdAt

  return {
    recordId: `${record.source}:${stableId}`,
    source: record.source,
    sourcePartitionId: `${record.source}:${runId || draftId || contactHash || stableId}:${record.createdAt}`,
    runId,
    draftId,
    contactHash,
    appType: stringAt(record.raw, ['appType', 'metadata.appType']),
    finalAction,
    topErrorCode,
    primaryIntentId,
    routeAction,
    createdAt: record.createdAt,
    timeline,
    redaction,
    relatedSources
  }
}

function buildTimelineNode(
  record: DiagnosticsSourceRecord,
  capability: DiagnosticsCapability,
  finalAction?: DiagnosticsFinalAction
): DiagnosticsTimelineNode {
  const raw = rawDetailForCapability(record.raw, capability, finalAction)
  const detail = whitelistDiagnosticsNodeDetail(capability, raw)
  const errorCode = isRecord(raw) ? stringValue(raw.errorCode) : undefined
  const omittedReason = isRecord(raw) ? stringValue(raw.omittedReason) : undefined
  return {
    capability,
    source: record.source,
    status: inferStatus(capability, raw, errorCode, omittedReason),
    summary: summarize(capability, detail),
    detail,
    omittedReason: omittedReason as DiagnosticsTimelineNode['omittedReason'],
    errorCode,
    occurredAt: stringAt(record.raw, ['occurredAt', 'createdAt', 'generatedAt'])
  }
}

function rawDetailForCapability(
  raw: Record<string, unknown>,
  capability: DiagnosticsCapability,
  finalAction?: DiagnosticsFinalAction
): Record<string, unknown> {
  const metadata = isRecord(raw.metadata) ? raw.metadata : raw
  switch (capability) {
    case 'intent':
      return {
        primaryIntentId: stringAt(raw, ['primaryIntentId', 'metadata.primaryIntentId', 'metadata.intent.primaryIntentId']),
        confidence: numberAt(raw, ['confidence', 'metadata.confidence', 'metadata.intent.confidence']),
        fallbackUsed: booleanAt(raw, ['fallbackUsed', 'metadata.fallbackUsed', 'metadata.intent.fallbackUsed']),
        matchedRuleIds: valueAt(raw, ['matchedRuleIds', 'metadata.matchedRuleIds'])
      }
    case 'route':
      return {
        routeId: stringAt(raw, ['routeId', 'metadata.routeId', 'metadata.route.routeId']),
        routeAction: stringAt(raw, ['routeAction', 'metadata.routeAction', 'metadata.route.action']),
        forcedReplyMode: stringAt(raw, ['forcedReplyMode', 'metadata.forcedReplyMode', 'metadata.route.forcedReplyMode']),
        policyHintIds: valueAt(raw, ['policyHintIds', 'metadata.policyHintIds'])
      }
    case 'knowledge':
      return {
        matched: valueAt(raw, ['matched', 'metadata.matchedKnowledge', 'metadata.knowledgeSnippets']),
        budgetApplied: booleanAt(raw, ['budgetApplied', 'metadata.budgetApplied']),
        omittedCount: numberAt(raw, ['omittedCount', 'metadata.omittedCount'])
      }
    case 'customer_memory':
      return {
        profileId: stringAt(raw, ['profileId', 'metadata.customerProfile.profileId']),
        version: stringValue(valueAt(raw, ['version', 'metadata.customerProfile.version'])) ?? numberAt(raw, ['metadata.customerProfile.version'])?.toString(),
        contactKeyHash: stringAt(raw, ['contactKeyHash', 'metadata.customerProfile.contactKeyHash', 'metadata.channelContext.contactKeyHash']),
        injectedFieldPaths: valueAt(raw, ['injectedFieldPaths', 'metadata.customerProfile.injectedFieldPaths']),
        omittedReason: stringAt(raw, ['omittedReason', 'metadata.customerProfile.omittedReason', 'metadata.channelContext.customerMemoryOmittedReason'])
      }
    case 'provider':
      return {
        providerId: stringAt(raw, ['providerId', 'metadata.providerId', 'metadata.provider.id']),
        version: stringAt(raw, ['version', 'metadata.version', 'metadata.provider.version']),
        trustLevel: stringAt(raw, ['trustLevel', 'metadata.trustLevel']),
        decision: stringAt(raw, ['decision', 'metadata.decision', 'action']),
        reason: stringAt(raw, ['reason', 'metadata.reason', 'message']),
        errorCode: inferTopErrorCode(raw)
      }
    case 'workflow':
      return {
        workflowId: stringAt(raw, ['workflowId', 'metadata.workflowId']),
        nodeId: stringAt(raw, ['nodeId', 'metadata.nodeId']),
        nodeType: stringAt(raw, ['nodeType', 'metadata.nodeType']),
        decision: stringAt(raw, ['decision', 'metadata.decision']),
        fallbackReason: stringAt(raw, ['fallbackReason', 'metadata.fallbackReason']),
        errorCode: stringAt(raw, ['workflowErrorCode', 'metadata.workflowErrorCode'])
      }
    case 'device':
      return {
        channelAdapterId: stringAt(raw, ['channelAdapterId', 'metadata.channelContext.adapterId', 'metadata.channelAdapterId']),
        multiSessionEnabled: booleanAt(raw, ['multiSessionEnabled', 'metadata.channelContext.multiSessionEnabled']),
        currentMode: stringAt(raw, ['currentMode', 'metadata.channelContext.runtimeMode', 'metadata.channelContext.finalAction']),
        verificationState: stringAt(raw, ['verificationState', 'metadata.channelContext.verificationState']),
        errorCode: stringAt(raw, ['deviceErrorCode', 'metadata.deviceErrorCode', 'metadata.errorCode']),
        degradedReason: stringAt(raw, ['degradedReason', 'metadata.channelContext.degradedReason'])
      }
    case 'vision':
      return {
        reportId: stringAt(raw, ['reportId', 'metadata.reportId']),
        sampleIdHash: stringAt(raw, ['sampleIdHash', 'metadata.sampleIdHash']),
        failureClass: stringAt(raw, ['failureClass', 'metadata.failureClass', 'result']),
        privacyGateStatus: stringAt(raw, ['privacyGateStatus', 'metadata.privacyGateStatus']),
        redactionStatus: stringAt(raw, ['redactionStatus', 'metadata.redactionStatus']),
        errorCode: stringAt(raw, ['visionErrorCode', 'metadata.visionErrorCode'])
      }
    case 'final_action':
      return {
        finalAction,
        policyDecision: stringAt(raw, ['policyDecision', 'metadata.policyDecision']),
        reasons: Array.isArray(metadata.reasons) ? metadata.reasons : undefined
      }
  }
}

function inferStatus(
  capability: DiagnosticsCapability,
  raw: Record<string, unknown>,
  errorCode?: string,
  omittedReason?: string
): DiagnosticsNodeStatus {
  if (errorCode) return 'error'
  if (omittedReason) return 'omitted'
  const values = Object.values(raw).filter((value) => value !== undefined && value !== null)
  if (!values.length) return capability === 'final_action' ? 'not_applicable' : 'not_recorded'
  if (capability === 'final_action') {
    const finalAction = raw.finalAction
    if (finalAction === 'blocked') return 'blocked'
    if (finalAction === 'provider_error' || finalAction === 'device_error') return 'error'
  }
  return 'ok'
}

function summarize(capability: DiagnosticsCapability, detail: DiagnosticsTimelineNode['detail']): string {
  switch (capability) {
    case 'intent':
      return detail.type === 'intent' && detail.primaryIntentId
        ? `primaryIntentId=${detail.primaryIntentId}${detail.confidence !== undefined ? `, confidence=${detail.confidence}` : ''}`
        : 'not_recorded'
    case 'route':
      return detail.type === 'route' && detail.routeAction ? `routeAction=${detail.routeAction}` : 'not_recorded'
    case 'knowledge':
      return detail.type === 'knowledge' && detail.matched?.length
        ? `matched=${detail.matched.length}, budgetApplied=${Boolean(detail.budgetApplied)}`
        : 'not_recorded'
    case 'customer_memory':
      return detail.type === 'customer_memory'
        ? detail.omittedReason
          ? `omittedReason=${detail.omittedReason}`
          : detail.contactKeyHash
            ? `contactHash=${shortHash(detail.contactKeyHash)}`
            : 'not_recorded'
        : 'not_recorded'
    case 'provider':
      return detail.type === 'provider' ? detail.errorCode || detail.decision || 'not_recorded' : 'not_recorded'
    case 'workflow':
      return detail.type === 'workflow' ? detail.fallbackReason || detail.decision || 'not_recorded' : 'not_recorded'
    case 'device':
      return detail.type === 'device' ? detail.errorCode || detail.currentMode || 'not_recorded' : 'not_recorded'
    case 'vision':
      return detail.type === 'vision' ? detail.privacyGateStatus || detail.failureClass || 'not_recorded' : 'not_recorded'
    case 'final_action':
      return detail.type === 'final_action' && detail.finalAction ? detail.finalAction : 'not_applicable'
  }
}

function inferFinalAction(record: DiagnosticsSourceRecord): DiagnosticsFinalAction | undefined {
  const direct = stringAt(record.raw, ['finalAction', 'metadata.finalAction'])
  if (isFinalAction(direct)) return direct
  const action = stringAt(record.raw, ['action']) ?? ''
  const severity = stringAt(record.raw, ['severity'])
  if (/draft/i.test(action)) return 'draft_created'
  if (/sent|send|allow_send/i.test(action)) return 'sent'
  if (/skip/i.test(action)) return 'skipped'
  if (/blocked|block/i.test(action)) return 'blocked'
  if (/takeover/i.test(action)) return 'manual_takeover'
  if (/provider/i.test(action) && severity === 'error') return 'provider_error'
  if (/device|click|region/i.test(action) && severity === 'error') return 'device_error'
  return undefined
}

function isFinalAction(value: string | undefined): value is DiagnosticsFinalAction {
  return Boolean(
    value &&
      ['draft_created', 'sent', 'skipped', 'blocked', 'manual_takeover', 'provider_error', 'device_error'].includes(value)
  )
}

function inferTopErrorCode(raw: Record<string, unknown>): string | undefined {
  return stringAt(raw, ['topErrorCode', 'errorCode', 'metadata.topErrorCode', 'metadata.errorCode'])
}

function relatedMatches(left: DiagnosticsSourceRecord, right: DiagnosticsSourceRecord): boolean {
  const keys = [
    ['runId', 'metadata.runId'],
    ['draftId', 'metadata.draftId'],
    ['contactHash', 'contactKeyHash', 'metadata.contactHash', 'metadata.contactKeyHash']
  ]
  return keys.some((paths) => {
    const leftValue = stringAt(left.raw, paths)
    const rightValue = stringAt(right.raw, paths)
    return Boolean(leftValue && rightValue && leftValue === rightValue)
  })
}

function shortHash(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value
}

function valueAt(raw: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    const value = getPath(raw, path)
    if (value !== undefined) return value
  }
  return undefined
}

function stringAt(raw: Record<string, unknown>, paths: string[]): string | undefined {
  return stringValue(valueAt(raw, paths))
}

function numberAt(raw: Record<string, unknown>, paths: string[]): number | undefined {
  const value = valueAt(raw, paths)
  return typeof value === 'number' ? value : undefined
}

function booleanAt(raw: Record<string, unknown>, paths: string[]): boolean | undefined {
  const value = valueAt(raw, paths)
  return typeof value === 'boolean' ? value : undefined
}

function getPath(raw: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined
    return current[segment]
  }, raw)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
