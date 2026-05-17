import {
  CUSTOMER_MEMORY_ALLOWED_RETENTION_DAYS,
  CUSTOMER_MEMORY_DEFAULT_SETTINGS,
  CUSTOMER_MEMORY_FIELD_BUDGETS,
  CustomerMemorySettings,
  CustomerMemorySuggestion,
  CustomerProfileFields,
  CustomerProfileRecord,
  ProviderInputCustomerProfile
} from './customer-memory-types'

export interface CustomerMemorySanitizeWarning {
  fieldPath: string
  code: string
  message: string
}

export interface CustomerMemorySanitizeResult {
  ok: boolean
  sanitizedFields: Partial<CustomerProfileFields>
  blockedFieldPaths: string[]
  warnings: CustomerMemorySanitizeWarning[]
  providerInputCharCount: number
}

const SECRET_KEYWORD_RE = /\b(api[-_ ]?key|token|secret|password|authorization|cookie)\b/i
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE_RE = /(?:\+?\d{1,3}[- ]?)?(?:\d[- ]?){10,14}\d/
const ID_OR_CARD_RE = /\b\d{15,19}\b|身份证|护照|银行卡|信用卡/
const ADDRESS_RE = /(?:地址|住址|门牌|小区|街道|路\d+号|省|市|区|县)/
const QR_OR_TOKEN_RE = /二维码|qrcode|access[_-]?token|refresh[_-]?token/i
const DATA_IMAGE_RE = /data:image\/[a-z0-9.+-]+;base64,/i
const LONG_BASE64_RE = /(?:[A-Za-z0-9+/]{80,}={0,2})/
const INFERRED_LABEL_RE = /高价值客户|容易流失|价格敏感|信用差|低价值客户|高风险客户|难缠客户/

export function normalizeCustomerMemorySettings(
  input: Partial<CustomerMemorySettings> = {}
): CustomerMemorySettings {
  const retention = CUSTOMER_MEMORY_ALLOWED_RETENTION_DAYS.includes(
    input.defaultRetentionDays as 30 | 90 | 180
  )
    ? (input.defaultRetentionDays as 30 | 90 | 180)
    : CUSTOMER_MEMORY_DEFAULT_SETTINGS.defaultRetentionDays

  return {
    ...CUSTOMER_MEMORY_DEFAULT_SETTINGS,
    ...input,
    enabled: input.enabled === true,
    defaultRetentionDays: retention,
    allowedRetentionDays: CUSTOMER_MEMORY_ALLOWED_RETENTION_DAYS,
    allowPermanentRetention: false,
    allowSuggestionFromHistorySummary: false,
    pendingSuggestionExpiresInDays: 7,
    requiresFieldLevelConfirmation: true,
    auditExportMode: 'redacted'
  }
}

export function sanitizeCustomerProfileFields(
  fields: Partial<CustomerProfileFields>
): CustomerMemorySanitizeResult {
  const warnings: CustomerMemorySanitizeWarning[] = []
  const blockedFieldPaths: string[] = []
  const sanitizedFields: Partial<CustomerProfileFields> = {}

  for (const [field, value] of Object.entries(fields) as Array<[
    keyof CustomerProfileFields,
    unknown
  ]>) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      const budget = arrayBudgetFor(field)
      if (budget && value.length > budget.maxItems) {
        block(field, 'budget.items', `${String(field)} exceeds item budget`)
        continue
      }

      const nextItems: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        const item = String(value[index]).trim()
        const fieldPath = `${String(field)}.${index}`
        if (budget && item.length > budget.maxChars) {
          block(fieldPath, 'budget.chars', `${fieldPath} exceeds character budget`)
          continue
        }
        if (containsProhibitedContent(item, fieldPath)) continue
        nextItems.push(item)
      }
      ;(sanitizedFields as Record<string, unknown>)[field] = nextItems
      continue
    }

    const text = typeof value === 'string' ? value.trim() : value
    if (typeof text === 'string') {
      const budget = scalarBudgetFor(field)
      if (budget && text.length > budget.maxChars) {
        block(field, 'budget.chars', `${String(field)} exceeds character budget`)
        continue
      }
      if (containsProhibitedContent(text, String(field))) continue
    }
    ;(sanitizedFields as Record<string, unknown>)[field] = text
  }

  const providerInputCharCount = JSON.stringify(sanitizedFields).length
  if (providerInputCharCount > CUSTOMER_MEMORY_FIELD_BUDGETS.providerInputMaxChars) {
    block('customerProfile', 'budget.provider_input', 'customerProfile exceeds ProviderInput budget')
  }

  return {
    ok: blockedFieldPaths.length === 0,
    sanitizedFields,
    blockedFieldPaths,
    warnings,
    providerInputCharCount
  }

  function block(fieldPath: string | number | symbol, code: string, message: string): void {
    const path = String(fieldPath)
    blockedFieldPaths.push(path)
    warnings.push({ fieldPath: path, code, message })
  }

  function containsProhibitedContent(value: string, fieldPath: string): boolean {
    const checks: Array<[RegExp, string, string]> = [
      [EMAIL_RE, 'pii.email', 'email addresses cannot be saved in customer memory'],
      [PHONE_RE, 'pii.phone', 'phone numbers cannot be saved in customer memory'],
      [ID_OR_CARD_RE, 'pii.id_or_card', 'identity or bank card data cannot be saved'],
      [ADDRESS_RE, 'pii.address', 'addresses cannot be saved in customer memory'],
      [SECRET_KEYWORD_RE, 'secret.keyword', 'secrets or credentials cannot be saved'],
      [QR_OR_TOKEN_RE, 'secret.token_or_qr', 'tokens or QR code references cannot be saved'],
      [DATA_IMAGE_RE, 'blob.data_image', 'base64 image data cannot be saved'],
      [LONG_BASE64_RE, 'blob.long_base64', 'long base64 data cannot be saved'],
      [INFERRED_LABEL_RE, 'inference.unconfirmed_label', 'unconfirmed evaluative labels cannot be saved']
    ]
    const matched = checks.find(([re]) => re.test(value))
    if (matched) {
      block(fieldPath, matched[1], matched[2])
      return true
    }
    if (looksLikeFullChatTranscript(value)) {
      block(fieldPath, 'history.full_chat', 'full chat transcripts cannot be saved')
      return true
    }
    return false
  }
}

export function canPromoteSuggestionToProfile(suggestion: CustomerMemorySuggestion): boolean {
  if (suggestion.status !== 'confirmed') return false
  if (Date.parse(suggestion.expiresAt) <= Date.now()) return false
  return sanitizeCustomerProfileFields(suggestion.suggestedFields).ok
}

export function buildProviderInputCustomerProfile(
  profile: CustomerProfileRecord
): { customerProfile?: ProviderInputCustomerProfile; omittedReason?: 'over_budget' | 'sanitized' } {
  const sanitized = sanitizeCustomerProfileFields(profile.fields)
  if (!sanitized.ok) return { omittedReason: 'sanitized' }

  const injectedFieldPaths = Object.entries(sanitized.sanitizedFields)
    .filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0))
    .map(([field]) => field)

  const customerProfile: ProviderInputCustomerProfile = {
    profileId: profile.profileId,
    version: String(profile.version),
    contactKeyHash: profile.contactKeyHash,
    displayName: profile.displayName,
    ...sanitized.sanitizedFields,
    injectedFieldPaths,
    updatedAt: profile.updatedAt,
    expiresAt: profile.expiresAt
  }

  if (JSON.stringify(customerProfile).length > CUSTOMER_MEMORY_FIELD_BUDGETS.providerInputMaxChars) {
    return { omittedReason: 'over_budget' }
  }

  return { customerProfile }
}

function arrayBudgetFor(
  field: keyof CustomerProfileFields
): { maxItems: number; maxChars: number } | null {
  const budgets = CUSTOMER_MEMORY_FIELD_BUDGETS as Record<string, unknown>
  const budget = budgets[field]
  return budget && typeof budget === 'object' && 'maxItems' in budget
    ? (budget as { maxItems: number; maxChars: number })
    : null
}

function scalarBudgetFor(field: keyof CustomerProfileFields): { maxChars: number } | null {
  const budgets = CUSTOMER_MEMORY_FIELD_BUDGETS as Record<string, unknown>
  const budget = budgets[field]
  return budget && typeof budget === 'object' && !('maxItems' in budget)
    ? (budget as { maxChars: number })
    : null
}

function looksLikeFullChatTranscript(value: string): boolean {
  const speakerLines = value
    .split(/\n+/)
    .filter((line) => /^(客户|用户|客服|agent|customer|user)\s*[:：]/i.test(line.trim()))
  return speakerLines.length >= 3 || /完整(聊天|对话)记录/.test(value)
}
