import { AppType } from './rpa/types'
import type { IntentContext, RouteDecision } from './intent-types'
import type {
  CustomerMemoryOmittedReason,
  ProviderInputCustomerProfile
} from './customer-memory-types'

export type ProviderInputChannelFinalAction = 'allow_send' | 'draft_review' | 'pause'

export interface ProviderInputChannelContext {
  multiSessionEnabled: boolean
  headerConfigured: boolean
  unreadIndicatorConfigured: boolean
  currentContactVerified: boolean
  contactKeyHash?: string
  customerMemoryOmittedReason?:
    | CustomerMemoryOmittedReason
    | 'missing_header'
    | 'contact_not_verified'
  finalAction: ProviderInputChannelFinalAction
  reasons: string[]
}

export interface ProviderInput {
  screenshot: string
  appType: AppType
  currentContact?: string
  ocrText?: string
  draftMode?: ReplyReviewMode | 'manual_takeover'
  knowledgeSnippets?: Array<{
    id: string
    title: string
    content: string
    sourceType: string
    score?: number
  }>
  policyHints?: Array<{
    id: string
    label: string
    severity: 'info' | 'requires_review' | 'blocked'
    reason: string
    source: 'policy' | 'intent_route' | 'knowledge'
  }>
  intent?: IntentContext
  route?: RouteDecision
  customerProfile?: ProviderInputCustomerProfile
  channelContext?: ProviderInputChannelContext
}

export type ProviderEvent =
  | { type: 'thinking'; content: string }
  | { type: 'reply_text'; content: string }
  | { type: 'skip' }
  | { type: 'error'; error: string }

export type ReplyReviewMode = 'auto_send' | 'draft_review'

export type ReplyDraftStatus = 'pending' | 'approved' | 'skipped' | 'takeover'

export interface ReplyDraft {
  id: string
  content: string
  appType: AppType
  screenshot: string
  status: ReplyDraftStatus
  riskLabels?: string[]
  policyReasons?: string[]
  createdAt: number
  resolvedAt?: number
}

export type SessionEvent =
  | { type: 'bootstrap' }
  | { type: 'observe_chat' }
  | { type: 'provider.thinking'; content: string }
  | { type: 'provider.reply_text'; content: string }
  | { type: 'provider.skip' }
  | { type: 'provider.error'; error: string }
  | { type: 'draft.approve'; draftId: string; content?: string }
  | { type: 'draft.skip'; draftId: string }
  | { type: 'draft.takeover'; draftId: string }
  | { type: 'check_unread' }
  | { type: 'wait_retry'; reason?: string; delayMs?: number }

export interface ProviderAdapter {
  run(input: ProviderInput): AsyncIterable<ProviderEvent>
}

export interface RuntimeHostControls {
  enqueue(event: SessionEvent): void
  schedule(event: SessionEvent, delayMs: number): void
  runProvider(input: ProviderInput): AsyncIterable<ProviderEvent>
  log(type: 'thinking' | 'reply' | 'skip' | 'error', content: string): void
  isRunning(): boolean
  stopSession(reason?: string): Promise<void>
}

export interface ChannelContext<TState> {
  appType: AppType
  state: TState
  host: RuntimeHostControls
}

export interface ChannelSession<TState> {
  onStart(ctx: ChannelContext<TState>): Promise<void>
  onStop(ctx: ChannelContext<TState>): Promise<void>
  onEvent(event: SessionEvent, ctx: ChannelContext<TState>): Promise<void>
}
