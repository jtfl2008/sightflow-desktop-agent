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

function main(): void {
  testRecentRecordsSurviveStoreReload()
  testMaxRecordsIsBounded()
  testExportsRedactSecretsAndClipboardHistory()
  console.log('audit store mock tests passed')
}

main()
