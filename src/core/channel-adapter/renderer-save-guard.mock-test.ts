import * as assert from 'node:assert/strict'
import { listChannelAdapterPresets } from './presets'
import { validateRendererChannelAdapterSave } from './renderer-save-guard'

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

function main(): void {
  testValidRendererSaveIsDerivedFromManifest()
  testUnknownCapabilityIsRejected()
  testForgedRuntimeModeIsRejected()
  testForgedOfficialSupportIsRejected()
  testManifestAppTypeMismatchIsRejected()
  console.log('renderer channel adapter save guard mock tests passed')
}

main()
