import { AuditStore } from './audit-store'
import type { AuditSeverity } from './audit-types'
import type { InstalledProviderInfo, ProviderBundleManifest } from './provider-bundle'
import type { ProviderProductionTrustDecision } from './provider-security/provider-production-gate'
import type { RedactionExportSummary } from '../core/redaction-export-summary'

export type ProviderLifecycleAction =
  | 'provider_install'
  | 'provider_update'
  | 'provider_rollback'
  | 'provider_recovery_reconciliation'

export type ProviderRecoveryDecision =
  | 'recovery_not_needed'
  | 'recovery_reconciled'
  | 'recovery_blocked'
  | 'recovery_rollback_to_previous'
  | 'recovery_fallback_builtin'

export interface ProviderRecoverySafeSummary {
  providerId?: string
  version?: string
  trustLevel?: 'builtin' | 'trusted_signed' | 'debug_only' | 'blocked'
  productionInstallAllowed?: boolean
  hasSettingsInstalled?: boolean
  hasLifecyclePointer?: boolean
  hasPreviousPointer?: boolean
  manifestUrlOrigin?: string
  manifestUrlHasRedactedQuery?: boolean
}

export interface ProviderLifecycleAuditInput {
  action: ProviderLifecycleAction
  success: boolean
  manifestUrl?: string
  installed?: InstalledProviderInfo | null
  manifest?: ProviderBundleManifest | null
  gate?: ProviderProductionTrustDecision | null
  error?: string
  previousInstalled?: InstalledProviderInfo | null
}

export interface ProviderRecoveryReconciliationAuditInput {
  success: boolean
  decision: ProviderRecoveryDecision
  reasonCodes: string[]
  providerId?: string
  settingsProviderId?: string
  settingsVersion?: string
  lifecycleActiveVersion?: string
  previousTrustedVersion?: string
  inconsistencyType?: string
  beforeSummary?: ProviderRecoverySafeSummary
  afterSummary?: ProviderRecoverySafeSummary
  redactionExportSummary?: RedactionExportSummary
}

export function recordProviderLifecycleAudit(
  auditStore: Pick<AuditStore, 'record'>,
  input: ProviderLifecycleAuditInput
): void {
  auditStore.record({
    category: 'provider',
    action: input.action,
    source: 'provider_lifecycle',
    severity: input.success ? 'info' : ('warn' satisfies AuditSeverity),
    message: input.success
      ? `${input.action} completed`
      : `${input.action} blocked or failed`,
    metadata: {
      success: input.success,
      providerId: input.manifest?.id || input.installed?.id,
      targetVersion: input.manifest?.version || input.installed?.version,
      previousVersion: input.previousInstalled?.version,
      trustLevel: input.gate?.trustLevel,
      decision: input.gate?.productionInstallAllowed
        ? 'allowed'
        : input.gate?.debugRunAllowed
          ? 'debug_only'
          : 'blocked',
      reasonCodes: input.gate?.reasonCodes || [],
      deniedPermissionNames: input.gate?.deniedPermissionNames || [],
      artifactHashes: input.gate?.artifactHashes || {},
      signatureStatus: input.gate?.signatureStatus,
      error: redactSensitiveProviderText(input.error),
      redaction: 'provider lifecycle audit excludes provider config values and bundle contents',
      redactionExportSummary: buildProviderLifecycleRedactionSummary(input)
    }
  })
}

export function recordProviderRecoveryReconciliationAudit(
  auditStore: Pick<AuditStore, 'record'>,
  input: ProviderRecoveryReconciliationAuditInput
): void {
  auditStore.record({
    category: 'provider',
    action: 'provider_recovery_reconciliation',
    source: 'recovery_reconciliation',
    severity: input.success ? 'info' : ('warn' satisfies AuditSeverity),
    message: input.success
      ? 'provider recovery reconciliation completed'
      : 'provider recovery reconciliation blocked or failed',
    metadata: {
      success: input.success,
      providerId: safeScalar(input.providerId),
      settingsProviderId: safeScalar(input.settingsProviderId),
      settingsVersion: safeScalar(input.settingsVersion),
      lifecycleActiveVersion: safeScalar(input.lifecycleActiveVersion),
      previousTrustedVersion: safeScalar(input.previousTrustedVersion),
      inconsistencyType: safeScalar(input.inconsistencyType),
      decision: input.decision,
      reasonCodes: input.reasonCodes.map(safeScalar).filter((item) => item !== undefined),
      beforeSummary: sanitizeRecoverySummary(input.beforeSummary),
      afterSummary: sanitizeRecoverySummary(input.afterSummary),
      redaction: 'provider recovery audit excludes provider config values, bundle contents, URL query, and local paths',
      redactionExportSummary: input.redactionExportSummary ?? {
        status: 'passed',
        blockedTypes: [],
        omittedFieldPaths: [],
        unknownFieldCount: 0,
        checkedAt: new Date().toISOString()
      }
    }
  })
}

function buildProviderLifecycleRedactionSummary(input: ProviderLifecycleAuditInput): RedactionExportSummary {
  const omittedFieldPaths = new Set<string>()
  const blockedTypes = new Set<RedactionExportSummary['blockedTypes'][number]>()
  if (input.manifest?.configSchema) {
    omittedFieldPaths.add('manifest.configSchema')
    blockedTypes.add('provider_config_values')
  }
  if (input.installed?.entryFile) {
    omittedFieldPaths.add('installed.entryFile')
    blockedTypes.add('secrets')
  }
  if (input.previousInstalled?.entryFile) {
    omittedFieldPaths.add('previousInstalled.entryFile')
    blockedTypes.add('secrets')
  }
  if (input.manifestUrl && input.manifestUrl !== redactProviderUrl(input.manifestUrl)) {
    omittedFieldPaths.add('manifestUrl.search')
    blockedTypes.add('secrets')
  }
  if (input.error && input.error !== redactSensitiveProviderText(input.error)) {
    omittedFieldPaths.add('error')
    blockedTypes.add('secrets')
  }
  const sortedBlockedTypes = Array.from(blockedTypes).sort()
  return {
    status: sortedBlockedTypes.length ? 'blocked' : 'passed',
    blockedTypes: sortedBlockedTypes,
    omittedFieldPaths: Array.from(omittedFieldPaths).sort(),
    unknownFieldCount: 0,
    checkedAt: new Date().toISOString()
  }
}

function redactProviderUrl(value: string | undefined): string | undefined {
  if (!value) return value
  try {
    const url = new URL(value)
    url.search = url.search ? '?[REDACTED]' : ''
    url.hash = ''
    return url.toString()
  } catch {
    return redactSensitiveProviderText(value)
  }
}

function redactSensitiveProviderText(value: string | undefined): string | undefined {
  if (!value) return value
  return value.replace(
    /(api[-_]?key|authorization|bearer|token|secret|password)=([^&\s]+)/gi,
    '$1=[REDACTED]'
  )
}

function sanitizeRecoverySummary(
  value: ProviderRecoverySafeSummary | undefined
): ProviderRecoverySafeSummary | undefined {
  if (!value) return undefined
  const out: ProviderRecoverySafeSummary = {}
  setIfDefined(out, 'providerId', safeScalar(value.providerId))
  setIfDefined(out, 'version', safeScalar(value.version))
  setIfDefined(out, 'trustLevel', value.trustLevel)
  setIfDefined(out, 'productionInstallAllowed', value.productionInstallAllowed)
  setIfDefined(out, 'hasSettingsInstalled', value.hasSettingsInstalled)
  setIfDefined(out, 'hasLifecyclePointer', value.hasLifecyclePointer)
  setIfDefined(out, 'hasPreviousPointer', value.hasPreviousPointer)
  setIfDefined(out, 'manifestUrlOrigin', safeOrigin(value.manifestUrlOrigin))
  setIfDefined(out, 'manifestUrlHasRedactedQuery', value.manifestUrlHasRedactedQuery)
  return out
}

function setIfDefined<K extends keyof ProviderRecoverySafeSummary>(
  target: ProviderRecoverySafeSummary,
  key: K,
  value: ProviderRecoverySafeSummary[K] | undefined
): void {
  if (value !== undefined) target[key] = value
}

function safeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return safeScalar(value)
  }
}

function safeScalar(value: string | undefined): string | undefined {
  return redactSensitiveProviderText(redactProviderUrl(value))
}
