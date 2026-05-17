import * as assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { InstalledProviderInfo, ProviderBundleManifest } from '../provider-bundle'
import {
  canonicalizeProviderManifestForSignature,
  SecureProviderBundleManifest,
  sha256Hex
} from './provider-manifest-security'
import { evaluateProviderProductionGate } from './provider-production-gate'
import {
  ProviderLifecycleStore,
  ProviderLifecycleStoreShape
} from './provider-lifecycle-store'
import type { TrustedPublisherRecord } from './provider-security-types'
import {
  ProviderRecoverySettings,
  reconcileProviderLifecycleWithSettings
} from './provider-recovery-reconciliation'

interface RecoveryFixtureCase {
  id: string
  settingsBefore: {
    chatProvider: {
      installed: { id: string; version: string } | null
      manifestUrlOrigin?: string | null
      manifestUrlHasRedactedQuery?: boolean
    }
  }
  providerLifecycleBefore: ProviderLifecycleStoreShape
  expectedAfter: {
    decision: string
    productionVisible: boolean
    activeProviderId: string
    activeVersion?: string
    reasonCodes: string[]
  }
}

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

class MemorySettingsStore {
  constructor(public value: ProviderRecoverySettings) {}

  get store(): ProviderRecoverySettings {
    return this.value
  }

  set(value: ProviderRecoverySettings): void {
    this.value = value
  }
}

class MemoryAuditStore {
  records: unknown[] = []

  record(value: unknown): any {
    this.records.push(value)
    return value
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
const revokedPublisher: TrustedPublisherRecord = {
  ...trustedPublisher,
  publisherId: 'revoked',
  revokedAt: '2026-05-17T00:00:00.000Z'
}
const bundle = 'export function createProvider() { return { run: async function* () {} } }'

function readFixtureCases(): RecoveryFixtureCase[] {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'fixtures/provider-recovery/crash-injection-index.json'), 'utf8')
  ).cases
}

function installed(id: string, version: string): InstalledProviderInfo {
  return {
    id,
    name: id,
    version,
    entryFile: `/redacted/providers/${id}/${version}/provider.bundle.js`,
    installedAt: '2026-05-17T00:00:00.000Z'
  }
}

function baseManifest(id: string, version: string): SecureProviderBundleManifest {
  return {
    apiVersion: 1,
    id,
    name: id,
    version,
    entry: 'provider.bundle.js',
    moduleType: 'module',
    capabilities: ['chat'],
    configSchema: { type: 'object', properties: {} },
    security: {
      manifestVersion: '1.2',
      publisherId: id === 'revoked-provider' ? 'revoked' : 'official',
      keyId: 'k1',
      signatureAlgorithm: 'ed25519',
      signature: '',
      signedAt: '2026-05-17T00:00:00.000Z',
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

function signed(input: SecureProviderBundleManifest): SecureProviderBundleManifest {
  return {
    ...input,
    security: {
      ...input.security!,
      signature: sign(null, Buffer.from(canonicalizeProviderManifestForSignature(input)), privateKey).toString('base64')
    }
  }
}

function manifestFor(id: string, version: string): ProviderBundleManifest | null {
  if (id === 'missing-provider') return null
  if (id === 'unsigned-provider') {
    const manifest = baseManifest(id, version)
    delete manifest.security
    return manifest
  }
  if (id === 'debug-provider') {
    return signed({
      ...baseManifest(id, version),
      security: {
        ...baseManifest(id, version).security!,
        publisherId: 'unknown'
      }
    })
  }
  if (id === 'tampered-provider') {
    const manifest = signed(baseManifest(id, version))
    return { ...manifest, name: 'tampered after signing' }
  }
  if (id === 'blocked-provider') {
    return signed({
      ...baseManifest(id, version),
      permissions: [{ name: 'shell' as any, reason: 'denied' }]
    })
  }
  if (id === 'trusted-provider' && version === '2.0.0') {
    return signed({
      ...baseManifest(id, version),
      permissions: [{ name: 'shell' as any, reason: 'denied' }]
    })
  }
  return signed(baseManifest(id, version))
}

function settingsFromFixture(item: RecoveryFixtureCase): ProviderRecoverySettings {
  const rawInstalled = item.settingsBefore.chatProvider.installed
  const manifestUrlOrigin = item.settingsBefore.chatProvider.manifestUrlOrigin || ''
  return {
    chatProvider: {
      manifestUrl: item.settingsBefore.chatProvider.manifestUrlHasRedactedQuery
        ? `${manifestUrlOrigin}/manifest.json?token=redacted`
        : manifestUrlOrigin
          ? `${manifestUrlOrigin}/manifest.json`
          : '',
      installed: rawInstalled ? installed(rawInstalled.id, rawInstalled.version) : null,
      previousInstalled: null,
      config: {}
    }
  }
}

async function runCase(item: RecoveryFixtureCase): Promise<void> {
  const settingsStore = new MemorySettingsStore(settingsFromFixture(item))
  const auditStore = new MemoryAuditStore()
  const lifecycleStore = new ProviderLifecycleStore({
    backend: new MemoryLifecycleBackend(item.providerLifecycleBefore),
    now: () => new Date('2026-05-17T12:00:00.000Z')
  })
  const result = await reconcileProviderLifecycleWithSettings({
    settings: settingsStore.store,
    settingsStore,
    providerLifecycleStore: lifecycleStore,
    auditStore,
    loadInstalledProviderManifest: async (candidate) => manifestFor(candidate.id, candidate.version),
    loadLifecycleInstalledProvider: async (providerId, version) => {
      const manifest = manifestFor(providerId, version)
      if (!manifest) return null
      return {
        installed: installed(providerId, version),
        manifest,
        manifestPath: `providers/${providerId}/${version}/manifest.json`
      }
    },
    evaluateInstalledProviderGate: async (candidate, manifest) =>
      evaluateProviderProductionGate({
        manifest,
        sourceUrl: 'https://fixtures.local/manifest.json',
        trustedPublishers: [trustedPublisher, revokedPublisher],
        artifactContentByPath: {
          'provider.bundle.js': candidate.id === 'hash-mismatch-provider' ? 'tampered' : bundle
        }
      }),
    now: () => new Date('2026-05-17T12:00:00.000Z')
  })

  assert.equal(result.decision, item.expectedAfter.decision, item.id)
  assert.equal(result.productionVisible, item.expectedAfter.productionVisible, item.id)
  assert.equal(result.activeProviderId, item.expectedAfter.activeProviderId, item.id)
  assert.equal(result.activeVersion, item.expectedAfter.activeVersion, item.id)
  for (const code of item.expectedAfter.reasonCodes) {
    assert.equal(result.reasonCodes.includes(code), true, `${item.id} missing ${code}`)
  }
  assert.equal(auditStore.records.length, 1, item.id)
  if (!item.expectedAfter.productionVisible) {
    assert.equal(settingsStore.store.chatProvider.installed, null, item.id)
  }
}

async function main(): Promise<void> {
  for (const item of readFixtureCases()) {
    await runCase(item)
  }
  console.log('provider recovery reconciliation mock tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
