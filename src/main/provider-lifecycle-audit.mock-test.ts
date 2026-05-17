import * as assert from 'node:assert/strict'
import { AuditRecord } from './audit-types'
import { AuditStore } from './audit-store'
import { recordProviderLifecycleAudit } from './provider-lifecycle-audit'

class MemoryAuditBackend {
  private records: AuditRecord[] = []

  get(key: 'records'): AuditRecord[] {
    assert.equal(key, 'records')
    return this.records
  }

  set(key: 'records', value: AuditRecord[]): void {
    assert.equal(key, 'records')
    this.records = value
  }
}

function fixedNow(): Date {
  return new Date('2026-05-17T09:30:00.000Z')
}

function testProviderLifecycleAuditRedaction(): void {
  const store = new AuditStore({ backend: new MemoryAuditBackend(), now: fixedNow })
  for (const action of ['provider_install', 'provider_update', 'provider_rollback'] as const) {
    recordProviderLifecycleAudit(store, {
      action,
      success: action !== 'provider_update',
      manifestUrl: 'https://providers.example/manifest.json?token=super-secret-token',
      installed: {
        id: 'official-provider',
        name: 'Official Provider',
        version: '1.0.0',
        entryFile: '/private/provider.bundle.js',
        installedAt: fixedNow().toISOString()
      },
      previousInstalled: {
        id: 'previous-provider',
        name: 'Previous Provider',
        version: '0.9.0',
        entryFile: '/private/previous.bundle.js',
        installedAt: fixedNow().toISOString()
      },
      manifest: {
        apiVersion: 1,
        id: 'official-provider',
        name: 'Official Provider',
        version: '1.0.0',
        entry: 'provider.bundle.js',
        capabilities: ['chat'],
        configSchema: {
          type: 'object',
          properties: {
            apiKey: { type: 'password', title: 'API Key', default: 'should-not-export' }
          }
        }
      },
      gate: {
        providerId: 'official-provider',
        version: '1.0.0',
        trustLevel: 'trusted_signed',
        productionInstallAllowed: true,
        debugRunAllowed: true,
        reasonCodes: [],
        deniedPermissionNames: [],
        artifactHashes: { 'provider.bundle.js': 'abcdef' },
        signatureStatus: 'valid'
      },
      error: action === 'provider_update' ? 'blocked because token=super-secret-token' : undefined
    })
  }

  const records = store.getRecent(10)
  assert.equal(records.length, 3)
  assert.deepEqual(
    records.map((record) => record.action),
    ['provider_rollback', 'provider_update', 'provider_install']
  )

  const exported = store.exportJson()
  const parsed = JSON.parse(exported)
  assert.equal(exported.includes('should-not-export'), false)
  assert.equal(exported.includes('super-secret-token'), false)
  assert.equal(exported.includes('/private/provider.bundle.js'), false)
  assert.equal(exported.includes('provider_install'), true)
  assert.equal(exported.includes('provider_update'), true)
  assert.equal(exported.includes('provider_rollback'), true)
  assert.equal(exported.includes('trusted_signed'), true)
  assert.equal(exported.includes('provider.bundle.js'), true)
  assert.ok(
    parsed.records.every((record: any) => record.metadata.redactionExportSummary.status === 'blocked')
  )
  assert.ok(
    parsed.records.every((record: any) =>
      record.metadata.redactionExportSummary.blockedTypes.includes('provider_config_values')
    )
  )
  assert.ok(
    parsed.records.some((record: any) =>
      record.metadata.redactionExportSummary.omittedFieldPaths.includes('manifestUrl.search')
    )
  )
}

function main(): void {
  testProviderLifecycleAuditRedaction()
  console.log('provider lifecycle audit mock tests passed')
}

main()
