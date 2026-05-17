import * as assert from 'node:assert/strict'
import { exportDiagnosticsRecord } from './diagnostics-export'
import type { DiagnosticsRecordView } from './diagnostics-types'

const baseRecord: DiagnosticsRecordView = {
  recordId: 'runtime:run-abc',
  source: 'runtime',
  sourcePartitionId: 'runtime:run-abc:2026',
  runId: 'run-abc',
  contactHash: 'ch_abcdef123456',
  appType: 'wechat',
  finalAction: 'draft_created',
  createdAt: '2026-05-17T00:00:00.000Z',
  timeline: [
    {
      capability: 'intent',
      source: 'runtime',
      status: 'ok',
      summary: 'primaryIntentId=after_sales',
      detail: { type: 'intent', primaryIntentId: 'after_sales' }
    }
  ],
  redaction: {
    status: 'passed',
    blockedTypes: [],
    omittedFieldPaths: [],
    unknownFieldCount: 0,
    checkedAt: '2026-05-17T00:00:00.000Z'
  },
  relatedSources: []
}

const blocked = exportDiagnosticsRecord(
  {
    ...baseRecord,
    redaction: {
      ...baseRecord.redaction,
      status: 'blocked',
      blockedTypes: ['base64'],
      omittedFieldPaths: ['metadata.imageBase64']
    }
  },
  'json'
)
assert.equal(blocked.ok, false)
if (!blocked.ok) assert.equal(blocked.errorCode, 'export_contains_sensitive_field')

const json = exportDiagnosticsRecord(baseRecord, 'json', () => new Date('2026-05-17T00:00:00.000Z'))
assert.equal(json.ok, true)
if (json.ok) {
  assert.equal(/data:image\/|[A-Za-z0-9+/]{200,}|user@example\.com|Bearer\s+|\/workspace\//.test(json.content), false)
  assert.ok(json.content.includes('ch_abcde...'))
}

const markdown = exportDiagnosticsRecord(baseRecord, 'markdown')
assert.equal(markdown.ok, true)
if (markdown.ok) assert.equal(markdown.content.includes('/workspace/'), false)

const cachedPlaintextContactHash = exportDiagnosticsRecord(
  {
    ...baseRecord,
    contactHash: 'AliceBob'
  },
  'json'
)
assert.equal(cachedPlaintextContactHash.ok, false)
if (!cachedPlaintextContactHash.ok) {
  assert.equal(cachedPlaintextContactHash.errorCode, 'export_contains_sensitive_field')
  assert.deepEqual(cachedPlaintextContactHash.blockedTypes, ['plaintext_contact'])
  assert.deepEqual(cachedPlaintextContactHash.omittedFieldPaths, ['contactHash'])
}

const cachedPlaintextDetailHash = exportDiagnosticsRecord(
  {
    ...baseRecord,
    timeline: [
      {
        capability: 'customer_memory',
        source: 'runtime',
        status: 'ok',
        summary: 'contactHash=AliceBob',
        detail: {
          type: 'customer_memory',
          contactKeyHash: 'AliceBob'
        }
      }
    ]
  },
  'markdown'
)
assert.equal(cachedPlaintextDetailHash.ok, false)
if (!cachedPlaintextDetailHash.ok) {
  assert.equal(cachedPlaintextDetailHash.errorCode, 'export_contains_sensitive_field')
  assert.deepEqual(cachedPlaintextDetailHash.blockedTypes, ['plaintext_contact'])
  assert.deepEqual(cachedPlaintextDetailHash.omittedFieldPaths, [
    'timeline[0].detail.contactKeyHash'
  ])
}

console.log('diagnostics-export mock tests passed')
