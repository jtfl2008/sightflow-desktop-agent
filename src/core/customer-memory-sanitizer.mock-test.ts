import * as assert from 'node:assert/strict'
import {
  CUSTOMER_MEMORY_ALLOWED_RETENTION_DAYS,
  CUSTOMER_MEMORY_DEFAULT_SETTINGS,
  CustomerMemorySuggestion,
  CustomerProfileRecord
} from './customer-memory-types'
import {
  buildProviderInputCustomerProfile,
  canPromoteSuggestionToProfile,
  normalizeCustomerMemorySettings,
  sanitizeCustomerProfileFields
} from './customer-memory-sanitizer'
import type { ProviderInput } from './session-types'

function testFrozenDefaults(): void {
  const settings = normalizeCustomerMemorySettings()
  assert.equal(settings.enabled, false)
  assert.equal(settings.defaultRetentionDays, 180)
  assert.deepEqual(settings.allowedRetentionDays, CUSTOMER_MEMORY_ALLOWED_RETENTION_DAYS)
  assert.deepEqual([...CUSTOMER_MEMORY_ALLOWED_RETENTION_DAYS], [30, 90, 180])
  assert.equal(settings.allowPermanentRetention, false)
  assert.equal(settings.allowSuggestionFromHistorySummary, false)
  assert.equal(settings.pendingSuggestionExpiresInDays, 7)
  assert.equal(CUSTOMER_MEMORY_DEFAULT_SETTINGS.enabled, false)
}

function testInvalidSettingsCannotEnableForbiddenOptions(): void {
  const settings = normalizeCustomerMemorySettings({
    defaultRetentionDays: 365 as any,
    allowPermanentRetention: true as any,
    allowSuggestionFromHistorySummary: true as any
  })
  assert.equal(settings.defaultRetentionDays, 180)
  assert.equal(settings.allowPermanentRetention, false)
  assert.equal(settings.allowSuggestionFromHistorySummary, false)
}

function testBudgetsBlockSave(): void {
  const result = sanitizeCustomerProfileFields({
    preferenceNotes: Array.from({ length: 11 }, (_, index) => `note ${index}`)
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.blockedFieldPaths, ['preferenceNotes'])

  const summary = sanitizeCustomerProfileFields({ lastConfirmedSummary: 'x'.repeat(601) })
  assert.equal(summary.ok, false)
  assert.equal(summary.blockedFieldPaths[0], 'lastConfirmedSummary')
}

function testSensitiveFieldsBlocked(): void {
  const result = sanitizeCustomerProfileFields({
    preferenceNotes: ['邮箱 alice@example.com', 'token=abc123', '高价值客户'],
    businessContext: ['客户：你好\n客服：您好\n客户：完整聊天记录']
  })
  assert.equal(result.ok, false)
  assert.ok(result.blockedFieldPaths.includes('preferenceNotes.0'))
  assert.ok(result.blockedFieldPaths.includes('preferenceNotes.1'))
  assert.ok(result.blockedFieldPaths.includes('preferenceNotes.2'))
  assert.ok(result.blockedFieldPaths.includes('businessContext.0'))
}

function testPendingSuggestionNotPromotedUntilConfirmed(): void {
  const suggestion: CustomerMemorySuggestion = {
    suggestionId: 's1',
    contactKeyHash: 'hash',
    sourceAppType: 'wechat',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    suggestedFields: { preferenceNotes: ['喜欢简短回复'] },
    status: 'pending',
    sanitizerWarnings: []
  }
  assert.equal(canPromoteSuggestionToProfile(suggestion), false)
  assert.equal(canPromoteSuggestionToProfile({ ...suggestion, status: 'confirmed' }), true)
}

function testProviderInputOptionalAndSanitized(): void {
  const providerInput: ProviderInput = {
    screenshot: 'data:image/png;base64,abc',
    appType: 'wechat'
  }
  assert.equal(providerInput.customerProfile, undefined)

  const profile: CustomerProfileRecord = {
    profileId: 'p1',
    contactKeyHash: 'hash',
    sourceAppType: 'wechat',
    version: 2,
    disabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fields: { preferenceNotes: ['喜欢简短回复'], lastConfirmedSummary: '已确认摘要' },
    provenance: []
  }
  const result = buildProviderInputCustomerProfile(profile)
  assert.equal(result.omittedReason, undefined)
  assert.equal(result.customerProfile?.profileId, 'p1')
  assert.deepEqual(result.customerProfile?.injectedFieldPaths.sort(), [
    'lastConfirmedSummary',
    'preferenceNotes'
  ])
}

function main(): void {
  testFrozenDefaults()
  testInvalidSettingsCannotEnableForbiddenOptions()
  testBudgetsBlockSave()
  testSensitiveFieldsBlocked()
  testPendingSuggestionNotPromotedUntilConfirmed()
  testProviderInputOptionalAndSanitized()
  console.log('customer memory sanitizer mock tests passed')
}

main()
