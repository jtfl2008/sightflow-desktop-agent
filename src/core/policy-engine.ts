export type PolicyAction = 'allow' | 'requires_review' | 'blocked'

export type PolicyRuleType = 'keyword' | 'unknown_contact' | 'consecutive_auto_sends'

export interface PolicyHit {
  ruleType: PolicyRuleType
  label: string
  reason: string
  severity: 'review' | 'block'
  metadata?: Record<string, unknown>
}

export interface PolicyDecision {
  action: PolicyAction
  hits: PolicyHit[]
  riskLabels: string[]
  reasons: string[]
  auditEvents: Array<{
    category: 'policy'
    action: 'policy.hit'
    message: string
    metadata: Record<string, unknown>
  }>
}

export interface PolicyEngineConfig {
  reviewKeywords?: string[]
  blockedKeywords?: string[]
  requireReviewForUnknownContact?: boolean
  maxConsecutiveAutoSends?: number
}

export interface PolicyContext {
  replyText: string
  currentContact?: string
  isUnknownContact?: boolean
  consecutiveAutoSends?: number
}

export class PolicyEngine {
  constructor(private readonly config: PolicyEngineConfig = {}) {}

  evaluate(context: PolicyContext): PolicyDecision {
    const hits: PolicyHit[] = []
    hits.push(...this.evaluateKeywords(context.replyText, this.config.blockedKeywords, 'block'))
    hits.push(...this.evaluateKeywords(context.replyText, this.config.reviewKeywords, 'review'))

    if (this.config.requireReviewForUnknownContact && context.isUnknownContact) {
      hits.push({
        ruleType: 'unknown_contact',
        label: '未知联系人',
        reason: '当前联系人未确认，需要人工审核',
        severity: 'review',
        metadata: { currentContact: context.currentContact || null }
      })
    }

    const maxAutoSends = this.config.maxConsecutiveAutoSends
    const consecutive = context.consecutiveAutoSends ?? 0
    if (typeof maxAutoSends === 'number' && maxAutoSends >= 0 && consecutive >= maxAutoSends) {
      hits.push({
        ruleType: 'consecutive_auto_sends',
        label: '连续自动发送',
        reason: `连续自动发送次数已达到 ${maxAutoSends} 次，需要人工审核`,
        severity: 'review',
        metadata: { consecutiveAutoSends: consecutive, maxConsecutiveAutoSends: maxAutoSends }
      })
    }

    const action = hits.some((hit) => hit.severity === 'block')
      ? 'blocked'
      : hits.length > 0
        ? 'requires_review'
        : 'allow'

    return {
      action,
      hits,
      riskLabels: hits.map((hit) => hit.label),
      reasons: hits.map((hit) => hit.reason),
      auditEvents: hits.map((hit) => ({
        category: 'policy',
        action: 'policy.hit',
        message: hit.reason,
        metadata: {
          ruleType: hit.ruleType,
          label: hit.label,
          severity: hit.severity,
          ...hit.metadata
        }
      }))
    }
  }

  private evaluateKeywords(
    replyText: string,
    keywords: string[] | undefined,
    severity: 'review' | 'block'
  ): PolicyHit[] {
    if (!keywords?.length) return []
    const normalizedReply = replyText.toLocaleLowerCase()
    return keywords
      .filter((keyword) => keyword && normalizedReply.includes(keyword.toLocaleLowerCase()))
      .map((keyword) => ({
        ruleType: 'keyword' as const,
        label: severity === 'block' ? '阻断关键词' : '敏感关键词',
        reason:
          severity === 'block'
            ? `回复内容命中阻断关键词: ${keyword}`
            : `回复内容命中需审核关键词: ${keyword}`,
        severity,
        metadata: { keyword }
      }))
  }
}

export const allowAllPolicyDecision: PolicyDecision = {
  action: 'allow',
  hits: [],
  riskLabels: [],
  reasons: [],
  auditEvents: []
}
