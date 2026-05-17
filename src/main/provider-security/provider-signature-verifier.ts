import { createPublicKey, verify } from 'node:crypto'
import type { SecureProviderBundleManifest } from './provider-manifest-security'
import { canonicalizeProviderManifestForSignature } from './provider-manifest-security'
import type {
  ProviderSignatureVerification,
  TrustedPublisherRecord
} from './provider-security-types'

export function verifyProviderManifestSignature(
  manifest: SecureProviderBundleManifest,
  trustedPublishers: TrustedPublisherRecord[],
  now: Date = new Date()
): ProviderSignatureVerification {
  const security = manifest.security
  if (!security?.signature) {
    return { valid: false, status: 'missing', code: 'provider.security.missing_signature' }
  }

  if (security.signatureAlgorithm !== 'ed25519') {
    return {
      valid: false,
      status: 'invalid',
      code: 'provider.security.unsupported_signature_algorithm',
      publisherId: security.publisherId,
      keyId: security.keyId
    }
  }

  if (security.canonicalization !== 'jcs-v1') {
    return {
      valid: false,
      status: 'invalid',
      code: 'provider.security.unsupported_canonicalization',
      publisherId: security.publisherId,
      keyId: security.keyId
    }
  }

  const publisher = trustedPublishers.find(
    (candidate) =>
      candidate.publisherId === security.publisherId && candidate.keyId === security.keyId
  )
  if (!publisher) {
    return {
      valid: false,
      status: 'unknown_publisher',
      code: 'provider.security.unknown_publisher',
      publisherId: security.publisherId,
      keyId: security.keyId
    }
  }

  if (publisher.revokedAt) {
    return {
      valid: false,
      status: 'revoked_publisher',
      code: 'provider.security.revoked_publisher',
      publisherId: security.publisherId,
      keyId: security.keyId
    }
  }

  if (security.expiresAt && Date.parse(security.expiresAt) < now.getTime()) {
    return {
      valid: false,
      status: 'expired',
      code: 'provider.security.expired_signature',
      publisherId: security.publisherId,
      keyId: security.keyId
    }
  }

  const canonicalPayload = canonicalizeProviderManifestForSignature(manifest)
  const publicKey = createPublicKey(publisher.publicKeyPem)
  const signature = Buffer.from(security.signature, 'base64')
  const valid = verify(null, Buffer.from(canonicalPayload), publicKey, signature)

  return {
    valid,
    status: valid ? 'valid' : 'invalid',
    code: valid ? undefined : 'provider.security.signature_invalid',
    publisherId: security.publisherId,
    keyId: security.keyId,
    canonicalPayload
  }
}
