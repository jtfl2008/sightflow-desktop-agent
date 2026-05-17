import {
  DiagnosticsBlockedType,
  DiagnosticsRedactionSummary
} from './diagnostics-types'

const RAW_SCREENSHOT_KEY = /(raw|full).*screenshot|screenshot.*(raw|full)|imageBytes|rawImage/i
const BASE64_KEY = /base64|dataUrl|data:image/i
const FULL_CHAT_KEY = /fullChat|chatTranscript|ocrText|messageText|pendingText/i
const PLAINTEXT_CONTACT_KEY = /currentContact|contactName|displayName|phone|email|address|avatar|qrCode/i
const FULL_PROFILE_KEY =
  /customerProfile|profileFields|preferenceNotes|businessContext|doNotMention|lastConfirmedSummary/i
const PROVIDER_CONFIG_KEY = /providerConfig|configValues|apiKey|token|secret|password|authorization|cookie/i
const WEBHOOK_BODY_KEY = /webhookBody|requestBody|responseBody|headers/i

const DATA_IMAGE_PATTERN = /data:image\//i
const LONG_BASE64_PATTERN = /\b[A-Za-z0-9+/]{200,}={0,2}\b/
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/
const SECRET_VALUE_PATTERN =
  /(Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]+|(?:api[-_]?key|token|secret|password)[:=]\s*[A-Za-z0-9._-]+)/i
const URL_QUERY_SECRET_PATTERN = /https?:\/\/\S+[?&](token|secret|api_key|apikey|key)=/i

export interface DiagnosticsRedactionCheckOptions {
  now?: () => Date
  countUnknownNestedObjects?: boolean
}

export function checkDiagnosticsRedaction(
  value: unknown,
  options: DiagnosticsRedactionCheckOptions = {}
): DiagnosticsRedactionSummary {
  const blockedTypes = new Set<DiagnosticsBlockedType>()
  const omittedFieldPaths: string[] = []
  let unknownFieldCount = 0

  function visit(current: unknown, path: string, depth: number): void {
    if (depth > 12) {
      unknownFieldCount += 1
      omittedFieldPaths.push(path || '$')
      blockedTypes.add('unknown_nested_object')
      return
    }
    if (current === null || current === undefined) return
    if (typeof current === 'string') {
      detectSensitiveString(current, path)
      return
    }
    if (typeof current === 'number' || typeof current === 'boolean') return
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1))
      return
    }
    if (typeof current !== 'object') return

    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key
      const type = blockedTypeForKey(key)
      if (type) {
        blockedTypes.add(type)
        omittedFieldPaths.push(childPath)
        continue
      }
      if (options.countUnknownNestedObjects && isNonEmptyRecord(child)) {
        unknownFieldCount += 1
        omittedFieldPaths.push(childPath)
      }
      visit(child, childPath, depth + 1)
    }
  }

  function detectSensitiveString(text: string, path: string): void {
    if (DATA_IMAGE_PATTERN.test(text)) add('base64', path)
    if (LONG_BASE64_PATTERN.test(text)) add('base64', path)
    if (EMAIL_PATTERN.test(text) || PHONE_PATTERN.test(text)) add('plaintext_contact', path)
    if (SECRET_VALUE_PATTERN.test(text) || URL_QUERY_SECRET_PATTERN.test(text)) add('secrets', path)
  }

  function add(type: DiagnosticsBlockedType, path: string): void {
    blockedTypes.add(type)
    omittedFieldPaths.push(path || '$')
  }

  visit(value, '', 0)

  const uniqueBlockedTypes = [...blockedTypes].sort()
  return {
    status: uniqueBlockedTypes.length > 0 ? 'blocked' : 'passed',
    blockedTypes: uniqueBlockedTypes,
    omittedFieldPaths: [...new Set(omittedFieldPaths)].sort(),
    unknownFieldCount,
    checkedAt: (options.now ?? (() => new Date()))().toISOString()
  }
}

function blockedTypeForKey(key: string): DiagnosticsBlockedType | null {
  if (RAW_SCREENSHOT_KEY.test(key)) return 'raw_screenshot'
  if (BASE64_KEY.test(key)) return 'base64'
  if (FULL_CHAT_KEY.test(key)) return 'full_chat'
  if (PLAINTEXT_CONTACT_KEY.test(key)) return 'plaintext_contact'
  if (FULL_PROFILE_KEY.test(key)) return 'full_profile'
  if (PROVIDER_CONFIG_KEY.test(key)) return 'provider_config_values'
  if (WEBHOOK_BODY_KEY.test(key)) return 'webhook_body'
  return null
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length > 0
}
