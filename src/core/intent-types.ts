import type { ReplyReviewMode } from './session-types'
import { AppType } from './rpa/types'

export type BuiltInIntentId =
  | 'pricing_inquiry'
  | 'product_inquiry'
  | 'after_sales'
  | 'order_status'
  | 'appointment'
  | 'complaint'
  | 'human_handoff'
  | 'greeting'
  | 'spam_or_noise'
  | 'sensitive_action'
  | 'unknown'

export type KnowledgeSourceType = 'manual' | 'faq' | 'doc' | 'url'

export type RouteAction =
  | 'run_provider'
  | 'run_provider_requires_review'
  | 'skip_provider'
  | 'manual_takeover'
  | 'blocked'

export interface KnowledgeSnippet {
  id: string
  title: string
  content: string
  sourceType: KnowledgeSourceType | string
  score?: number
  keywordHits?: string[]
}

export interface PolicyHint {
  id: string
  label: string
  severity: 'info' | 'requires_review' | 'blocked'
  reason: string
  source: 'policy' | 'intent_route' | 'knowledge'
}

export interface IntentRoutingSettings {
  enabled: boolean
  minConfidenceForAutoRoute: number
  maxCandidateIntents: number
  fallbackIntentId: string
  fallbackRouteId: string
  rules: IntentRule[]
  routes: IntentRoute[]
  promptPresets: PromptPreset[]
}

export interface IntentRule {
  id: string
  enabled: boolean
  priority: number
  intentId: string
  label: string
  conditions: IntentCondition[]
  score: number
  stopOnMatch?: boolean
}

export type IntentCondition =
  | { type: 'keyword'; keywords: string[]; match: 'any' | 'all'; caseSensitive?: boolean }
  | { type: 'knowledge_source_type'; sourceTypes: string[] }
  | { type: 'knowledge_keyword_hit'; keywords: string[]; match: 'any' | 'all' }
  | { type: 'app_type'; appTypes: AppType[] }
  | { type: 'unknown_contact'; value: boolean }
  | { type: 'route_test_text'; pattern: string }

export interface IntentRoute {
  id: string
  enabled: boolean
  priority: number
  intentIds: string[]
  label: string
  action: RouteAction
  promptPresetId?: string
  forcedReplyMode?: ReplyReviewMode | 'manual_takeover'
  requiredKnowledgeSourceTypes?: string[]
  policyHintIds?: string[]
  auditTags?: string[]
}

export interface PromptPreset {
  id: string
  label: string
  systemHint: string
  enabled: boolean
}

export interface IntentEvaluationContext {
  appType: AppType
  currentContact?: string
  isUnknownContact?: boolean
  ocrText?: string
  routeTestText?: string
  knowledgeSnippets: KnowledgeSnippet[]
  replyMode: ReplyReviewMode
  now: number
}

export interface IntentCandidate {
  intentId: string
  label: string
  confidence: number
  matchedRuleIds: string[]
  reasons: string[]
}

export interface IntentContext {
  primaryIntentId: string
  candidates: IntentCandidate[]
  confidence: number
  fallbackUsed: boolean
  fallbackReason?: 'disabled' | 'no_match' | 'low_confidence' | 'route_disabled'
  matchedKnowledgeIds: string[]
}

export interface RouteDecision {
  routeId: string
  label: string
  action: RouteAction
  forcedReplyMode?: ReplyReviewMode | 'manual_takeover'
  promptPresetId?: string
  promptHint?: string
  requiredKnowledgeSourceTypes?: string[]
  policyHints: PolicyHint[]
  auditTags: string[]
}

export interface IntentRouterResult {
  intent: IntentContext
  route: RouteDecision
  matchedRules: IntentRule[]
  matchedKnowledge: Array<{ id: string; title: string; sourceType: string }>
}
