import assert from 'node:assert/strict'
import { mergeSettings, normalizeSettings, withSchemaDefaults } from './settings'

function testNormalizeSettings(): void {
  const settings = normalizeSettings({
    apiKey: 'vision-key',
    model: 'legacy-model',
    baseUrl: 'https://legacy.example.com',
    systemPrompt: 'legacy prompt',
    providerManifestUrl: 'https://provider.example.com/manifest.json'
  })

  assert.equal(settings.vision.apiKey, 'vision-key')
  assert.equal(settings.vision.model, 'legacy-model')
  assert.equal(settings.vision.baseURL, 'https://legacy.example.com')
  assert.equal(settings.chatProvider.manifestUrl, 'https://provider.example.com/manifest.json')
  assert.equal(settings.chatProvider.config.model, 'legacy-model')
  assert.equal(settings.chatProvider.config.baseURL, 'https://legacy.example.com')
  assert.equal(settings.chatProvider.config.systemPrompt, 'legacy prompt')
}

function testMergeSettings(): void {
  const current = normalizeSettings({
    locale: 'zh',
    vision: {
      apiKey: 'old-key',
      model: 'old-model',
      baseURL: 'https://old.example.com'
    },
    chatProvider: {
      manifestUrl: 'https://old.example.com/manifest.json',
      installed: null,
      config: {
        apiKey: 'chat-key',
        model: 'chat-model'
      }
    }
  })

  const next = mergeSettings(current, {
    vision: {
      apiKey: 'new-key'
    },
    chatProvider: {
      config: {
        systemPrompt: 'hello'
      }
    }
  })

  assert.equal(next.vision.apiKey, 'new-key')
  assert.equal(next.vision.model, 'old-model')
  assert.equal(next.chatProvider.config.apiKey, 'chat-key')
  assert.equal(next.chatProvider.config.model, 'chat-model')
  assert.equal(next.chatProvider.config.systemPrompt, 'hello')
}

function testWithSchemaDefaults(): void {
  const next = withSchemaDefaults(
    {
      properties: {
        region: { default: 'cn' },
        timeout: { default: 30 },
        apiKey: { default: 'should-not-overwrite' }
      }
    },
    {
      apiKey: 'actual-key',
      timeout: 10
    }
  )

  assert.deepEqual(next, {
    apiKey: 'actual-key',
    timeout: 10,
    region: 'cn'
  })
}

testNormalizeSettings()
testMergeSettings()
testWithSchemaDefaults()

console.log('settings.test.ts: all assertions passed')
