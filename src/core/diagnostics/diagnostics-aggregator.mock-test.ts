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

console.log('diagnostics-aggregator mock tests passed')
