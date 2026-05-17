import * as assert from 'node:assert/strict'
import { IntentRoutingSettings } from '../core/intent-types'
import { defaultIntentRoutingSettings } from '../core/intent-router'
import { IntentRoutingStore } from './intent-routing-store'

class MemoryIntentBackend {
  settings: IntentRoutingSettings | undefined

  get(key: 'settings'): IntentRoutingSettings | undefined {
    assert.equal(key, 'settings')
    return this.settings
  }

  set(key: 'settings', value: IntentRoutingSettings): void {
    assert.equal(key, 'settings')
    this.settings = value
  }
}

const validSettings: IntentRoutingSettings = {
  ...defaultIntentRoutingSettings,
  enabled: true,
  rules: [
    {
      id: 'pricing_rule',
      enabled: true,
      priority: 1,
      intentId: 'pricing_inquiry',
      label: '价格',
      score: 0.8,
      conditions: [{ type: 'keyword', keywords: ['价格'], match: 'any' }]
    }
  ],
  routes: [
    {
      id: 'pricing_route',
      enabled: true,
      priority: 1,
      intentIds: ['pricing_inquiry'],
      label: '价格路由',
      action: 'run_provider'
    },
    defaultIntentRoutingSettings.routes[0]
  ]
}

function testPersistenceAndReset(): void {
  const backend = new MemoryIntentBackend()
  const store = new IntentRoutingStore({ backend })
  store.save(validSettings)

  const reloaded = new IntentRoutingStore({ backend })
  assert.equal(reloaded.get().rules[0].id, 'pricing_rule')

  reloaded.resetDefaults()
  assert.equal(reloaded.get().enabled, false)
}

function testInvalidIdsAndDuplicateIdsRejected(): void {
  const store = new IntentRoutingStore({ backend: new MemoryIntentBackend() })
  assert.throws(() => store.save({ ...validSettings, rules: [{ ...validSettings.rules[0], id: 'Bad ID' }] }))
  assert.throws(() =>
    store.save({
      ...validSettings,
      rules: [validSettings.rules[0], { ...validSettings.rules[0] }]
    })
  )
}

function testConfidenceOutOfRangeRejected(): void {
  const store = new IntentRoutingStore({ backend: new MemoryIntentBackend() })
  assert.throws(() => store.save({ ...validSettings, rules: [{ ...validSettings.rules[0], score: 2 }] }))
}

function testPreviewDoesNotMutateStoredSettings(): void {
  const backend = new MemoryIntentBackend()
  const store = new IntentRoutingStore({ backend })
  store.save(validSettings)
  const before = JSON.stringify(store.get())

  const preview = store.preview({
    appType: 'wechat',
    ocrText: '价格',
    knowledgeSnippets: [],
    replyMode: 'auto_send',
    now: 1
  })

  assert.equal(preview.intent.primaryIntentId, 'pricing_inquiry')
  assert.equal(JSON.stringify(store.get()), before)
}

function main(): void {
  testPersistenceAndReset()
  testInvalidIdsAndDuplicateIdsRejected()
  testConfidenceOutOfRangeRejected()
  testPreviewDoesNotMutateStoredSettings()
  console.log('intent routing store mock tests passed')
}

main()
