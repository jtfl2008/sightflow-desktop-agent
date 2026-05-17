import { AuditStore } from './audit-store'
import type { AuditSeverity } from './audit-types'
import type { InstalledProviderInfo, ProviderBundleManifest } from './provider-bundle'
import type { ProviderProductionTrustDecision } from './provider-security/provider-production-gate'

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
    severity: input.success ? 'info' : ('warn' satisfies AuditSeverity),
    message: input.success
      ? `${input.action} completed`
      : `${input.action} blocked or failed`,
    metadata: {
      success: input.success,
      manifestUrl: redactProviderUrl(input.manifestUrl),
      providerId: input.manifest?.id || input.installed?.id,
      providerName: input.manifest?.name || input.installed?.name,
      version: input.manifest?.version || input.installed?.version,
      previousProviderId: input.previousInstalled?.id,
      previousVersion: input.previousInstalled?.version,
      trustLevel: input.gate?.trustLevel,
      productionInstallAllowed: input.gate?.productionInstallAllowed,
      debugRunAllowed: input.gate?.debugRunAllowed,
      reasonCodes: input.gate?.reasonCodes || [],
      deniedPermissionNames: input.gate?.deniedPermissionNames || [],
      artifactHashes: input.gate?.artifactHashes || {},
      signatureStatus: input.gate?.signatureStatus,
      error: redactSensitiveProviderText(input.error),
      redaction: 'provider lifecycle audit excludes provider config values and bundle contents'
    }
  })
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
