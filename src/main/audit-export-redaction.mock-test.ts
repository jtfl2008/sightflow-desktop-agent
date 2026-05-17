import * as assert from 'node:assert/strict'
import { AuditRecord } from './audit-types'
import { AuditStore } from './audit-store'

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

function main(): void {
  testCustomerMemoryExportRedaction()
  console.log('audit export redaction mock tests passed')
}

main()
