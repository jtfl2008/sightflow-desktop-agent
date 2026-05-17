import * as assert from 'node:assert/strict'
import { ChannelAdapterStore } from '../../main/channel-adapter-store'
import type { AppType } from '../rpa/types'
import { listChannelAdapterPresets } from './presets'
import {
  buildChannelAdapterDisabledFallback,
  validateRendererChannelAdapterSave,
  validateRendererChannelAdapterSetEnabled
} from './renderer-save-guard'
import type { ChannelAdapterSettings } from './types'

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

function testValidRendererSaveIsDerivedFromManifest(): void {
  const result = validateRendererChannelAdapterSave(
    {
      appType: 'slack',
      manifestId: 'slack-local-basic',
      enabled: true,
      multiSessionEnabled: true,
      headerConfigured: true,
      unreadIndicatorConfigured: true
    },
    listChannelAdapterPresets(),
    () => new Date('2026-01-01T00:00:00.000Z')
  )

  assert.equal(result.ok, true)
  assert.equal(result.settings?.runtimeMode, 'multi_session')
  assert.equal(result.settings?.safetyMode, 'auto_switch_allowed')
  assert.equal(result.settings?.officialSupport, false)
  assert.deepEqual(result.settings?.capabilities, [
    'single_session',
    'multi_session_unread_scan',
    'header_contact_identity',
    'unread_badge_detection'
  ])
}

function testUnknownCapabilityIsRejected(): void {
  const result = validateRendererChannelAdapterSave(
    {
      appType: 'slack',
      manifestId: 'slack-local-basic',
      enabled: true,
      capabilities: ['single_session', 'run_shell']
    },
    listChannelAdapterPresets()
  )

  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'adapter.settings.unknown_capability')
}

function testForgedRuntimeModeIsRejected(): void {
  const result = validateRendererChannelAdapterSave(
    {
      appType: 'slack',
      manifestId: 'slack-local-basic',
      enabled: true,
      multiSessionEnabled: true,
      runtimeMode: 'multi_session',
      safetyMode: 'auto_switch_allowed'
    },
    listChannelAdapterPresets()
  )

  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'adapter.settings.forged_runtime_mode')
}

function testForgedOfficialSupportIsRejected(): void {
  const result = validateRendererChannelAdapterSave(
    {
      appType: 'slack',
      manifestId: 'slack-local-basic',
      enabled: true,
      officialSupport: true
    },
    listChannelAdapterPresets()
  )

  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'adapter.settings.forged_official_support')
}

function testManifestAppTypeMismatchIsRejected(): void {
  const result = validateRendererChannelAdapterSave(
    {
      appType: 'lark',
      manifestId: 'slack-local-basic',
      enabled: true
    },
    listChannelAdapterPresets()
  )

  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'adapter.manifest.app_type_mismatch')
}

function testSetEnabledMismatchPersistsDisabledFallback(): void {
  const backend = new MemoryChannelAdapterBackend()
  const store = new ChannelAdapterStore({ backend })
  const result = validateRendererChannelAdapterSetEnabled(
    {
      appType: 'lark',
      manifestId: 'slack-local-basic',
      enabled: true,
      multiSessionEnabled: true
    },
    listChannelAdapterPresets(),
    () => new Date('2026-01-01T00:00:00.000Z')
  )

  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'adapter.manifest.app_type_mismatch')

  const fallback = store.save(
    buildChannelAdapterDisabledFallback('lark', () => new Date('2026-01-01T00:00:00.000Z'))
  )

  assert.equal(fallback.appType, 'lark')
  assert.equal(fallback.enabled, false)
  assert.equal(fallback.multiSessionEnabled, false)
  assert.equal(fallback.manifestId, '')
  assert.deepEqual(fallback.capabilities, ['single_session'])
  assert.equal(store.get('lark').manifestId, '')
  assert.equal(store.get('lark').multiSessionEnabled, false)
}

function main(): void {
  testValidRendererSaveIsDerivedFromManifest()
  testUnknownCapabilityIsRejected()
  testForgedRuntimeModeIsRejected()
  testForgedOfficialSupportIsRejected()
  testManifestAppTypeMismatchIsRejected()
  testSetEnabledMismatchPersistsDisabledFallback()
  console.log('renderer channel adapter save guard mock tests passed')
}

main()
