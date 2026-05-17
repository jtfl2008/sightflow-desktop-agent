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

class SeededMemoryAuditBackend {
  constructor(private records: AuditRecord[]) {}

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
  assert.ok(records.every((record) => record.source === 'provider_lifecycle'))
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
  assert.equal(exported.includes('provider_lifecycle'), true)
  assert.equal(exported.includes('trusted_signed'), true)
  assert.equal(exported.includes('provider.bundle.js'), true)
  assert.ok(
    parsed.records.every(
      (record: any) => record.metadata.redactionExportSummary.status === 'blocked'
    )
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

function testProviderLifecycleRedactionSummaryStrictExport(): void {
  const privateNote = 'PRIVATE provider lifecycle extra note'
  const nestedArrayNote = 'provider lifecycle nested array object'
  const store = new AuditStore({
    backend: new SeededMemoryAuditBackend([
      {
        id: 'provider-lifecycle-malformed-summary',
        category: 'provider',
        action: 'provider_install',
        severity: 'info',
        occurredAt: fixedNow().toISOString(),
        metadata: {
          redactionExportSummary: {
            status: 'passed',
            blockedTypes: [{ nested: nestedArrayNote }],
            omittedFieldPaths: [],
            unknownFieldCount: 0,
            checkedAt: fixedNow().toISOString(),
            extra: {
              note: privateNote
            }
          }
        }
      }
    ]),
    now: fixedNow
  })

  const json = store.exportJson()
  const markdown = store.exportMarkdown()
  const parsed = JSON.parse(json)

  assert.equal(json.includes(privateNote), false)
  assert.equal(markdown.includes(privateNote), false)
  assert.equal(json.includes(nestedArrayNote), false)
  assert.equal(markdown.includes(nestedArrayNote), false)
  assert.equal(parsed.blocked, true)
  assert.deepEqual(parsed.records, [])
  assert.equal(parsed.redaction.status, 'blocked')
  assert.equal(parsed.redaction.unknownFieldCount, 2)
  assert.ok(parsed.redaction.blockedTypes.includes('unknown_nested_object'))
  assert.ok(
    parsed.redaction.omittedFieldPaths.includes('records[0].metadata.redactionExportSummary.extra')
  )
  assert.ok(
    parsed.redaction.omittedFieldPaths.includes(
      'records[0].metadata.redactionExportSummary.blockedTypes[0]'
    )
  )
}

function testProviderLifecycleRedactionSummaryArrayScalarStrictExport(): void {
  const rawNote = 'pending original customer note ordinary private text'
  const store = new AuditStore({
    backend: new SeededMemoryAuditBackend([
      {
        id: 'provider-lifecycle-malformed-summary-scalars',
        category: 'provider',
        action: 'provider_install',
        severity: 'info',
        occurredAt: fixedNow().toISOString(),
        metadata: {
          redactionExportSummary: {
            status: 'blocked',
            blockedTypes: [rawNote],
            omittedFieldPaths: [rawNote],
            unknownFieldCount: 0,
            checkedAt: fixedNow().toISOString()
          }
        }
      }
    ]),
    now: fixedNow
  })

  const json = store.exportJson()
  const markdown = store.exportMarkdown()
  const parsed = JSON.parse(json)

  assert.equal(json.includes(rawNote), false)
  assert.equal(markdown.includes(rawNote), false)
  assert.equal(markdown.includes('Export blocked'), true)
  assert.equal(parsed.blocked, true)
  assert.deepEqual(parsed.records, [])
  assert.equal(parsed.redaction.status, 'blocked')
  assert.equal(parsed.redaction.unknownFieldCount, 2)
  assert.ok(parsed.redaction.blockedTypes.includes('unknown_nested_object'))
  assert.ok(
    parsed.redaction.omittedFieldPaths.includes(
      'records[0].metadata.redactionExportSummary.blockedTypes[0]'
    )
  )
  assert.ok(
    parsed.redaction.omittedFieldPaths.includes(
      'records[0].metadata.redactionExportSummary.omittedFieldPaths[0]'
    )
  )
}

function testProviderLifecycleRedactionSummaryCheckedAtStrictExport(): void {
  const rawNote = 'pending profile provider webhook ordinary private text'
  const store = new AuditStore({
    backend: new SeededMemoryAuditBackend([
      {
        id: 'provider-lifecycle-malformed-summary-checked-at',
        category: 'provider',
        action: 'provider_install',
        severity: 'info',
        occurredAt: fixedNow().toISOString(),
        metadata: {
          redactionExportSummary: {
            status: 'passed',
            blockedTypes: [],
            omittedFieldPaths: [],
            unknownFieldCount: 0,
            checkedAt: rawNote
          }
        }
      }
    ]),
    now: fixedNow
  })

  const json = store.exportJson()
  const markdown = store.exportMarkdown()
  const parsed = JSON.parse(json)

  assert.equal(json.includes(rawNote), false)
  assert.equal(markdown.includes(rawNote), false)
  assert.equal(markdown.includes('Export blocked'), true)
  assert.equal(parsed.blocked, true)
  assert.deepEqual(parsed.records, [])
  assert.equal(parsed.redaction.status, 'blocked')
  assert.equal(parsed.redaction.unknownFieldCount, 1)
  assert.ok(parsed.redaction.blockedTypes.includes('unknown_nested_object'))
  assert.ok(
    parsed.redaction.omittedFieldPaths.includes(
      'records[0].metadata.redactionExportSummary.checkedAt'
    )
  )
}

function main(): void {
  testProviderLifecycleAuditRedaction()
  testProviderLifecycleRedactionSummaryStrictExport()
  testProviderLifecycleRedactionSummaryArrayScalarStrictExport()
  testProviderLifecycleRedactionSummaryCheckedAtStrictExport()
  console.log('provider lifecycle audit mock tests passed')
}

main()
