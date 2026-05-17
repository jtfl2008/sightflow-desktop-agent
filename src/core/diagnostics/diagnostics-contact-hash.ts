import {
  DIAGNOSTICS_SOURCES,
  DiagnosticsQuery,
  DiagnosticsQueryErrorCode,
  NormalizedDiagnosticsQuery
} from './diagnostics-types'

const ID_PATTERN = /^[A-Za-z0-9._:-]{6,128}$/
const CONTACT_HASH_PATTERNS = [
  /^ch_[a-f0-9]{4,64}$/i,
  /^[a-f0-9]{8,128}$/i,
  /^[A-Za-z0-9_-]{8,128}$/
]

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/
const URL_PATTERN = /https?:\/\//i
const SECRET_PATTERN = /(Bearer\s+[A-Za-z0-9._-]+|token\s*=|api[-_]?key\s*=|secret\s*=|sk-[A-Za-z0-9_-]+)/i
const CJK_NAME_PATTERN = /^[\u3040-\u30ff\u3400-\u9fff]{2,8}$/
const NATURAL_LANGUAGE_PATTERN = /^[A-Za-z]+(?:\s+[A-Za-z]+){1,4}$/

export type DiagnosticsQueryValidationResult =
  | { ok: true; query: NormalizedDiagnosticsQuery }
  | { ok: false; errorCode: DiagnosticsQueryErrorCode; message: string }

export function validateDiagnosticsQuery(input: DiagnosticsQuery): DiagnosticsQueryValidationResult {
  if (!DIAGNOSTICS_SOURCES.includes(input.source)) {
    return fail('invalid_source', 'Invalid diagnostics source')
  }
  if (!input.runId && !input.draftId && !input.contactHash) {
    return fail('empty_query', 'Provide runId, draftId, or contactHash')
  }
  if (input.runId !== undefined && !ID_PATTERN.test(input.runId)) {
    return fail('invalid_run_id', 'Invalid runId')
  }
  if (input.draftId !== undefined && !ID_PATTERN.test(input.draftId)) {
    return fail('invalid_draft_id', 'Invalid draftId')
  }
  if (input.contactHash !== undefined) {
    const trimmed = input.contactHash.trim()
    if (CONTACT_HASH_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      return {
        ok: true,
        query: {
          ...input,
          runId: input.runId?.trim(),
          draftId: input.draftId?.trim(),
          contactHash: trimmed,
          limit: clampInteger(input.limit, 1, 200, 50),
          offset: clampInteger(input.offset, 0, 10000, 0)
        }
      }
    }
    if (looksLikePlaintextContact(trimmed)) {
      return fail('plaintext_contact_rejected', '请输入 contactHash，不能查询联系人明文')
    }
    return fail('invalid_contact_hash', 'Invalid contactHash')
  }

  return {
    ok: true,
    query: {
      ...input,
      runId: input.runId?.trim(),
      draftId: input.draftId?.trim(),
      contactHash: undefined,
      limit: clampInteger(input.limit, 1, 200, 50),
      offset: clampInteger(input.offset, 0, 10000, 0)
    }
  }
}

export function looksLikePlaintextContact(value: string): boolean {
  if (!value) return false
  return (
    EMAIL_PATTERN.test(value) ||
    PHONE_PATTERN.test(value) ||
    URL_PATTERN.test(value) ||
    SECRET_PATTERN.test(value) ||
    value.includes('@') ||
    value.includes('+81') ||
    CJK_NAME_PATTERN.test(value) ||
    NATURAL_LANGUAGE_PATTERN.test(value)
  )
}

function fail(
  errorCode: DiagnosticsQueryErrorCode,
  message: string
): DiagnosticsQueryValidationResult {
  return { ok: false, errorCode, message }
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}
