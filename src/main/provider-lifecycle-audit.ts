import { AuditStore } from './audit-store'
import type { AuditSeverity } from './audit-types'
import type { InstalledProviderInfo, ProviderBundleManifest } from './provider-bundle'
import type { ProviderProductionTrustDecision } from './provider-security/provider-production-gate'
import type { RedactionExportSummary } from '../core/redaction-export-summary'

export type ProviderLifecycleAction = 'provider_install' | 'provider_update' | 'provider_rollback'

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
