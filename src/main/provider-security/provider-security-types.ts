export type ProviderSecurityErrorCode =
  | 'provider.security.missing_signature'
  | 'provider.security.unknown_publisher'
  | 'provider.security.signature_invalid'
  | 'provider.security.artifact_hash_mismatch'
  | 'provider.security.permission_denied'
  | 'provider.security.insecure_transport'
  | 'provider.security.expired_signature'
  | 'provider.security.revoked_publisher'
  | 'provider.security.unsupported_signature_algorithm'
  | 'provider.security.unsupported_canonicalization'
  | 'provider.security.missing_artifact'
  | 'provider.security.entry_path_escape'
  | 'provider.security.entry_absolute_path'
  | 'provider.security.entry_unsupported_protocol'

export interface ProviderManifestSecurityExtension {
  manifestVersion: '1.2'
  publisherId: string
  keyId: string
  signatureAlgorithm: 'ed25519'
  signature: string
  signedAt: string
  expiresAt?: string
  canonicalization: 'jcs-v1'
}

export interface ProviderArtifactDeclaration {
  path: string
  sha256: string
  sizeBytes: number
  contentType: 'application/javascript' | 'application/json' | 'text/plain'
}

export type ProviderPermissionDeclaration =
  | { name: 'network'; hosts: string[]; reason: string }
  | { name: 'provider_config'; keys: string[]; reason: string }
  | { name: 'debug_log'; reason: string }

export interface TrustedPublisherRecord {
  publisherId: string
  displayName: string
  publicKeyPem: string
  keyId: string
  trustSource: 'builtin' | 'user_added' | 'enterprise_policy'
  trustedAt: string
  revokedAt?: string
  notes?: string
}

export interface ProviderSignatureVerification {
  valid: boolean
  status: 'missing' | 'valid' | 'invalid' | 'expired' | 'unknown_publisher' | 'revoked_publisher'
  code?: ProviderSecurityErrorCode
  publisherId?: string
  keyId?: string
  canonicalPayload?: string
}

export interface ProviderArtifactVerification {
  valid: boolean
  code?: ProviderSecurityErrorCode
  message?: string
  artifactHashes: Record<string, string>
}
