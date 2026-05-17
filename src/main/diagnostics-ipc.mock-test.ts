import * as assert from 'node:assert/strict'
import { registerDiagnosticsIpc } from './diagnostics-ipc'
import { DiagnosticsStore } from './diagnostics-store'
import type { DiagnosticsSourceAdapter } from '../core/diagnostics/diagnostics-types'

const handlers = new Map<string, (_event: unknown, request: any) => Promise<unknown>>()
const fakeIpcMain = {
  handle(channel: string, handler: (_event: unknown, request: any) => Promise<unknown>) {
    handlers.set(channel, handler)
  }
}

const adapter: DiagnosticsSourceAdapter = {
  source: 'runtime',
  async query() {
    return []
  }
}

registerDiagnosticsIpc(fakeIpcMain as any, new DiagnosticsStore([adapter]))

const invalidSource = await handlers.get('diagnostics:query')?.(null, {
  source: 'invalid',
  runId: 'run-abc'
})
assert.deepEqual(invalidSource, {
  ok: false,
  errorCode: 'invalid_source',
  message: 'Invalid diagnostics source'
})

const plaintext = await handlers.get('diagnostics:query')?.(null, {
  source: 'runtime',
  contactHash: 'user@example.com'
})
assert.equal((plaintext as any).ok, false)
assert.equal((plaintext as any).errorCode, 'plaintext_contact_rejected')

console.log('diagnostics-ipc mock tests passed')
