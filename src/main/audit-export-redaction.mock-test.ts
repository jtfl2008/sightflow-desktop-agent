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
  return new Date('2026-05-17T08:40:00.000Z')
}

function testCustomerMemoryExportRedaction(): void {
  const store = new AuditStore({ backend: new MemoryAuditBackend(), now: fixedNow })
  store.record({
    category: 'provider',
    action: 'customer_profile.injected',
    metadata: {
      contactKey: 'wechat:Alice Phone 13800138000',
      pendingSuggestion: { rawText: 'Alice wants a discount and alice@example.com' },
      customerProfile: {
        profileId: 'p1',
        version: '2',
        contactKeyHash: 'abcdef123456',
        displayName: 'Alice',
        fields: {
          preferenceNotes: ['likes concise answers'],
          lastConfirmedSummary: 'full private summary'
        },
        injectedFieldPaths: ['preferenceNotes'],
        sourceSummary: [
          {
            fieldPath: 'preferenceNotes',
            source: 'user_entered',
            confirmedByUser: true,
            auditId: 'a1',
            rawText: 'do not export'
          }
        ],
        omittedReason: undefined,
        safetyHintApplied: true
      }
    }
  })

  const json = store.exportJson()
  const markdown = store.exportMarkdown()
  for (const exported of [json, markdown]) {
    assert.equal(exported.includes('Alice Phone'), false)
    assert.equal(exported.includes('alice@example.com'), false)
    assert.equal(exported.includes('likes concise answers'), false)
    assert.equal(exported.includes('full private summary'), false)
    assert.equal(exported.includes('do not export'), false)
    assert.equal(exported.includes('abcdef123456'), true)
    assert.equal(exported.includes('preferenceNotes'), true)
    assert.equal(exported.includes('safetyHintApplied'), true)
  }
}

function testForbiddenContentReturnsExportSummary(): void {
  const longBase64 = 'A'.repeat(220)
  const store = new AuditStore({
    backend: new MemoryAuditBackend([
      {
        id: 'raw-forbidden',
        category: 'provider',
        action: 'request',
        severity: 'warn',
        occurredAt: fixedNow().toISOString(),
        message:
          'Bearer secret-token alice@example.com 1380-0138-0000 full chat: customer private words',
        metadata: {
          webhookBody: { text: 'must not export' },
          providerConfig: { apiKey: 'sk-live-secret' },
          customerProfile: {
            profileId: 'p2',
            contactKeyHash: 'abcdef123456',
            fields: {
              preferenceNotes: ['private profile text']
            },
            injectedFieldPaths: ['preferenceNotes']
          },
          longBase64: longBase64,
          safeScalar: 'safe'
        }
      }
    ]),
    now: fixedNow
  })

  const json = store.exportJson()
  const parsed = JSON.parse(json)

  assert.equal(json.includes('secret-token'), false)
  assert.equal(json.includes('alice@example.com'), false)
  assert.equal(json.includes('1380-0138-0000'), false)
  assert.equal(json.includes('customer private words'), false)
  assert.equal(json.includes('must not export'), false)
  assert.equal(json.includes('sk-live-secret'), false)
  assert.equal(json.includes('private profile text'), false)
  assert.equal(json.includes(longBase64), false)
  assert.equal(json.includes('safe'), true)
  assert.equal(parsed.blocked, false)
  assert.equal(parsed.redaction.status, 'blocked')
  for (const type of [
    'secrets',
    'plaintext_contact',
    'full_chat',
    'webhook_body',
    'provider_config_values',
    'full_profile',
    'base64'
  ]) {
    assert.ok(parsed.redaction.blockedTypes.includes(type), `missing ${type}`)
  }
  assert.equal(parsed.redaction.unknownFieldCount, 0)
  assert.ok(parsed.redaction.omittedFieldPaths.includes('records[0].message'))
  assert.ok(parsed.redaction.omittedFieldPaths.includes('records[0].metadata.webhookBody'))
  assert.ok(parsed.redaction.omittedFieldPaths.includes('records[0].metadata.providerConfig'))
  assert.ok(parsed.redaction.omittedFieldPaths.includes('records[0].metadata.customerProfile.fields'))
}

function testRawBackendSourceSummaryExportRedaction(): void {
  const rawText = 'PRIVATE memory rawText Alice preference without generic detector'
  const pendingText = 'pending original customer note'
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
            profileId: 'p3',
            contactKeyHash: 'abcdef123456',
            sourceSummary: [
              {
                fieldPath: 'preferenceNotes',
                source: 'user_entered',
                confirmedByUser: true,
                auditId: 'a3',
                rawText,
                text: 'source text must not export',
                content: 'source content must not export',
                pending: pendingText
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
  const sourceSummary = parsed.records[0].metadata.customerProfile.sourceSummary[0]

  for (const exported of [json, markdown]) {
    assert.equal(exported.includes(rawText), false)
    assert.equal(exported.includes('source text must not export'), false)
    assert.equal(exported.includes('source content must not export'), false)
    assert.equal(exported.includes(pendingText), false)
    assert.equal(exported.includes('preferenceNotes'), true)
    assert.equal(exported.includes('user_entered'), true)
    assert.equal(exported.includes('a3'), true)
  }
  assert.deepEqual(Object.keys(sourceSummary).sort(), [
    'auditId',
    'confirmedByUser',
    'fieldPath',
    'source'
  ])
  assert.equal(parsed.blocked, false)
  assert.equal(parsed.redaction.status, 'blocked')
  assert.equal(parsed.redaction.unknownFieldCount, 0)
  assert.ok(parsed.redaction.blockedTypes.includes('full_profile'))
  assert.ok(
    parsed.redaction.omittedFieldPaths.includes(
      'records[0].metadata.customerProfile.sourceSummary[0].rawText'
    )
  )
  assert.ok(
    parsed.redaction.omittedFieldPaths.includes(
      'records[0].metadata.customerProfile.sourceSummary[0].pending'
    )
  )
}

function testRawBackendCustomerProfileScalarExportRedaction(): void {
  const favoriteColor = 'PRIVATE profile note not caught by generic scanners'
  const notes = 'ordinary profile scalar that must not leave raw backend export'
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
            profileId: 'p4',
            version: 3,
            contactKeyHash: 'abcdef123456',
            injectedFieldPaths: ['preferenceNotes'],
            expired: false,
            omittedReason: 'none',
            safetyHintApplied: true,
            favoriteColor,
            notes,
            preferenceNotes: 'plain private preference',
            sourceSummary: [
              {
                fieldPath: 'preferenceNotes',
                source: 'user_entered',
                confirmedByUser: true,
                auditId: 'a4'
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
  const profile = parsed.records[0].metadata.customerProfile

  for (const exported of [json, markdown]) {
    assert.equal(exported.includes(favoriteColor), false)
    assert.equal(exported.includes(notes), false)
    assert.equal(exported.includes('plain private preference'), false)
    assert.equal(exported.includes('abcdef123456'), true)
    assert.equal(exported.includes('safetyHintApplied'), true)
    assert.equal(exported.includes('preferenceNotes'), true)
  }
  assert.equal(profile.favoriteColor, undefined)
  assert.equal(profile.notes, undefined)
  assert.equal(profile.preferenceNotes, undefined)
  assert.equal(parsed.blocked, false)
  assert.equal(parsed.redaction.status, 'blocked')
  assert.equal(parsed.redaction.unknownFieldCount, 0)
  assert.ok(parsed.redaction.blockedTypes.includes('full_profile'))
  assert.ok(
    parsed.redaction.omittedFieldPaths.includes(
      'records[0].metadata.customerProfile.favoriteColor'
    )
  )
  assert.ok(
    parsed.redaction.omittedFieldPaths.includes('records[0].metadata.customerProfile.notes')
  )
  assert.ok(
    parsed.redaction.omittedFieldPaths.includes(
      'records[0].metadata.customerProfile.preferenceNotes'
    )
  )
}

function testUnknownNestedExportObjectBlocksRecords(): void {
  const store = new AuditStore({ backend: new MemoryAuditBackend(), now: fixedNow })
  store.record({
    category: 'engine',
    action: 'unknown_nested',
    metadata: {
      safeScalar: 'visible-safe',
      unexpectedNested: {
        safeLookingValue: 'must be blocked by strict DTO allowlist'
      }
    }
  })

  const json = store.exportJson()
  const markdown = store.exportMarkdown()
  const parsed = JSON.parse(json)

  assert.equal(json.includes('must be blocked by strict DTO allowlist'), false)
  assert.equal(json.includes('visible-safe'), false)
  assert.equal(markdown.includes('must be blocked by strict DTO allowlist'), false)
  assert.equal(markdown.includes('Export blocked'), true)
  assert.equal(parsed.blocked, true)
  assert.deepEqual(parsed.records, [])
  assert.equal(parsed.redaction.unknownFieldCount, 1)
  assert.ok(parsed.redaction.blockedTypes.includes('unknown_nested_object'))
  assert.ok(parsed.redaction.omittedFieldPaths.includes('records[0].metadata.unexpectedNested'))
}

function main(): void {
  testCustomerMemoryExportRedaction()
  testForbiddenContentReturnsExportSummary()
  testRawBackendSourceSummaryExportRedaction()
  testRawBackendCustomerProfileScalarExportRedaction()
  testUnknownNestedExportObjectBlocksRecords()
  console.log('audit export redaction mock tests passed')
}

main()
