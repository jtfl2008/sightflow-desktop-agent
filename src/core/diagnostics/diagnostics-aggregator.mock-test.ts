import * as assert from 'node:assert/strict'
import { queryDiagnostics } from './diagnostics-aggregator'
import type { DiagnosticsSourceAdapter } from './diagnostics-types'

const runtimeAdapter: DiagnosticsSourceAdapter = {
  source: 'runtime',
  async query() {
    return [
      {
        source: 'runtime',
        sourceRecordId: 'runtime-1',
        createdAt: '2026-05-17T00:00:00.000Z',
        raw: {
          id: 'runtime-1',
          action: 'draft.created',
          metadata: {
            source: 'runtime',
            runId: 'run-abc',
            contactKeyHash: 'ch_abcdef12',
            primaryIntentId: 'after_sales',
            routeAction: 'run_provider_requires_review'
          }
        }
      }
    ]
  }
}

const debugAdapter: DiagnosticsSourceAdapter = {
  source: 'debug_console',
  async query() {
    return [
      {
        source: 'debug_console',
        sourceRecordId: 'debug-1',
        createdAt: '2026-05-17T00:01:00.000Z',
        raw: { runId: 'run-abc', providerId: 'debug_provider' }
      }
    ]
  }
}

const redactionBlockedAdapter: DiagnosticsSourceAdapter = {
  source: 'runtime',
  async query() {
    return [
      {
        source: 'runtime',
        sourceRecordId: 'runtime-secret',
        createdAt: '2026-05-17T00:02:00.000Z',
        raw: {
          id: 'runtime-secret',
          runId: 'run-secret',
          action: 'provider.error',
          message: 'Bearer secret-token',
          reason: 'Email user@example.com full chat: hello there',
          metadata: {
            providerId: 'provider-secret',
            contactHash: 'Alice Smith',
            contactKeyHash: 'ch_abcdef123456',
            webhookBody: {
              response: 'plain webhook body'
            }
          }
        }
      }
    ]
  }
}

async function main(): Promise<void> {
  const runtimeOnly = await queryDiagnostics([runtimeAdapter, debugAdapter], {
    source: 'runtime',
    runId: 'run-abc'
  })
  assert.equal(runtimeOnly.ok, true)
  if (runtimeOnly.ok) {
    assert.equal(runtimeOnly.records.length, 1)
    assert.equal(runtimeOnly.records[0].source, 'runtime')
    assert.equal(runtimeOnly.records[0].relatedSources.length, 0)
    assert.equal(runtimeOnly.records[0].timeline.length, 9)
    assert.equal(runtimeOnly.records[0].timeline.find((node) => node.capability === 'vision')?.status, 'not_recorded')
  }

  const related = await queryDiagnostics([runtimeAdapter, debugAdapter], {
    source: 'runtime',
    runId: 'run-abc',
    includeRelatedSources: true
  })
  assert.equal(related.ok, true)
  if (related.ok) {
    assert.equal(related.records[0].relatedSources[0].source, 'debug_console')
    assert.equal(related.records[0].relatedSources[0].count, 1)
  }

  const redactionBlocked = await queryDiagnostics([redactionBlockedAdapter], {
    source: 'runtime',
    runId: 'run-secret'
  })
  assert.equal(redactionBlocked.ok, true)
  if (redactionBlocked.ok) {
    const record = redactionBlocked.records[0]
    assert.equal(record.redaction.status, 'blocked')
    assert.equal(record.contactHash, undefined)
    assert.equal(record.primaryIntentId, undefined)
    assert.equal(record.routeAction, undefined)
    assert.equal(record.topErrorCode, undefined)
    assert.equal(record.timeline.length, 9)
    const serializedTimeline = JSON.stringify(record.timeline)
    assert.equal(/Bearer secret-token|user@example\.com|full chat|Alice Smith|plain webhook body|provider-secret/.test(serializedTimeline), false)
    for (const node of record.timeline) {
      assert.equal(node.status, 'blocked')
      assert.equal(node.summary, 'redaction_blocked')
      assert.equal(Object.keys(node.detail).length, 1)
      assert.equal(node.detail.type, node.capability)
    }
  }

  console.log('diagnostics-aggregator mock tests passed')
}

void main()
