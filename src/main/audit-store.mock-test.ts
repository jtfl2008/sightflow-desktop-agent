import * as assert from 'node:assert/strict'
import { AuditRecord } from './audit-types'
import { AuditStore } from './audit-store'

class MemoryAuditBackend {
  private records: AuditRecord[]

  constructor(initialRecords: AuditRecord[] = []) {
    this.records = initialRecords
  }

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
  return new Date('2026-05-17T07:30:00.000Z')
}

function testRecentRecordsSurviveStoreReload(): void {
  const backend = new MemoryAuditBackend()
  const firstStore = new AuditStore({ backend, maxRecords: 3, now: fixedNow })
  firstStore.record({ category: 'engine', action: 'started' })
  firstStore.record({ category: 'layout', action: 'strategy_selected' })

  const reloadedStore = new AuditStore({ backend, maxRecords: 3, now: fixedNow })
  const recent = reloadedStore.getRecent()

  assert.equal(recent.length, 2)
  assert.equal(recent[0].category, 'layout')
  assert.equal(recent[1].category, 'engine')
}

function testMaxRecordsIsBounded(): void {
  const store = new AuditStore({ backend: new MemoryAuditBackend(), maxRecords: 2, now: fixedNow })
  store.record({ category: 'engine', action: 'one' })
  store.record({ category: 'provider', action: 'two' })
  store.record({ category: 'message', action: 'three' })

  assert.deepEqual(
    store.getRecent().map((record) => record.action),
    ['three', 'two']
  )
}

function testExportsRedactSecretsAndClipboardHistory(): void {
  const store = new AuditStore({ backend: new MemoryAuditBackend(), now: fixedNow })
  store.record({
    category: 'provider',
    action: 'request',
    metadata: {
      apiKey: 'sk-live',
      providerToken: 'provider-secret',
      nested: {
        Authorization: 'Bearer abc',
        clipboardHistory: ['copied text'],
        safeValue: 'visible'
      },
      screenshot: 'data:image/png;base64,abcdef'
    }
  })

  const json = store.exportJson()
  const markdown = store.exportMarkdown()

  assert.equal(json.includes('sk-live'), false)
  assert.equal(json.includes('provider-secret'), false)
  assert.equal(json.includes('Bearer abc'), false)
  assert.equal(json.includes('copied text'), false)
  assert.equal(json.includes('data:image/png'), false)
  assert.equal(json.includes('visible'), false)
  assert.equal(json.includes('unknown_nested_object'), true)
  assert.equal(json.includes('"unknownFieldCount": 1'), true)
  assert.equal(json.includes('"records": []'), true)
  assert.equal(markdown.includes('sk-live'), false)
  assert.equal(markdown.includes('copied text'), false)
  assert.equal(markdown.includes('Export blocked'), true)
}

function testRawBackendSourceSummaryExportRedaction(): void {
  const rawText = 'PRIVATE sourceSummary rawText from legacy backend'
  const store = new AuditStore({
    backend: new MemoryAuditBackend([
      {
        id: 'raw-source-summary',
        category: 'provider',
        action: 'customer_profile.injected',
        severity: 'info',
        occurredAt: fixedNow().toISOString(),
        metadata: {
          customerProfile: {
            profileId: 'p1',
            contactKeyHash: 'abcdef123456',
            sourceSummary: [
              {
                fieldPath: 'preferenceNotes',
                source: 'user_entered',
                confirmedByUser: true,
                auditId: 'a1',
                rawText
              }
            ]
          }
        }
      }
    ]),
    now: fixedNow
  })

  const json = store.exportJson()
  const markdown = store.exportMarkdown()
  const parsed = JSON.parse(json)

  assert.equal(json.includes(rawText), false)
  assert.equal(markdown.includes(rawText), false)
  assert.equal(json.includes('"fieldPath": "preferenceNotes"'), true)
  assert.equal(markdown.includes('"fieldPath": "preferenceNotes"'), true)
  assert.equal(parsed.redaction.status, 'blocked')
  assert.ok(parsed.redaction.blockedTypes.includes('full_profile'))
  assert.ok(
    parsed.redaction.omittedFieldPaths.includes(
      'records[0].metadata.customerProfile.sourceSummary[0].rawText'
    )
  )
}

function testRawBackendCustomerProfileScalarExportRedaction(): void {
  const favoriteColor = 'PRIVATE profile note not caught by generic scanners'
  const preferenceNotes = 'ordinary unschematized profile scalar'
  const store = new AuditStore({
    backend: new MemoryAuditBackend([
      {
        id: 'raw-profile-scalar',
        category: 'provider',
        action: 'customer_profile.injected',
        severity: 'info',
        occurredAt: fixedNow().toISOString(),
        metadata: {
          customerProfile: {
            profileId: 'p2',
            contactKeyHash: 'abcdef123456',
            injectedFieldPaths: ['preferenceNotes'],
            safetyHintApplied: true,
            favoriteColor,
            preferenceNotes,
            sourceSummary: [
              {
                fieldPath: 'preferenceNotes',
                source: 'user_entered',
                confirmedByUser: true,
                auditId: 'a2'
              }
            ]
          }
        }
      }
    ]),
    now: fixedNow
  })

  const json = store.exportJson()
  const markdown = store.exportMarkdown()
  const parsed = JSON.parse(json)

  assert.equal(json.includes(favoriteColor), false)
  assert.equal(markdown.includes(favoriteColor), false)
  assert.equal(json.includes(preferenceNotes), false)
  assert.equal(markdown.includes(preferenceNotes), false)
  assert.equal(json.includes('abcdef123456'), true)
  assert.equal(markdown.includes('abcdef123456'), true)
  assert.equal(parsed.redaction.status, 'blocked')
  assert.equal(parsed.redaction.unknownFieldCount, 0)
  assert.ok(parsed.redaction.blockedTypes.includes('full_profile'))
  assert.ok(
    parsed.redaction.omittedFieldPaths.includes('records[0].metadata.customerProfile.favoriteColor')
  )
  assert.ok(
    parsed.redaction.omittedFieldPaths.includes(
      'records[0].metadata.customerProfile.preferenceNotes'
    )
  )
}

function testRedactionExportSummaryStrictExportRedaction(): void {
  const privateNote = 'PRIVATE provider lifecycle note hidden in redaction summary'
  const nestedArrayNote = 'nested blocked type object hidden in array'
  const store = new AuditStore({
    backend: new MemoryAuditBackend([
      {
        id: 'raw-redaction-summary',
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

function testRedactionExportSummaryArrayScalarStrictExportRedaction(): void {
  const rawNote = 'pending original customer note ordinary private text'
  const store = new AuditStore({
    backend: new MemoryAuditBackend([
      {
        id: 'raw-redaction-summary-scalars',
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

function main(): void {
  testRecentRecordsSurviveStoreReload()
  testMaxRecordsIsBounded()
  testExportsRedactSecretsAndClipboardHistory()
  testRawBackendSourceSummaryExportRedaction()
  testRawBackendCustomerProfileScalarExportRedaction()
  testRedactionExportSummaryStrictExportRedaction()
  testRedactionExportSummaryArrayScalarStrictExportRedaction()
  console.log('audit store mock tests passed')
}

main()
