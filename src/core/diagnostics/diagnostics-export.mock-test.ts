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

console.log('diagnostics-export mock tests passed')
