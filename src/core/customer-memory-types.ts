import type { AppType } from './rpa/types'

export type CustomerMemoryRetentionDays = 30 | 90 | 180

export const CUSTOMER_MEMORY_ALLOWED_RETENTION_DAYS: readonly CustomerMemoryRetentionDays[] = [
  30,
  90,
  180
]

export const CUSTOMER_MEMORY_DEFAULT_SETTINGS = {
  enabled: false,
  defaultRetentionDays: 180 as CustomerMemoryRetentionDays,
  allowedRetentionDays: CUSTOMER_MEMORY_ALLOWED_RETENTION_DAYS,
  allowPermanentRetention: false,
  allowSuggestionFromHistorySummary: false,
  pendingSuggestionExpiresInDays: 7,
  providerInjectionEnabledByDefault: true,
  requiresFieldLevelConfirmation: true,
  auditExportMode: 'redacted' as const
}

export interface CustomerMemorySettings {
  enabled: boolean
  defaultRetentionDays: CustomerMemoryRetentionDays
  allowedRetentionDays: readonly CustomerMemoryRetentionDays[]
  allowPermanentRetention: false
  allowSuggestionFromHistorySummary: false
  pendingSuggestionExpiresInDays: 7
  providerInjectionEnabledByDefault: boolean
  requiresFieldLevelConfirmation: true
  auditExportMode: 'redacted'
}

export interface CustomerProfileFields {
  relationship?: 'lead' | 'customer' | 'partner' | 'vendor' | 'internal' | 'unknown'
  preferenceNotes?: string[]
  businessContext?: string[]
  productInterests?: string[]
  doNotMention?: string[]
  languagePreference?: string
  tonePreference?: 'formal' | 'friendly' | 'concise' | 'detailed'
  lastConfirmedSummary?: string
  userPinnedNotes?: string[]
}

export interface CustomerProfileProvenance {
  fieldPath: string
  source: 'user_entered' | 'user_confirmed_suggestion' | 'imported_local'
  confirmedByUser: true
  createdAt: string
  auditId?: string
}

export interface CustomerProfileRecord {
  profileId: string
  contactKeyHash: string
  displayName?: string
  sourceAppType: AppType
  version: number
  disabled: boolean
  createdAt: string
  updatedAt: string
  expiresAt?: string
  fields: CustomerProfileFields
  provenance: CustomerProfileProvenance[]
}

export interface CustomerProfileTombstone {
  profileId: string
  contactKeyHash: string
  deletedAt: string
  deletedBy: 'local_user'
  reason: 'user_deleted' | 'retention_expired' | 'clear_all'
}

export interface CustomerMemorySuggestion {
  suggestionId: string
  contactKeyHash: string
  sourceAppType: AppType
  createdAt: string
  expiresAt: string
  suggestedFields: Partial<CustomerProfileFields>
  sourceAuditId?: string
  status: 'pending' | 'confirmed' | 'dismissed' | 'expired'
  sanitizerWarnings: string[]
}

export interface CustomerMemoryStoreShape {
  settings: CustomerMemorySettings
  profilesById: Record<string, CustomerProfileRecord>
  profileIdsByContactKeyHash: Record<string, string>
  tombstonesByContactKeyHash: Record<string, CustomerProfileTombstone>
  pendingSuggestionsById: Record<string, CustomerMemorySuggestion>
}

export interface ProviderInputCustomerProfile {
  profileId: string
  version: string
  contactKeyHash: string
  displayName?: string
  relationship?: string
  preferenceNotes?: string[]
  businessContext?: string[]
  productInterests?: string[]
  doNotMention?: string[]
  languagePreference?: string
  tonePreference?: string
  lastConfirmedSummary?: string
  injectedFieldPaths: string[]
  updatedAt: string
  expiresAt?: string
}

export type CustomerMemoryOmittedReason =
  | 'disabled'
  | 'missing_contact'
  | 'not_found'
  | 'expired'
  | 'over_budget'
  | 'not_confirmed'
  | 'deleted'
  | 'sanitized'
  | 'missing_header'
  | 'contact_not_verified'

export interface CustomerMemoryRuntimePreflightInput {
  appType: AppType
  contactKey?: string
  contactVerified?: boolean
  hasReliableHeader?: boolean
  multiSessionEnabled?: boolean
  perRunMemoryDisabled?: boolean
  runtimeDecision: 'allow_provider' | 'draft_review' | 'skip_provider' | 'blocked' | 'manual_takeover'
}

export interface CustomerMemoryRuntimePreflightResult {
  customerProfile?: ProviderInputCustomerProfile
  omittedReason?: CustomerMemoryOmittedReason
  contactKeyHash?: string
  injectedFieldPaths: string[]
  safetyHintApplied: boolean
}

export const CUSTOMER_MEMORY_FIELD_BUDGETS = {
  preferenceNotes: { maxItems: 10, maxChars: 120 },
  businessContext: { maxItems: 10, maxChars: 160 },
  productInterests: { maxItems: 20, maxChars: 80 },
  doNotMention: { maxItems: 20, maxChars: 80 },
  userPinnedNotes: { maxItems: 20, maxChars: 120 },
  lastConfirmedSummary: { maxChars: 600 },
  providerInputMaxChars: 3000
} as const
