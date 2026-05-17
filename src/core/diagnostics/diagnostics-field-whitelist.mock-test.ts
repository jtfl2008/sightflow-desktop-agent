import * as assert from 'node:assert/strict'
import { whitelistDiagnosticsNodeDetail } from './diagnostics-field-whitelist'

const memory = whitelistDiagnosticsNodeDetail('customer_memory', {
  profileId: 'p1',
  version: 3,
  contactKeyHash: 'ch_abcdef12',
  injectedFieldPaths: ['preference.color'],
  omittedReason: 'contact_not_verified',
  customerProfile: { fields: { private: 'do not leak' } },
  displayName: 'Alice'
})

assert.equal(memory.type, 'customer_memory')
assert.equal(memory.profileId, 'p1')
assert.equal(memory.contactKeyHash, 'ch_abcdef12')
assert.deepEqual(memory.injectedFieldPaths, ['preference.color'])
assert.equal('customerProfile' in memory, false)
assert.equal('displayName' in memory, false)

const provider = whitelistDiagnosticsNodeDetail('provider', {
  providerId: 'signed_local',
  version: '1.0.0',
  trustLevel: 'trusted',
  decision: 'called',
  errorCode: 'provider_timeout',
  providerConfig: { apiKey: 'sk-test' },
  webhookBody: { text: 'full body' },
  screenshot: 'data:image/png;base64,aaaa'
})

assert.equal(provider.type, 'provider')
assert.equal(provider.providerId, 'signed_local')
assert.equal('providerConfig' in provider, false)
assert.equal('webhookBody' in provider, false)
assert.equal('screenshot' in provider, false)

const invalidMemoryHash = whitelistDiagnosticsNodeDetail('customer_memory', {
  contactKeyHash: 'Alice Smith'
})
assert.equal(invalidMemoryHash.type, 'customer_memory')
assert.equal(invalidMemoryHash.contactKeyHash, undefined)

const invalidVisionHash = whitelistDiagnosticsNodeDetail('vision', {
  sampleIdHash: 'sample from Alice'
})
assert.equal(invalidVisionHash.type, 'vision')
assert.equal(invalidVisionHash.sampleIdHash, undefined)

console.log('diagnostics-field-whitelist mock tests passed')
