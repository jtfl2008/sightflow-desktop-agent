import * as assert from 'node:assert/strict'
import { validateDiagnosticsQuery } from './diagnostics-contact-hash'

for (const contactHash of [
  'user@example.com',
  '+81 90 1234 5678',
  '山田太郎',
  'Bearer secret-token',
  'token=secret'
]) {
  const result = validateDiagnosticsQuery({ source: 'runtime', contactHash })
  assert.equal(result.ok, false)
  if ('errorCode' in result) assert.equal(result.errorCode, 'plaintext_contact_rejected')
}

for (const contactHash of ['ch_8f3a1234', 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890']) {
  const result = validateDiagnosticsQuery({ source: 'runtime', contactHash })
  assert.equal(result.ok, true)
}

assert.equal(validateDiagnosticsQuery({ source: 'runtime' }).ok, false)
assert.equal(validateDiagnosticsQuery({ source: 'runtime', runId: 'run-1234' }).ok, true)

console.log('diagnostics-contact-hash mock tests passed')
