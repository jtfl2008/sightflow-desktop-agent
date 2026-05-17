import { createHash } from 'node:crypto'
import * as path from 'node:path'
import type { ProviderBundleManifest } from '../provider-bundle'
import type {
  ProviderArtifactDeclaration,
  ProviderManifestSecurityExtension,
  ProviderSecurityErrorCode
} from './provider-security-types'

export interface ProviderBundleManifestSecurityExtension {
  security?: ProviderManifestSecurityExtension
  artifacts?: ProviderArtifactDeclaration[]
}

export type SecureProviderBundleManifest = ProviderBundleManifest &
  ProviderBundleManifestSecurityExtension

export function canonicalizeJcs(value: unknown): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'number':
      if (!Number.isFinite(value)) throw new Error('JCS does not support non-finite numbers')
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'object':
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalizeJcs(item)).join(',')}]`
      }
      return canonicalizeObject(value as Record<string, unknown>)
    default:
      throw new Error(`JCS does not support ${typeof value}`)
  }
}

export function canonicalizeProviderManifestForSignature(
  manifest: SecureProviderBundleManifest
): string {
  const clone = cloneForCanonicalization(manifest)
  if (clone.security && typeof clone.security === 'object') {
    delete (clone.security as Record<string, unknown>).signature
  }
  return canonicalizeJcs(clone)
}

export function sha256Hex(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function validateProviderEntryPath(entry: string): {
  valid: boolean
  normalizedPath?: string
  code?: ProviderSecurityErrorCode
  message?: string
} {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(entry) || entry.startsWith('//')) {
    return {
      valid: false,
      code: 'provider.security.entry_unsupported_protocol',
      message: `entry must be a relative file path: ${entry}`
    }
  }

  if (path.isAbsolute(entry) || entry.startsWith('/') || entry.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(entry)) {
    return {
      valid: false,
      code: 'provider.security.entry_absolute_path',
      message: `entry must not be absolute: ${entry}`
    }
  }

  const normalizedPath = path.posix.normalize(entry.replace(/\\/g, '/'))
  if (normalizedPath === '.' || normalizedPath.startsWith('../') || normalizedPath.includes('/../')) {
    return {
      valid: false,
      code: 'provider.security.entry_path_escape',
      message: `entry must stay within the provider bundle: ${entry}`
    }
  }

  return { valid: true, normalizedPath }
}

function canonicalizeObject(value: Record<string, unknown>): string {
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJcs(value[key])}`).join(',')}}`
}

function cloneForCanonicalization(value: unknown): any {
  if (Array.isArray(value)) return value.map((item) => cloneForCanonicalization(item))
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) out[key] = cloneForCanonicalization(child)
  }
  return out
}
