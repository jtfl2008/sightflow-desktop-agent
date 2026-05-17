import * as assert from 'node:assert/strict'
import { IntentRouter } from './intent-router'
import { IntentRoutingSettings } from './intent-types'

const baseSettings: IntentRoutingSettings = {
  enabled: true,
  minConfidenceForAutoRoute: 0.62,
  maxCandidateIntents: 3,
  fallbackIntentId: 'unknown',
  fallbackRouteId: 'fallback_review',
  promptPresets: [{ id: 'sales', label: '销售', systemHint: '优先使用价格知识', enabled: true }],
  rules: [
    {
      id: 'pricing-keyword',
      enabled: true,
      priority: 10,
      intentId: 'pricing_inquiry',
      label: '价格咨询',
      score: 0.8,
      conditions: [{ type: 'keyword', keywords: ['价格'], match: 'any' }]
    }
  ],
  routes: [
    {
      id: 'pricing-route',
      enabled: true,
      priority: 1,
      intentIds: ['pricing_inquiry'],
      label: '价格回复',
      action: 'run_provider',
      promptPresetId: 'sales',
      requiredKnowledgeSourceTypes: ['faq']
    },
    {
      id: 'fallback_review',
      enabled: true,
      priority: 999,
      intentIds: ['unknown'],
      label: 'fallback',
      action: 'run_provider_requires_review',
      forcedReplyMode: 'draft_review'
    }
  ]
}

function context(overrides = {}) {
  return {
    appType: 'wechat' as const,
    knowledgeSnippets: [],
    replyMode: 'auto_send' as const,
    now: 1,
    ...overrides
  }
}

function testKeywordRoute(): void {
  const result = new IntentRouter(baseSettings).evaluate(context({ ocrText: '请问价格是多少' }))
  assert.equal(result.intent.primaryIntentId, 'pricing_inquiry')
  assert.equal(result.route.routeId, 'pricing-route')
  assert.equal(result.route.promptHint, '优先使用价格知识')
}

function testKnowledgeSourceTypeCondition(): void {
  const settings = {
    ...baseSettings,
    rules: [
      {
        id: 'doc-rule',
        enabled: true,
        priority: 1,
        intentId: 'product_inquiry',
        label: '文档命中',
        score: 0.75,
        conditions: [{ type: 'knowledge_source_type' as const, sourceTypes: ['doc'] }]
      }
    ],
    routes: [
      {
        id: 'doc-route',
        enabled: true,
        priority: 1,
        intentIds: ['product_inquiry'],
        label: '产品说明',
        action: 'run_provider' as const
      },
      baseSettings.routes[1]
    ]
  }
  const result = new IntentRouter(settings).evaluate(
    context({ knowledgeSnippets: [{ id: 'k1', title: '产品', content: '说明', sourceType: 'doc' }] })
  )
  assert.equal(result.intent.primaryIntentId, 'product_inquiry')
  assert.equal(result.matchedKnowledge[0].id, 'k1')
}

function testPriorityTieBreak(): void {
  const settings = {
    ...baseSettings,
    rules: [
      { ...baseSettings.rules[0], id: 'late', priority: 20, intentId: 'product_inquiry' },
      { ...baseSettings.rules[0], id: 'early', priority: 1, intentId: 'pricing_inquiry' }
    ]
  }
  const result = new IntentRouter(settings).evaluate(context({ ocrText: '价格' }))
  assert.equal(result.matchedRules[0].id, 'early')
}

function testLowConfidenceFallback(): void {
  const settings = { ...baseSettings, rules: [{ ...baseSettings.rules[0], score: 0.2 }] }
  const result = new IntentRouter(settings).evaluate(context({ ocrText: '价格' }))
  assert.equal(result.intent.fallbackUsed, true)
  assert.equal(result.intent.fallbackReason, 'low_confidence')
  assert.equal(result.route.forcedReplyMode, 'draft_review')
}

function testBlockedRoute(): void {
  const settings = {
    ...baseSettings,
    rules: [{ ...baseSettings.rules[0], intentId: 'sensitive_action', label: '敏感操作' }],
    routes: [
      {
        id: 'blocked-sensitive',
        enabled: true,
        priority: 1,
        intentIds: ['sensitive_action'],
        label: '阻断敏感操作',
        action: 'blocked' as const
      },
      baseSettings.routes[1]
    ]
  }
  const result = new IntentRouter(settings).evaluate(context({ ocrText: '价格' }))
  assert.equal(result.route.action, 'blocked')
  assert.equal(result.route.policyHints[0].severity, 'blocked')
}

function main(): void {
  testKeywordRoute()
  testKnowledgeSourceTypeCondition()
  testPriorityTieBreak()
  testLowConfidenceFallback()
  testBlockedRoute()
  console.log('intent router mock tests passed')
}

main()
