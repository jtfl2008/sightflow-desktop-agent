import type {
  ChannelAdapterCapability,
  ChannelAdapterManifest,
  ChannelAdapterManifestValidationResult,
  ChannelAdapterPreset
} from './types'

const ALLOWED_CAPABILITIES: ChannelAdapterCapability[] = [
  'single_session',
  'multi_session_unread_scan',
  'header_contact_identity',
  'unread_badge_detection'
]

const FORBIDDEN_KEY_PATTERN =
  /(script|shell|command|exec|spawn|code|function|remote|download|url|href|marketplace)/i
const FORBIDDEN_STRING_PATTERN =
  /(https?:\/\/|file:\/\/|javascript:|node:child_process|\bbash\b|\bsh\b|\bpowershell\b|\bcmd\.exe\b)/i

export function manifestFromPreset(preset: ChannelAdapterPreset): ChannelAdapterManifest {
  return {
    schemaVersion: 1,
    manifestId: preset.presetId,
    version: '1.0.0',
    displayName: preset.displayName,
    appType: preset.appType,
    source: preset.source,
    officialSupport: false,
    capabilities: preset.capabilities,
    regions: {
      required: ['contactList', 'chatMain', 'inputBox'],
      optional: ['header', 'unreadIndicator']
    }
  }
}

export function validateChannelAdapterManifest(
  candidate: unknown
): ChannelAdapterManifestValidationResult {
  const errors: string[] = []
  const forbidden = findForbiddenManifestContent(candidate)
  if (forbidden) errors.push(forbidden)
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return invalid('adapter.manifest.invalid_shape', errors.concat('manifest must be an object'))
  }
  const manifest = candidate as Record<string, unknown>
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  for (const key of ['manifestId', 'version', 'displayName', 'appType']) {
    if (typeof manifest[key] !== 'string' || !String(manifest[key]).trim()) {
      errors.push(`${key} is required`)
    }
  }
  if (manifest.source !== 'local_preset' && manifest.source !== 'custom_manifest') {
    errors.push('source must be local_preset or custom_manifest')
  }
  if (manifest.officialSupport !== false) errors.push('officialSupport must be false')
  if (!Array.isArray(manifest.capabilities)) {
    errors.push('capabilities must be an array')
  } else {
    for (const capability of manifest.capabilities) {
      if (!ALLOWED_CAPABILITIES.includes(capability as ChannelAdapterCapability)) {
        errors.push(`unknown capability: ${String(capability)}`)
      }
    }
  }

  if (errors.length) return invalid('adapter.manifest.invalid', errors)
  return {
    valid: true,
    errors: [],
    manifest: {
      schemaVersion: 1,
      manifestId: manifest.manifestId as string,
      version: manifest.version as string,
      displayName: manifest.displayName as string,
      appType: manifest.appType as ChannelAdapterManifest['appType'],
      source: manifest.source as ChannelAdapterManifest['source'],
      officialSupport: false,
      capabilities: manifest.capabilities as ChannelAdapterCapability[],
      regions: {
        required: ['contactList', 'chatMain', 'inputBox'],
        optional: ['header', 'unreadIndicator']
      }
    }
  }
}

function invalid(
  errorCode: string,
  errors: string[]
): ChannelAdapterManifestValidationResult {
  return { valid: false, errorCode, errors }
}

function findForbiddenManifestContent(value: unknown, path: string[] = [], depth = 0): string | null {
  if (depth > 12 || value === null || value === undefined) return null
  if (typeof value === 'string') {
    return FORBIDDEN_STRING_PATTERN.test(value)
      ? `forbidden remote/script value at ${path.join('.') || 'value'}`
      : null
  }
  if (typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const finding = findForbiddenManifestContent(value[index], [...path, String(index)], depth + 1)
      if (finding) return finding
    }
    return null
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) return `forbidden executable key at ${[...path, key].join('.')}`
    const finding = findForbiddenManifestContent(child, [...path, key], depth + 1)
    if (finding) return finding
  }
  return null
}
