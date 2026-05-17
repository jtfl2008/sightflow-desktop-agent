import {
  DiagnosticsCapability,
  DiagnosticsNodeDetail,
  DiagnosticsOmittedReason
} from './diagnostics-types'
import { isDiagnosticsContactHash } from './diagnostics-contact-hash'

export function whitelistDiagnosticsNodeDetail(
  capability: DiagnosticsCapability,
  raw: unknown
): DiagnosticsNodeDetail {
  const input = isRecord(raw) ? raw : {}
  switch (capability) {
    case 'intent':
      return {
        type: 'intent',
        primaryIntentId: stringValue(input.primaryIntentId),
        confidence: numberValue(input.confidence),
        fallbackUsed: booleanValue(input.fallbackUsed),
        matchedRuleIds: stringArray(input.matchedRuleIds)
      }
    case 'route':
      return {
        type: 'route',
        routeId: stringValue(input.routeId),
        routeAction: stringValue(input.routeAction),
        forcedReplyMode: stringValue(input.forcedReplyMode),
        policyHintIds: stringArray(input.policyHintIds)
      }
    case 'knowledge':
      return {
        type: 'knowledge',
        matched: arrayValue(input.matched).reduce<
          Array<{ id: string; title: string; sourceType: string; score?: number }>
        >((acc, item) => {
            const record = isRecord(item) ? item : {}
            const id = stringValue(record.id)
            const title = stringValue(record.title)
            const sourceType = stringValue(record.sourceType)
            if (!id || !title || !sourceType) return acc
            const score = numberValue(record.score)
            acc.push(score === undefined ? { id, title, sourceType } : { id, title, sourceType, score })
            return acc
          }, []),
        budgetApplied: booleanValue(input.budgetApplied),
        omittedCount: numberValue(input.omittedCount)
      }
    case 'customer_memory':
      return {
        type: 'customer_memory',
        profileId: stringValue(input.profileId),
        version: stringValue(input.version),
        contactKeyHash: hashValue(input.contactKeyHash),
        injectedFieldPaths: stringArray(input.injectedFieldPaths),
        omittedReason: omittedReasonValue(input.omittedReason)
      }
    case 'provider':
      return {
        type: 'provider',
        providerId: stringValue(input.providerId),
        version: stringValue(input.version),
        trustLevel: stringValue(input.trustLevel),
        decision: stringValue(input.decision),
        reason: stringValue(input.reason),
        errorCode: stringValue(input.errorCode)
      }
    case 'workflow':
      return {
        type: 'workflow',
        workflowId: stringValue(input.workflowId),
        nodeId: stringValue(input.nodeId),
        nodeType: stringValue(input.nodeType),
        decision: stringValue(input.decision),
        fallbackReason: stringValue(input.fallbackReason),
        errorCode: stringValue(input.errorCode)
      }
    case 'device':
      return {
        type: 'device',
        channelAdapterId: stringValue(input.channelAdapterId),
        multiSessionEnabled: booleanValue(input.multiSessionEnabled),
        currentMode: stringValue(input.currentMode),
        verificationState: stringValue(input.verificationState),
        errorCode: stringValue(input.errorCode),
        degradedReason: stringValue(input.degradedReason)
      }
    case 'vision':
      return {
        type: 'vision',
        reportId: stringValue(input.reportId),
        sampleIdHash: hashValue(input.sampleIdHash),
        failureClass: stringValue(input.failureClass),
        privacyGateStatus: stringValue(input.privacyGateStatus),
        redactionStatus: stringValue(input.redactionStatus),
        errorCode: stringValue(input.errorCode)
      }
    case 'final_action':
      return {
        type: 'final_action',
        finalAction: stringValue(input.finalAction) as DiagnosticsNodeDetail['type'] extends 'final_action'
          ? never
          : any,
        policyDecision: stringValue(input.policyDecision),
        reasons: stringArray(input.reasons)
      } as DiagnosticsNodeDetail
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function hashValue(value: unknown): string | undefined {
  const text = stringValue(value)
  return text && isDiagnosticsContactHash(text) ? text : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringArray(value: unknown): string[] | undefined {
  const strings = arrayValue(value).filter((item): item is string => typeof item === 'string')
  return strings.length ? strings : undefined
}

function omittedReasonValue(value: unknown): DiagnosticsOmittedReason | undefined {
  return typeof value === 'string' ? (value as DiagnosticsOmittedReason) : undefined
}
