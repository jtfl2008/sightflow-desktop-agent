import * as assert from 'node:assert/strict'
import { isDiagnosticsContactHash, validateDiagnosticsQuery } from './diagnostics-contact-hash'

for (const contactHash of [
  'user@example.com',
  '+81 90 1234 5678',
  '山田太郎',
  'Bearer secret-token',
  'token=secret',
  'AliceBob',
  'JohnDoe1',
  'customer1',
  'wechatid1'
]) {
  const result = validateDiagnosticsQuery({ source: 'runtime', contactHash })
  assert.equal(result.ok, false)
  if ('errorCode' in result) assert.equal(result.errorCode, 'plaintext_contact_rejected')
}

for (const contactHash of ['ch_8f3a1234', 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890']) {
  const result = validateDiagnosticsQuery({ source: 'runtime', contactHash })
  assert.equal(result.ok, true)
  assert.equal(isDiagnosticsContactHash(contactHash), true)
}

assert.equal(isDiagnosticsContactHash('Alice Smith'), false)
assert.equal(isDiagnosticsContactHash('AliceBob'), false)
assert.equal(isDiagnosticsContactHash('JohnDoe1'), false)
assert.equal(isDiagnosticsContactHash('customer1'), false)
assert.equal(isDiagnosticsContactHash('wechatid1'), false)
assert.equal(isDiagnosticsContactHash('abcdef12'), false)
assert.equal(isDiagnosticsContactHash('ch_abcd'), false)
assert.equal(isDiagnosticsContactHash('user@example.com'), false)
assert.equal(isDiagnosticsContactHash('山田太郎'), false)
assert.equal(validateDiagnosticsQuery({ source: 'runtime' }).ok, false)
assert.equal(validateDiagnosticsQuery({ source: 'runtime', runId: 'run-1234' }).ok, true)

console.log('diagnostics-contact-hash mock tests passed')
