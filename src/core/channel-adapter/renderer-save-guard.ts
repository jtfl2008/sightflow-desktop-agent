import {
  defaultChannelAdapterSettings,
  normalizeChannelAdapterSettings
} from './settings-normalizer'
import type {
  ChannelAdapterPreset,
  ChannelAdapterSettings,
  ChannelAdapterSettingsInput
} from './types'
import { manifestFromPreset, validateChannelAdapterManifest } from './manifest-validator'
import type { AppType } from '../rpa/types'

export interface RendererChannelAdapterSaveResult {
  ok: boolean
  settings?: ChannelAdapterSettings
  errorCode?: string
  error?: string
}

export function validateRendererChannelAdapterSetEnabled(
  input: ChannelAdapterSettingsInput,
  presets: ChannelAdapterPreset[],
  now: () => Date = () => new Date()
): RendererChannelAdapterSaveResult {
  return validateRendererChannelAdapterSave(
    {
      appType: input.appType,
      manifestId: input.manifestId,
      enabled: input.enabled,
      multiSessionEnabled: input.multiSessionEnabled,
      headerConfigured: input.headerConfigured,
      unreadIndicatorConfigured: input.unreadIndicatorConfigured,
      officialSupport: input.officialSupport,
      capabilities: input.capabilities,
      runtimeMode: input.runtimeMode,
      safetyMode: input.safetyMode
    },
    presets,
    now
  )
}

export function buildChannelAdapterDisabledFallback(
  appType: AppType,
  now: () => Date = () => new Date()
): ChannelAdapterSettings {
  return normalizeChannelAdapterSettings(
    {
      ...defaultChannelAdapterSettings(appType, now),
      appType,
      manifestId: '',
      enabled: false,
      multiSessionEnabled: false,
      capabilities: ['single_session']
    },
    now
  )
}

export function validateRendererChannelAdapterSave(
  input: ChannelAdapterSettingsInput,
  presets: ChannelAdapterPreset[],
  now: () => Date = () => new Date()
): RendererChannelAdapterSaveResult {
  const appType = coerceKnownAppType(input?.appType)
  const manifestId = typeof input?.manifestId === 'string' ? input.manifestId : ''
  const preset = presets.find((item) => item.presetId === manifestId)
  if (!preset) {
    return reject('adapter.manifest.not_found', 'manifest not found')
  }
  if (preset.appType !== appType) {
    return reject('adapter.manifest.app_type_mismatch', 'manifest appType mismatch')
  }
  const validation = validateChannelAdapterManifest(manifestFromPreset(preset))
  if (!validation.valid || !validation.manifest) {
    return reject(validation.errorCode || 'adapter.manifest.invalid', validation.errors.join('; '))
  }

  const expected = normalizeChannelAdapterSettings(
    {
      ...defaultChannelAdapterSettings(appType, now),
      appType,
      manifestId: validation.manifest.manifestId,
      version: validation.manifest.version,
      enabled: input?.enabled === true,
      multiSessionEnabled: input?.enabled === true && input?.multiSessionEnabled === true,
      presetSource: validation.manifest.source,
      officialSupport: false,
      capabilities: validation.manifest.capabilities,
      headerConfigured: input?.headerConfigured === true,
      unreadIndicatorConfigured: input?.unreadIndicatorConfigured === true
    },
    now
  )

  const forged = findForgedRendererFields(input, expected)
  if (forged) return reject(forged.errorCode, forged.error)

  return { ok: true, settings: expected }
}

function findForgedRendererFields(
  input: ChannelAdapterSettingsInput,
  expected: ChannelAdapterSettings
): { errorCode: string; error: string } | null {
  if (input.officialSupport !== undefined && input.officialSupport !== false) {
    return {
      errorCode: 'adapter.settings.forged_official_support',
      error: 'officialSupport cannot be supplied by renderer'
    }
  }
  if (input.runtimeMode !== undefined && input.runtimeMode !== expected.runtimeMode) {
    return {
      errorCode: 'adapter.settings.forged_runtime_mode',
      error: 'runtimeMode does not match validated settings'
    }
  }
  if (input.safetyMode !== undefined && input.safetyMode !== expected.safetyMode) {
    return {
      errorCode: 'adapter.settings.forged_safety_mode',
      error: 'safetyMode does not match validated settings'
    }
  }
  if (input.capabilities !== undefined && !sameStringSet(input.capabilities, expected.capabilities)) {
    return {
      errorCode: 'adapter.settings.unknown_capability',
      error: 'capabilities must match the validated manifest'
    }
  }
  return null
}

function sameStringSet(value: unknown, expected: string[]): boolean {
  if (!Array.isArray(value)) return false
  const items = value.filter((item): item is string => typeof item === 'string')
  return (
    items.length === value.length &&
    items.length === expected.length &&
    expected.every((item) => items.includes(item))
  )
}

function reject(errorCode: string, error: string): RendererChannelAdapterSaveResult {
  return { ok: false, errorCode, error }
}

function coerceKnownAppType(value: unknown): AppType {
  return value === 'wechat' ||
    value === 'wework' ||
    value === 'dingtalk' ||
    value === 'lark' ||
    value === 'slack' ||
    value === 'telegram' ||
    value === 'generic'
    ? value
    : 'generic'
}
