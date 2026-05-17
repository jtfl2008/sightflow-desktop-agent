import * as assert from 'node:assert/strict'
import type { CustomerMemoryStoreShape } from '../core/customer-memory-types'
import { CustomerMemoryStore, normalizeContactKey, normalizeCustomerMemoryState } from './customer-memory-store'

class MemoryCustomerMemoryBackend {
  state: CustomerMemoryStoreShape | undefined
  secret: string | undefined

  get(key: 'state'): Partial<CustomerMemoryStoreShape> | undefined
  get(key: 'secret'): string | undefined
  get(key: 'state' | 'secret'): Partial<CustomerMemoryStoreShape> | string | undefined {
    return key === 'state' ? this.state : this.secret
  }

  set(key: 'state', value: CustomerMemoryStoreShape): void
  set(key: 'secret', value: string): void
  set(key: 'state' | 'secret', value: CustomerMemoryStoreShape | string): void {
    if (key === 'state') this.state = value as CustomerMemoryStoreShape
    else this.secret = value as string
  }
}

function fixedNow(): Date {
  return new Date('2026-05-17T08:30:00.000Z')
}

function enabledStore(backend = new MemoryCustomerMemoryBackend()): CustomerMemoryStore {
  const store = new CustomerMemoryStore({ backend, now: fixedNow })
  store.updateSettings({ enabled: true })
  return store
}

function testNormalizeMigrationKeepsSafeDefaults(): void {
  const state = normalizeCustomerMemoryState({ settings: { enabled: true, defaultRetentionDays: 999 } as any })
  assert.equal(state.settings.defaultRetentionDays, 180)
  assert.equal(state.settings.allowPermanentRetention, false)
  assert.equal(state.settings.allowSuggestionFromHistorySummary, false)
  assert.deepEqual(state.profilesById, {})
}

function testDefaultDisabledDoesNotCreateProfile(): void {
  const backend = new MemoryCustomerMemoryBackend()
  const store = new CustomerMemoryStore({ backend, now: fixedNow })
  const result = store.createOrUpdateProfile({
    contactKey: ' Alice ',
    sourceAppType: 'wechat',
    fields: { preferenceNotes: ['喜欢简短回复'] }
  })
  assert.equal(result.created, false)
  assert.equal(result.omittedReason, 'disabled')
  assert.deepEqual(store.getState().profilesById, {})
  assert.equal(store.buildProviderInputByContact('wechat', 'Alice').omittedReason, 'disabled')
  assert.equal(
    store.runtimePreflight({
      appType: 'wechat',
      contactKey: 'Alice',
      runtimeDecision: 'allow_provider'
    }).omittedReason,
    'disabled'
  )
  assert.equal(backend.secret, undefined)
}

function testContactKeyHashNormalizesAndPersistsSecret(): void {
  const backend = new MemoryCustomerMemoryBackend()
  const store = enabledStore(backend)
  assert.equal(normalizeContactKey(' Alice   ABC '), 'alice abc')
  const first = store.hashContactKey('wechat', ' Alice ABC ')
  const second = new CustomerMemoryStore({ backend, now: fixedNow }).hashContactKey('wechat', 'alice   abc')
  assert.equal(first, second)
  assert.equal(first.includes('Alice'), false)
}

function testPendingSuggestionDoesNotInjectUntilConfirmed(): void {
  const backend = new MemoryCustomerMemoryBackend()
  const store = enabledStore(backend)
  const profileResult = store.createOrUpdateProfile({
    contactKey: 'Alice',
    sourceAppType: 'wechat',
    fields: { preferenceNotes: ['喜欢简短回复'] }
  })
  assert.equal(profileResult.created, true)

  const suggestion = store.createPendingSuggestion({
    contactKey: 'Alice',
    sourceAppType: 'wechat',
    suggestedFields: { businessContext: ['关注企业版'] }
  })
  assert.equal(store.canPromoteSuggestion(suggestion.suggestionId), false)
  assert.equal(store.buildProviderInputByContact('wechat', 'Alice').omittedReason, 'not_confirmed')

  store.confirmSuggestion(suggestion.suggestionId)
  assert.equal(store.canPromoteSuggestion(suggestion.suggestionId), true)
  assert.equal(store.buildProviderInputByContact('wechat', 'Alice').customerProfile?.profileId, profileResult.profile.profileId)
}

function testDeleteAndClearAllWriteTombstonesWithoutContent(): void {
  const store = enabledStore()
  const result = store.createOrUpdateProfile({
    contactKey: 'Bob',
    sourceAppType: 'wechat',
    fields: { lastConfirmedSummary: 'Bob likes short replies' }
  })
  assert.equal(result.created, true)
  const tombstone = store.deleteProfile(result.profile.profileId)
  assert.equal(tombstone?.reason, 'user_deleted')
  assert.equal(store.buildProviderInputByContact('wechat', 'Bob').omittedReason, 'deleted')
  assert.equal(JSON.stringify(store.getState().tombstonesByContactKeyHash).includes('Bob likes'), false)

  const next = store.createOrUpdateProfile({
    contactKey: 'Carol',
    sourceAppType: 'wechat',
    fields: { preferenceNotes: ['formal'] }
  })
  assert.equal(next.created, true)
  const cleared = store.clearAllProfiles()
  assert.equal(cleared.length, 1)
  assert.equal(Object.keys(store.getState().profilesById).length, 0)
  assert.equal(JSON.stringify(store.getState()).includes('formal'), false)
}

function testCleanupExpiredRemovesProfileContent(): void {
  const backend = new MemoryCustomerMemoryBackend()
  const store = new CustomerMemoryStore({ backend, now: () => new Date('2026-01-01T00:00:00.000Z') })
  store.updateSettings({ enabled: true })
  const created = store.createOrUpdateProfile({
    contactKey: 'Dora',
    sourceAppType: 'wechat',
    fields: { preferenceNotes: ['expires'] },
    retentionDays: 30
  })
  assert.equal(created.created, true)

  const later = new CustomerMemoryStore({ backend, now: () => new Date('2026-02-15T00:00:00.000Z') })
  const tombstones = later.cleanupExpired()
  assert.equal(tombstones[0].reason, 'retention_expired')
  assert.equal(later.buildProviderInputByContact('wechat', 'Dora').omittedReason, 'deleted')
  assert.equal(JSON.stringify(later.getState()).includes('expires'), false)
}

function testRuntimePreflightHeaderAndContactVerification(): void {
  const backend = new MemoryCustomerMemoryBackend()
  const store = enabledStore(backend)

  const missingHeader = store.runtimePreflight({
    appType: 'wechat',
    contactKey: 'Alice',
    multiSessionEnabled: true,
    hasReliableHeader: false,
    contactVerified: true,
    runtimeDecision: 'allow_provider'
  })
  assert.equal(missingHeader.omittedReason, 'missing_header')
  assert.equal(missingHeader.customerProfile, undefined)
  assert.equal(backend.secret, undefined)

  const contactNotVerified = store.runtimePreflight({
    appType: 'wechat',
    contactKey: 'Alice',
    multiSessionEnabled: true,
    hasReliableHeader: true,
    contactVerified: false,
    runtimeDecision: 'allow_provider'
  })
  assert.equal(contactNotVerified.omittedReason, 'contact_not_verified')
  assert.equal(contactNotVerified.customerProfile, undefined)
  assert.equal(backend.secret, undefined)
}

function testRuntimePreflightBlockedDecisionsDoNotHashOrInject(): void {
  const backend = new MemoryCustomerMemoryBackend()
  const store = enabledStore(backend)
  const created = store.createOrUpdateProfile({
    contactKey: 'Alice',
    sourceAppType: 'wechat',
    fields: { preferenceNotes: ['likes concise answers'] }
  })
  assert.equal(created.created, true)
  backend.secret = undefined

  for (const runtimeDecision of ['blocked', 'skip_provider', 'manual_takeover'] as const) {
    const result = store.runtimePreflight({
      appType: 'wechat',
      contactKey: 'Alice',
      runtimeDecision
    })
    assert.equal(result.omittedReason, 'disabled')
    assert.equal(result.customerProfile, undefined)
    assert.equal(backend.secret, undefined)
  }
}

function testRuntimePreflightTombstoneBeatsStaleProfile(): void {
  const backend = new MemoryCustomerMemoryBackend()
  const store = enabledStore(backend)
  const created = store.createOrUpdateProfile({
    contactKey: 'Bob',
    sourceAppType: 'wechat',
    fields: { preferenceNotes: ['stale note'] }
  })
  assert.equal(created.created, true)
  const tombstone = store.deleteProfile(created.profile.profileId)
  assert.ok(tombstone)
  backend.state!.profilesById[created.profile.profileId] = created.profile
  backend.state!.profileIdsByContactKeyHash[created.profile.contactKeyHash] =
    created.profile.profileId

  const result = store.runtimePreflight({
    appType: 'wechat',
    contactKey: 'Bob',
    runtimeDecision: 'allow_provider'
  })
  assert.equal(result.omittedReason, 'deleted')
  assert.equal(result.customerProfile, undefined)
}

function main(): void {
  testNormalizeMigrationKeepsSafeDefaults()
  testDefaultDisabledDoesNotCreateProfile()
  testContactKeyHashNormalizesAndPersistsSecret()
  testPendingSuggestionDoesNotInjectUntilConfirmed()
  testDeleteAndClearAllWriteTombstonesWithoutContent()
  testCleanupExpiredRemovesProfileContent()
  testRuntimePreflightHeaderAndContactVerification()
  testRuntimePreflightBlockedDecisionsDoNotHashOrInject()
  testRuntimePreflightTombstoneBeatsStaleProfile()
  console.log('customer memory store mock tests passed')
}

main()
