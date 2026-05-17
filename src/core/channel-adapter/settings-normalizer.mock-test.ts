import * as assert from 'node:assert/strict'
import { listChannelAdapterPresets } from './presets'
import {
  defaultChannelAdapterSettings,
  normalizeAdapterRegions,
  normalizeChannelAdapterSettings
} from './settings-normalizer'

const fixedNow = (): Date => new Date('2026-05-17T12:00:00.000Z')

function testLegacySettingsStaySingleSession(): void {
  const settings = normalizeChannelAdapterSettings(
    {
      appType: 'slack',
      manifestId: 'legacy-slack',
      version: '0.1.0',
      enabled: true,
      capabilities: ['single_session', 'multi_session_unread_scan'],
      headerConfigured: true,
      unreadIndicatorConfigured: true
    },
    fixedNow
  )

  assert.equal(settings.enabled, true)
  assert.equal(settings.multiSessionEnabled, false)
  assert.equal(settings.runtimeMode, 'single_session')
  assert.equal(settings.safetyMode, 'default_single_session')
  assert.equal(settings.officialSupport, false)
  assert.equal(settings.presetSource, 'local_preset')
}

function testMissingFieldsNeverEnableContactScanning(): void {
  const settings = normalizeChannelAdapterSettings(
    {
      appType: 'lark',
      enabled: true,
      multiSessionEnabled: undefined,
      headerConfigured: undefined,
      unreadIndicatorConfigured: undefined
    },
    fixedNow
  )

  assert.equal(settings.multiSessionEnabled, false)
  assert.equal(settings.headerConfigured, false)
  assert.equal(settings.unreadIndicatorConfigured, false)
  assert.equal(settings.runtimeMode, 'single_session')
}

function testExplicitMultiSessionWithoutRegionsDegradesToDraftReview(): void {
  const settings = normalizeChannelAdapterSettings(
    {
      ...defaultChannelAdapterSettings('dingtalk', fixedNow),
      enabled: true,
      multiSessionEnabled: true
    },
    fixedNow
  )

  assert.equal(settings.multiSessionEnabled, true)
  assert.equal(settings.runtimeMode, 'degraded_single_session')
  assert.equal(settings.safetyMode, 'draft_review_only')
}

function testRegionsDefaultHeaderAndUnreadToNull(): void {
  const regions = normalizeAdapterRegions({
    contactList: { x: 0, y: 0, width: 200, height: 800 },
    chatMain: { x: 200, y: 0, width: 800, height: 700 },
    inputBox: { x: 200, y: 700, width: 800, height: 100 },
    unreadIndicator: null,
    capturedAt: 1
  })

  assert.equal(regions?.header, null)
  assert.equal(regions?.unreadIndicator, null)
  assert.equal(regions?.multiSessionEnabled, false)
}

function testLocalPresetsAreUnsupportedByOfficialVendors(): void {
  const presets = listChannelAdapterPresets()
  assert.equal(presets.length >= 4, true)
  for (const appType of ['slack', 'lark', 'dingtalk'] as const) {
    const preset = presets.find((item) => item.appType === appType)
    assert.ok(preset)
    assert.equal(preset.source, 'local_preset')
    assert.equal(preset.officialSupport, false)
    assert.equal(preset.defaultSettings.enabled, false)
    assert.equal(preset.defaultSettings.multiSessionEnabled, false)
    assert.match(preset.description, /本地预设示例/)
    assert.match(preset.description, /非官方稳定承诺/)
  }
}

function main(): void {
  testLegacySettingsStaySingleSession()
  testMissingFieldsNeverEnableContactScanning()
  testExplicitMultiSessionWithoutRegionsDegradesToDraftReview()
  testRegionsDefaultHeaderAndUnreadToNull()
  testLocalPresetsAreUnsupportedByOfficialVendors()
  console.log('channel adapter settings normalizer mock tests passed')
}

main()
