import * as assert from 'node:assert/strict'
import { checkDiagnosticsRedaction } from './diagnostics-redaction-checker'

const result = checkDiagnosticsRedaction({
  rawScreenshot: 'present',
  imageBase64: 'data:image/png;base64,abcd',
  chatTranscript: 'full chat',
  currentContact: 'Alice',
  customerProfile: { fields: { a: 'b' } },
  providerConfig: { apiKey: 'sk-secret' },
  webhookBody: { request: 'raw' },
  nested: { token: 'secret' },
  text: 'call +81 90 1234 5678'
})

assert.equal(result.status, 'blocked')
for (const type of [
  'raw_screenshot',
  'base64',
  'full_chat',
  'plaintext_contact',
  'full_profile',
  'provider_config_values',
  'webhook_body'
]) {
  assert.ok(result.blockedTypes.includes(type as any), `missing ${type}`)
}

const recoveryResult = checkDiagnosticsRedaction({
  source: 'recovery_reconciliation',
  action: 'provider_recovery_reconciliation',
  providerConfig: { apiKey: 'sk-live-secret' },
  manifestUrl: 'https://providers.example/manifest.json?token=super-secret-token',
  localPath: '/workspace/provider/private-bundle.js',
  fullConversation: 'full chat OCR private transcript',
  contactName: 'alice@example.com'
})

assert.equal(recoveryResult.status, 'blocked')
for (const type of [
  'provider_config_values',
  'secrets',
  'full_chat',
  'plaintext_contact'
]) {
  assert.ok(recoveryResult.blockedTypes.includes(type as any), `missing recovery ${type}`)
}

console.log('diagnostics-redaction-checker mock tests passed')
