import * as assert from 'node:assert/strict'
import { PolicyEngine } from './policy-engine'

function testReviewKeywordRequiresReview(): void {
  const engine = new PolicyEngine({ reviewKeywords: ['转账'] })
  const decision = engine.evaluate({ replyText: '我现在给你转账' })

  assert.equal(decision.action, 'requires_review')
  assert.deepEqual(decision.riskLabels, ['敏感关键词'])
  assert.equal(decision.auditEvents[0].action, 'policy.hit')
}

function testBlockedKeywordBlocks(): void {
  const engine = new PolicyEngine({ blockedKeywords: ['密码'] })
  const decision = engine.evaluate({ replyText: '我的密码是 123456' })

  assert.equal(decision.action, 'blocked')
  assert.equal(decision.hits[0].severity, 'block')
}

function testUnknownContactRequiresReview(): void {
  const engine = new PolicyEngine({ requireReviewForUnknownContact: true })
  const decision = engine.evaluate({
    replyText: '你好',
    currentContact: '陌生人',
    isUnknownContact: true
  })

  assert.equal(decision.action, 'requires_review')
  assert.equal(decision.riskLabels[0], '未知联系人')
}

function testConsecutiveAutoSendsRequiresReview(): void {
  const engine = new PolicyEngine({ maxConsecutiveAutoSends: 2 })
  const decision = engine.evaluate({ replyText: '继续回复', consecutiveAutoSends: 2 })

  assert.equal(decision.action, 'requires_review')
  assert.equal(decision.hits[0].ruleType, 'consecutive_auto_sends')
}

function testNoHitAllows(): void {
  const engine = new PolicyEngine({ reviewKeywords: ['转账'], blockedKeywords: ['密码'] })
  const decision = engine.evaluate({ replyText: '好的，稍后见' })

  assert.equal(decision.action, 'allow')
  assert.equal(decision.hits.length, 0)
}

function main(): void {
  testReviewKeywordRequiresReview()
  testBlockedKeywordBlocks()
  testUnknownContactRequiresReview()
  testConsecutiveAutoSendsRequiresReview()
  testNoHitAllows()
  console.log('policy engine mock tests passed')
}

main()
