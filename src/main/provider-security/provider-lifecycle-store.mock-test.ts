import * as assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import type { InstalledProviderInfo, ProviderBundleManifest } from '../provider-bundle'
import {
  canonicalizeProviderManifestForSignature,
  SecureProviderBundleManifest,
  sha256Hex
} from './provider-manifest-security'
import { evaluateProviderProductionGate } from './provider-production-gate'
import {
  ProviderLifecycleCandidate,
  ProviderLifecycleStore,
  ProviderLifecycleStoreShape
} from './provider-lifecycle-store'
import type { TrustedPublisherRecord } from './provider-security-types'

class MemoryLifecycleBackend {
  constructor(private state?: ProviderLifecycleStoreShape) {}

  get(key: 'providerLifecycle'): ProviderLifecycleStoreShape | undefined {
    assert.equal(key, 'providerLifecycle')
    return this.state
  }

  set(key: 'providerLifecycle', value: ProviderLifecycleStoreShape): void {
    assert.equal(key, 'providerLifecycle')
    this.state = value
  }
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
const trustedPublisher: TrustedPublisherRecord = {
  publisherId: 'official',
  displayName: 'Official',
  publicKeyPem,
  keyId: 'k1',
  trustSource: 'builtin',
  trustedAt: '2026-05-17T00:00:00.000Z'
}

function fixedNow(): Date {
  return new Date('2026-05-17T12:00:00.000Z')
}

function bundle(version: string): string {
  return `export const version = ${JSON.stringify(version)}`
}

function manifest(version: string): SecureProviderBundleManifest {
  const content = bundle(version)
  return {
    apiVersion: 1,
    id: 'official-provider',
    name: 'Official Provider',
    version,
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
      signedAt: '2026-05-17T00:00:00.000Z',
      canonicalization: 'jcs-v1'
    },
    artifacts: [
      {
        path: 'provider.bundle.js',
        sha256: sha256Hex(content),
        sizeBytes: Buffer.byteLength(content),
        contentType: 'application/javascript'
      }
    ],
    permissions: [{ name: 'debug_log', reason: 'debug' }]
  }
}

function signed(input: SecureProviderBundleManifest): SecureProviderBundleManifest {
  return {
    ...input,
    security: {
      ...input.security!,
      signature: sign(null, Buffer.from(canonicalizeProviderManifestForSignature(input)), privateKey).toString('base64')
    }
  }
}

function installed(version: string): InstalledProviderInfo {
  return {
    id: 'official-provider',
    name: 'Official Provider',
    version,
    entryFile: `/private/providers/official-provider/${version}/provider.bundle.js`,
    installedAt: `2026-05-17T0${version === '1.0.0' ? '1' : '2'}:00:00.000Z`
  }
}

function candidate(version: string, content = bundle(version)): ProviderLifecycleCandidate {
  const secureManifest = signed(manifest(version))
  return {
    installed: installed(version),
    manifest: secureManifest as ProviderBundleManifest,
    manifestPath: `providers/official-provider/${version}/manifest.json`,
    gate: evaluateProviderProductionGate({
      manifest: secureManifest,
      sourceUrl: 'https://providers.example/manifest.json',
      trustedPublishers: [trustedPublisher],
      artifactContentByPath: { 'provider.bundle.js': content }
    })
  }
}

function testInstallAndUpdatePointers(): void {
  const store = new ProviderLifecycleStore({
    backend: new MemoryLifecycleBackend(),
    now: fixedNow
  })

  const install = store.commitInstallOrUpdate('install', candidate('1.0.0'))
  assert.equal(install.ok, true)
  assert.equal(install.activePointer?.activeVersion, '1.0.0')
  assert.equal(install.activePointer?.previousVersion, undefined)
  assert.equal(install.activePointer?.rollbackEligible, false)
  assert.equal(
    install.activePointer?.rollbackIneligibleReason,
    'provider.lifecycle.no_previous_version'
  )

  const update = store.commitInstallOrUpdate('update', candidate('2.0.0'))
  assert.equal(update.ok, true)
  assert.equal(update.activePointer?.activeVersion, '2.0.0')
  assert.equal(update.activePointer?.previousVersion, '1.0.0')
  assert.equal(update.activePointer?.rollbackEligible, true)

  const state = store.getState()
  assert.equal(state.versionsByProviderId['official-provider']['1.0.0'].lifecycleState, 'previous')
  assert.equal(state.versionsByProviderId['official-provider']['2.0.0'].lifecycleState, 'active')
}

function testFailedUpdateDoesNotMoveActivePointer(): void {
  const store = new ProviderLifecycleStore({
    backend: new MemoryLifecycleBackend(),
    now: fixedNow
  })
  store.commitInstallOrUpdate('install', candidate('1.0.0'))

  const failed = store.commitInstallOrUpdate('update', candidate('2.0.0', 'tampered'))
  assert.equal(failed.ok, false)
  assert.ok(failed.reasonCodes.includes('provider.security.artifact_hash_mismatch'))
  assert.equal(store.getActivePointer('official-provider')?.activeVersion, '1.0.0')
  assert.equal(store.getState().versionsByProviderId['official-provider']['2.0.0'], undefined)
}

function testRollbackRequiresHistoricalMetadataAndGate(): void {
  const store = new ProviderLifecycleStore({
    backend: new MemoryLifecycleBackend({
      activePointersByProviderId: {
        'official-provider': {
          providerId: 'official-provider',
          activeVersion: '2.0.0',
          previousVersion: '1.0.0',
          rollbackEligible: false,
          rollbackIneligibleReason: 'provider.lifecycle.previous_version_missing_artifact_hashes',
          updatedAt: fixedNow().toISOString()
        }
      },
      versionsByProviderId: {
        'official-provider': {
          '2.0.0': {
            providerId: 'official-provider',
            version: '2.0.0',
            manifestPath: 'providers/official-provider/2.0.0/manifest.json',
            artifactHashes: { 'provider.bundle.js': sha256Hex(bundle('2.0.0')) },
            trustLevel: 'trusted_signed',
            lifecycleState: 'active'
          },
          '1.0.0': {
            providerId: 'official-provider',
            version: '1.0.0',
            manifestPath: 'providers/official-provider/1.0.0/manifest.json',
            trustLevel: 'trusted_signed',
            lifecycleState: 'previous'
          }
        }
      }
    }),
    now: fixedNow
  })

  const failed = store.rollback(candidate('1.0.0'))
  assert.equal(failed.ok, false)
  assert.deepEqual(failed.reasonCodes, [
    'provider.lifecycle.previous_version_missing_artifact_hashes'
  ])
  assert.equal(store.getActivePointer('official-provider')?.activeVersion, '2.0.0')
}

function testRollbackSuccessRechecksGateBeforePointerWrite(): void {
  const store = new ProviderLifecycleStore({
    backend: new MemoryLifecycleBackend(),
    now: fixedNow
  })
  store.commitInstallOrUpdate('install', candidate('1.0.0'))
  store.commitInstallOrUpdate('update', candidate('2.0.0'))

  const denied = store.rollback(candidate('1.0.0', 'tampered'))
  assert.equal(denied.ok, false)
  assert.ok(denied.reasonCodes.includes('provider.security.artifact_hash_mismatch'))
  assert.equal(store.getActivePointer('official-provider')?.activeVersion, '2.0.0')

  const rollback = store.rollback(candidate('1.0.0'))
  assert.equal(rollback.ok, true)
  assert.equal(rollback.activePointer?.activeVersion, '1.0.0')
  assert.equal(rollback.activePointer?.previousVersion, '2.0.0')
  assert.equal(rollback.activePointer?.rollbackEligible, true)
}

function main(): void {
  testInstallAndUpdatePointers()
  testFailedUpdateDoesNotMoveActivePointer()
  testRollbackRequiresHistoricalMetadataAndGate()
  testRollbackSuccessRechecksGateBeforePointerWrite()
  console.log('provider lifecycle store mock tests passed')
}

main()
