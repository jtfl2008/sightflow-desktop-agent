import * as assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import type { SecureProviderBundleManifest } from './provider-manifest-security'
import { canonicalizeProviderManifestForSignature, sha256Hex } from './provider-manifest-security'
import { verifyProviderArtifacts } from './provider-artifact-verifier'
import { verifyProviderManifestSignature } from './provider-signature-verifier'
import type { TrustedPublisherRecord } from './provider-security-types'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString()

const trustedPublisher: TrustedPublisherRecord = {
  publisherId: 'sightflow',
  displayName: 'SightFlow',
  publicKeyPem,
  keyId: 'official-1',
  trustSource: 'builtin',
  trustedAt: new Date().toISOString()
}

function baseManifest(): SecureProviderBundleManifest {
  const bundle = 'export function createProvider() {}'
  return {
    apiVersion: 1,
    id: 'signed-provider',
    name: 'Signed Provider',
    version: '1.0.0',
    entry: 'provider.bundle.js',
    moduleType: 'module',
    capabilities: ['chat'],
    configSchema: { type: 'object', properties: {} },
    security: {
      manifestVersion: '1.2',
      publisherId: 'sightflow',
      keyId: 'official-1',
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
    permissions: [{ name: 'debug_log', reason: 'diagnostics' }]
  }
}

function signManifest(manifest: SecureProviderBundleManifest): SecureProviderBundleManifest {
  const payload = canonicalizeProviderManifestForSignature(manifest)
  return {
    ...manifest,
    security: {
      ...manifest.security!,
      signature: sign(null, Buffer.from(payload), privateKey).toString('base64')
    }
  }
}

function testMissingSignature(): void {
  const manifest = baseManifest()
  delete manifest.security
  const result = verifyProviderManifestSignature(manifest, [trustedPublisher])
  assert.equal(result.valid, false)
  assert.equal(result.code, 'provider.security.missing_signature')
}

function testTrustedPublisherValidSignature(): void {
  const manifest = signManifest(baseManifest())
  const result = verifyProviderManifestSignature(manifest, [trustedPublisher])
  assert.equal(result.valid, true)
  assert.equal(result.status, 'valid')
}

function testManifestTamperInvalidatesSignature(): void {
  const manifest = signManifest(baseManifest())
  const tampered = { ...manifest, version: '1.0.1' }
  const result = verifyProviderManifestSignature(tampered, [trustedPublisher])
  assert.equal(result.valid, false)
  assert.equal(result.code, 'provider.security.signature_invalid')
}

function testArtifactDigestMismatch(): void {
  const manifest = signManifest(baseManifest())
  const result = verifyProviderArtifacts(manifest, {
    'provider.bundle.js': 'tampered bundle'
  })
  assert.equal(result.valid, false)
  assert.equal(result.code, 'provider.security.artifact_hash_mismatch')
}

function testArtifactDigestPasses(): void {
  const manifest = signManifest(baseManifest())
  const result = verifyProviderArtifacts(manifest, {
    'provider.bundle.js': 'export function createProvider() {}'
  })
  assert.equal(result.valid, true)
  assert.equal(result.artifactHashes['provider.bundle.js'], manifest.artifacts?.[0].sha256)
}

function testEntryPathBoundaries(): void {
  const cases = [
    { entry: '../provider.bundle.js', code: 'provider.security.entry_path_escape' },
    { entry: '/tmp/provider.bundle.js', code: 'provider.security.entry_absolute_path' },
    { entry: 'data:text/javascript,alert(1)', code: 'provider.security.entry_unsupported_protocol' }
  ]

  for (const item of cases) {
    const manifest = signManifest({ ...baseManifest(), entry: item.entry })
    const result = verifyProviderArtifacts(manifest, {})
    assert.equal(result.valid, false)
    assert.equal(result.code, item.code)
  }
}

function main(): void {
  testMissingSignature()
  testTrustedPublisherValidSignature()
  testManifestTamperInvalidatesSignature()
  testArtifactDigestMismatch()
  testArtifactDigestPasses()
  testEntryPathBoundaries()
  console.log('provider security verifier mock tests passed')
}

main()
