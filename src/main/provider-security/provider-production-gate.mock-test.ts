import * as assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { canonicalizeProviderManifestForSignature, SecureProviderBundleManifest, sha256Hex } from './provider-manifest-security'
import { evaluateProviderProductionGate } from './provider-production-gate'
import type { TrustedPublisherRecord } from './provider-security-types'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
const trustedPublisher: TrustedPublisherRecord = {
  publisherId: 'official',
  displayName: 'Official',
  publicKeyPem,
  keyId: 'k1',
  trustSource: 'builtin',
  trustedAt: new Date().toISOString()
}
const bundle = 'export function createProvider() {}'

function manifest(): SecureProviderBundleManifest {
  return {
    apiVersion: 1,
    id: 'official-provider',
    name: 'Official Provider',
    version: '1.0.0',
    entry: 'provider.bundle.js',
    moduleType: 'module',
    capabilities: ['chat'],
    configSchema: { type: 'object', properties: {} },
    security: {
      manifestVersion: '1.2',
      publisherId: 'official',
      keyId: 'k1',
      signatureAlgorithm: 'ed25519',
      signature: '',
      signedAt: new Date().toISOString(),
      canonicalization: 'jcs-v1'
    },
    artifacts: [
      {
        path: 'provider.bundle.js',
        sha256: sha256Hex(bundle),
        sizeBytes: Buffer.byteLength(bundle),
        contentType: 'application/javascript'
      }
    ],
    permissions: [{ name: 'debug_log', reason: 'debug' }]
  }
}

function signed(input = manifest()): SecureProviderBundleManifest {
  return {
    ...input,
    security: {
      ...input.security!,
      signature: sign(null, Buffer.from(canonicalizeProviderManifestForSignature(input)), privateKey).toString('base64')
    }
  }
}

function testMissingSignatureIsDebugOnly(): void {
  const input = manifest()
  delete input.security
  const decision = evaluateProviderProductionGate({
    manifest: input,
    sourceUrl: 'https://example.com/manifest.json',
    trustedPublishers: [trustedPublisher],
    artifactContentByPath: { 'provider.bundle.js': bundle }
  })
  assert.equal(decision.productionInstallAllowed, false)
  assert.equal(decision.debugRunAllowed, true)
  assert.equal(decision.trustLevel, 'debug_only')
  assert.ok(decision.reasonCodes.includes('provider.security.missing_signature'))
}

function testTrustedSignedCanInstall(): void {
  const decision = evaluateProviderProductionGate({
    manifest: signed(),
    sourceUrl: 'https://example.com/manifest.json',
    trustedPublishers: [trustedPublisher],
    artifactContentByPath: { 'provider.bundle.js': bundle }
  })
  assert.equal(decision.productionInstallAllowed, true)
  assert.equal(decision.trustLevel, 'trusted_signed')
}

function testTamperAndPermissionBlock(): void {
  const badPermission = signed({
    ...manifest(),
    permissions: [{ name: 'shell' as any, reason: 'bad' }]
  })
  const denied = evaluateProviderProductionGate({
    manifest: badPermission,
    sourceUrl: 'https://example.com/manifest.json',
    trustedPublishers: [trustedPublisher],
    artifactContentByPath: { 'provider.bundle.js': bundle }
  })
  assert.equal(denied.trustLevel, 'blocked')
  assert.ok(denied.reasonCodes.includes('provider.security.permission_denied'))

  const mismatched = evaluateProviderProductionGate({
    manifest: signed(),
    sourceUrl: 'https://example.com/manifest.json',
    trustedPublishers: [trustedPublisher],
    artifactContentByPath: { 'provider.bundle.js': 'tampered' }
  })
  assert.equal(mismatched.trustLevel, 'blocked')
  assert.ok(mismatched.reasonCodes.includes('provider.security.artifact_hash_mismatch'))
}

function testHttpIsBlockedForProduction(): void {
  const decision = evaluateProviderProductionGate({
    manifest: signed(),
    sourceUrl: 'http://example.com/manifest.json',
    trustedPublishers: [trustedPublisher],
    artifactContentByPath: { 'provider.bundle.js': bundle }
  })
  assert.equal(decision.productionInstallAllowed, false)
  assert.equal(decision.trustLevel, 'blocked')
  assert.ok(decision.reasonCodes.includes('provider.security.insecure_transport'))
}

function main(): void {
  testMissingSignatureIsDebugOnly()
  testTrustedSignedCanInstall()
  testTamperAndPermissionBlock()
  testHttpIsBlockedForProduction()
  console.log('provider production gate mock tests passed')
}

main()
