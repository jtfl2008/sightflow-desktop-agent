import * as assert from 'node:assert/strict'
import { manifestFromPreset, validateChannelAdapterManifest } from './manifest-validator'
import { listChannelAdapterPresets } from './presets'
import { defaultChannelAdapterSettings } from './settings-normalizer'
import { createChannelAdapterRuntimeState } from './runtime-state'

function testLocalPresetManifestPasses(): void {
  const preset = listChannelAdapterPresets().find((item) => item.presetId === 'slack-local-basic')
  assert.ok(preset)
  const result = validateChannelAdapterManifest(manifestFromPreset(preset))
  assert.equal(result.valid, true)
  assert.equal(result.manifest?.source, 'local_preset')
  assert.equal(result.manifest?.officialSupport, false)
}

function testUnknownCapabilityIsRejected(): void {
  const result = validateChannelAdapterManifest({
    schemaVersion: 1,
    manifestId: 'bad',
    version: '1.0.0',
    displayName: 'Bad',
    appType: 'slack',
    source: 'local_preset',
    officialSupport: false,
    capabilities: ['single_session', 'run_shell']
  })
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /unknown capability/)
}

function testExecutableAndRemoteFieldsAreRejected(): void {
  for (const candidate of [
    { script: 'echo hi' },
    { lifecycle: { shellCommand: 'bash ./setup.sh' } },
    { remoteManifestUrl: 'https://example.com/adapter.json' },
    { code: '() => true' }
  ]) {
    const result = validateChannelAdapterManifest({
      schemaVersion: 1,
      manifestId: 'bad',
      version: '1.0.0',
      displayName: 'Bad',
      appType: 'slack',
      source: 'local_preset',
      officialSupport: false,
      capabilities: ['single_session'],
      ...candidate
    })
    assert.equal(result.valid, false)
    assert.match(result.errors.join('\n'), /forbidden/)
  }
}

function testRuntimeStateMissingHeaderForcesDraftReview(): void {
  const settings = {
    ...defaultChannelAdapterSettings('lark'),
    enabled: true,
    multiSessionEnabled: true,
    runtimeMode: 'degraded_single_session' as const,
    safetyMode: 'draft_review_only' as const
  }
  const state = createChannelAdapterRuntimeState({ appType: 'lark', settings })
  assert.equal(state.currentMode, 'degraded_single_session')
  assert.equal(state.degradedReason, 'missing_header')
  assert.equal(state.finalAction, 'draft_review')
}

function testInvalidManifestFallsBackSingleSessionState(): void {
  const settings = defaultChannelAdapterSettings('dingtalk')
  const state = createChannelAdapterRuntimeState({
    appType: 'dingtalk',
    settings,
    invalidManifest: true
  })
  assert.equal(state.currentMode, 'degraded_single_session')
  assert.equal(state.degradedReason, 'invalid_manifest')
  assert.equal(state.finalAction, 'draft_review')
}

function main(): void {
  testLocalPresetManifestPasses()
  testUnknownCapabilityIsRejected()
  testExecutableAndRemoteFieldsAreRejected()
  testRuntimeStateMissingHeaderForcesDraftReview()
  testInvalidManifestFallsBackSingleSessionState()
  console.log('channel adapter manifest validator mock tests passed')
}

main()
