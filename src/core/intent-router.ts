import {
  IntentCandidate,
  IntentEvaluationContext,
  IntentRoute,
  IntentRouterResult,
  IntentRoutingSettings,
  IntentRule,
  PolicyHint,
  RouteDecision
} from './intent-types'

export const defaultIntentRoutingSettings: IntentRoutingSettings = {
  enabled: false,
  minConfidenceForAutoRoute: 0.62,
  maxCandidateIntents: 3,
  fallbackIntentId: 'unknown',
  fallbackRouteId: 'fallback_review',
  rules: [],
  routes: [
    {
      id: 'fallback_review',
      enabled: true,
      priority: 999,
      intentIds: ['unknown'],
      label: '未知意图人工审核',
      action: 'run_provider_requires_review',
      forcedReplyMode: 'draft_review'
    }
  ],
  promptPresets: []
}

export class IntentRouter {
  constructor(private readonly settings: IntentRoutingSettings = defaultIntentRoutingSettings) {}

  evaluate(context: IntentEvaluationContext): IntentRouterResult {
    if (!this.settings.enabled) {
      return this.fallback(context, 'disabled')
    }

    const matchedRules: IntentRule[] = []
    const candidates = new Map<string, IntentCandidate>()
    const sortedRules = [...this.settings.rules]
      .filter((rule) => rule.enabled)
      .sort((a, b) => a.priority - b.priority)

    for (const rule of sortedRules) {
      if (!this.matchesRule(rule, context)) continue
      matchedRules.push(rule)
      const current = candidates.get(rule.intentId)
      const nextConfidence = Math.max(current?.confidence ?? 0, clamp01(rule.score))
      candidates.set(rule.intentId, {
        intentId: rule.intentId,
        label: rule.label,
        confidence: nextConfidence,
        matchedRuleIds: [...(current?.matchedRuleIds ?? []), rule.id],
        reasons: [...(current?.reasons ?? []), `命中规则: ${rule.label}`]
      })
      if (rule.stopOnMatch) break
    }

    const candidateList = [...candidates.values()]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.settings.maxCandidateIntents)

    if (!candidateList.length) return this.fallback(context, 'no_match')

    const primary = candidateList[0]
    if (primary.confidence < this.settings.minConfidenceForAutoRoute) {
      return this.fallback(context, 'low_confidence', candidateList, matchedRules)
    }

    const route = this.selectRoute(primary.intentId)
    if (!route) return this.fallback(context, 'route_disabled', candidateList, matchedRules)

    return {
      intent: {
        primaryIntentId: primary.intentId,
        candidates: candidateList,
        confidence: primary.confidence,
        fallbackUsed: false,
        matchedKnowledgeIds: context.knowledgeSnippets.map((item) => item.id)
      },
      route: this.toRouteDecision(route),
      matchedRules,
      matchedKnowledge: context.knowledgeSnippets.map((item) => ({
        id: item.id,
        title: item.title,
        sourceType: item.sourceType
      }))
    }
  }

  private fallback(
    context: IntentEvaluationContext,
    reason: 'disabled' | 'no_match' | 'low_confidence' | 'route_disabled',
    candidates: IntentCandidate[] = [],
    matchedRules: IntentRule[] = []
  ): IntentRouterResult {
    const route = this.selectRoute(this.settings.fallbackIntentId) || this.settings.routes[0]
    return {
      intent: {
        primaryIntentId: this.settings.fallbackIntentId,
        candidates,
        confidence: candidates[0]?.confidence ?? 0,
        fallbackUsed: true,
        fallbackReason: reason,
        matchedKnowledgeIds: context.knowledgeSnippets.map((item) => item.id)
      },
      route: this.toRouteDecision(route),
      matchedRules,
      matchedKnowledge: context.knowledgeSnippets.map((item) => ({
        id: item.id,
        title: item.title,
        sourceType: item.sourceType
      }))
    }
  }

  private selectRoute(intentId: string): IntentRoute | null {
    return (
      [...this.settings.routes]
        .filter((route) => route.enabled && route.intentIds.includes(intentId))
        .sort((a, b) => a.priority - b.priority)[0] ?? null
    )
  }

  private toRouteDecision(route: IntentRoute): RouteDecision {
    const preset = this.settings.promptPresets.find(
      (item) => item.enabled && item.id === route.promptPresetId
    )
    const policyHints: PolicyHint[] =
      route.action === 'blocked'
        ? [
            {
              id: `${route.id}:blocked`,
              label: route.label,
              severity: 'blocked',
              reason: '路由阻断 Provider 调用',
              source: 'intent_route'
            }
          ]
        : route.action === 'run_provider_requires_review'
          ? [
              {
                id: `${route.id}:review`,
                label: route.label,
                severity: 'requires_review',
                reason: '路由要求人工审核',
                source: 'intent_route'
              }
            ]
          : []

    return {
      routeId: route.id,
      label: route.label,
      action: route.action,
      forcedReplyMode: route.forcedReplyMode,
      promptPresetId: route.promptPresetId,
      promptHint: preset?.systemHint,
      requiredKnowledgeSourceTypes: route.requiredKnowledgeSourceTypes,
      policyHints,
      auditTags: route.auditTags ?? []
    }
  }

  private matchesRule(rule: IntentRule, context: IntentEvaluationContext): boolean {
    return rule.conditions.every((condition) => {
      switch (condition.type) {
        case 'keyword':
          return matchKeywords(this.textContext(context), condition.keywords, condition.match, condition.caseSensitive)
        case 'knowledge_source_type':
          return context.knowledgeSnippets.some((item) =>
            condition.sourceTypes.includes(item.sourceType)
          )
        case 'knowledge_keyword_hit':
          return matchKeywords(
            context.knowledgeSnippets.flatMap((item) => item.keywordHits ?? []).join(' '),
            condition.keywords,
            condition.match
          )
        case 'app_type':
          return condition.appTypes.includes(context.appType)
        case 'unknown_contact':
          return Boolean(context.isUnknownContact) === condition.value
        case 'route_test_text':
          return new RegExp(condition.pattern, 'i').test(context.routeTestText || '')
        default:
          return false
      }
    })
  }

  private textContext(context: IntentEvaluationContext): string {
    return [context.ocrText, context.routeTestText, context.currentContact].filter(Boolean).join(' ')
  }
}

function matchKeywords(
  text: string,
  keywords: string[],
  mode: 'any' | 'all',
  caseSensitive = false
): boolean {
  const haystack = caseSensitive ? text : text.toLocaleLowerCase()
  const checks = keywords.map((keyword) =>
    haystack.includes(caseSensitive ? keyword : keyword.toLocaleLowerCase())
  )
  return mode === 'all' ? checks.every(Boolean) : checks.some(Boolean)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
