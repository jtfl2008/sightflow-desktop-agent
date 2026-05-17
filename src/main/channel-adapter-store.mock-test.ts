import * as assert from 'node:assert/strict'
import type { AppType } from '../core/rpa/types'
import {
  ChannelAdapterSettings,
  ChannelAdapterStore,
  defaultChannelAdapterSettings,
  normalizeChannelAdapterSettings
} from './channel-adapter-store'

class MemoryChannelAdapterBackend {
  settings: Partial<Record<AppType, ChannelAdapterSettings>> | undefined

  get(key: 'settings'): Partial<Record<AppType, ChannelAdapterSettings>> | undefined {
    assert.equal(key, 'settings')
    return this.settings
  }

  set(key: 'settings', value: Partial<Record<AppType, ChannelAdapterSettings>>): void {
    assert.equal(key, 'settings')
    this.settings = value
  }
}

function testDefaultRemainsSingleSession(): void {
  const settings = defaultChannelAdapterSettings('lark')
  assert.equal(settings.multiSessionEnabled, false)
  assert.equal(settings.runtimeMode, 'single_session')
  assert.equal(settings.safetyMode, 'default_single_session')
}

function testMissingHeaderOrUnreadDegradesToDraftReview(): void {
  const base = {
    ...defaultChannelAdapterSettings('slack'),
    enabled: true,
    multiSessionEnabled: true
  }
  const missingHeader = normalizeChannelAdapterSettings(base)
  assert.equal(missingHeader.runtimeMode, 'degraded_single_session')
  assert.equal(missingHeader.safetyMode, 'draft_review_only')

  const missingUnread = normalizeChannelAdapterSettings({
    ...base,
    headerConfigured: true
  })
  assert.equal(missingUnread.runtimeMode, 'degraded_single_session')
  assert.equal(missingUnread.safetyMode, 'draft_review_only')
}

function testCompleteRegionsAllowMultiSession(): void {
  const settings = normalizeChannelAdapterSettings({
    ...defaultChannelAdapterSettings('telegram'),
    enabled: true,
    multiSessionEnabled: true,
    headerConfigured: true,
    unreadIndicatorConfigured: true
  })

  assert.equal(settings.runtimeMode, 'multi_session')
  assert.equal(settings.safetyMode, 'auto_switch_allowed')
}

function testPersistenceDoesNotRequireElectronStore(): void {
  const backend = new MemoryChannelAdapterBackend()
  const store = new ChannelAdapterStore({ backend })

  store.save({
    ...defaultChannelAdapterSettings('generic'),
    enabled: true,
    manifestId: 'generic-adapter',
    version: '1.0.0'
  })

  const reloaded = new ChannelAdapterStore({ backend })
  assert.equal(reloaded.get('generic').manifestId, 'generic-adapter')
  assert.equal(reloaded.get('generic').multiSessionEnabled, false)
}

function main(): void {
  testDefaultRemainsSingleSession()
  testMissingHeaderOrUnreadDegradesToDraftReview()
  testCompleteRegionsAllowMultiSession()
  testPersistenceDoesNotRequireElectronStore()
  console.log('channel adapter store mock tests passed')
}

main()
