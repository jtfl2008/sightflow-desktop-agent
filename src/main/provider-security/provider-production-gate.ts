import type { SecureProviderBundleManifest } from './provider-manifest-security'
import { verifyProviderArtifacts } from './provider-artifact-verifier'
import { verifyProviderManifestSignature } from './provider-signature-verifier'
import type { ProviderSecurityErrorCode, TrustedPublisherRecord } from './provider-security-types'

export interface ProviderProductionGateInput {
  manifest: SecureProviderBundleManifest
  sourceUrl: string
  trustedPublishers: TrustedPublisherRecord[]
  artifactContentByPath: Record<string, Uint8Array | string>
}

export interface ProviderProductionTrustDecision {
  providerId: string
  version: string
  trustLevel: 'builtin' | 'trusted_signed' | 'debug_only' | 'blocked'
  productionInstallAllowed: boolean
  debugRunAllowed: boolean
  reasonCodes: ProviderSecurityErrorCode[]
  deniedPermissionNames: string[]
  artifactHashes: Record<string, string>
  signatureStatus: string
}

const ALLOWED_PERMISSIONS = new Set(['network', 'provider_config', 'debug_log'])

export function evaluateProviderProductionGate(
  input: ProviderProductionGateInput
): ProviderProductionTrustDecision {
  const reasonCodes: ProviderSecurityErrorCode[] = []
  const deniedPermissionNames = (input.manifest.permissions || [])
    .map((permission) => permission.name)
    .filter((name) => !ALLOWED_PERMISSIONS.has(name))

  if (deniedPermissionNames.length) reasonCodes.push('provider.security.permission_denied')
  if (input.sourceUrl.startsWith('http://')) reasonCodes.push('provider.security.insecure_transport')

  const signature = verifyProviderManifestSignature(input.manifest, input.trustedPublishers)
  if (!signature.valid && signature.code) reasonCodes.push(signature.code)

  const artifacts = verifyProviderArtifacts(input.manifest, input.artifactContentByPath)
  if (!artifacts.valid && artifacts.code) reasonCodes.push(artifacts.code)

  const blockingReasons = reasonCodes.filter(
    (code) =>
      code !== 'provider.security.missing_signature' &&
      code !== 'provider.security.unknown_publisher'
  )
  const productionInstallAllowed =
    signature.valid && artifacts.valid && !deniedPermissionNames.length && !input.sourceUrl.startsWith('http://')
  const debugRunAllowed = !blockingReasons.length

  return {
    providerId: input.manifest.id,
    version: input.manifest.version,
    trustLevel: productionInstallAllowed
      ? 'trusted_signed'
      : blockingReasons.length
        ? 'blocked'
        : 'debug_only',
    productionInstallAllowed,
    debugRunAllowed,
    reasonCodes,
    deniedPermissionNames,
    artifactHashes: artifacts.artifactHashes,
    signatureStatus: signature.status
  }
}
