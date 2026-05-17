import type { AppType, BoxRegions, ScreenRect } from '../rpa/types'
import type {
  AdapterRegions,
  ChannelAdapterPresetSource,
  ChannelAdapterSettings,
  ChannelAdapterSettingsInput
} from './types'

export function defaultChannelAdapterSettings(
  appType: AppType,
  now: () => Date = () => new Date()
): ChannelAdapterSettings {
  return {
    appType,
    manifestId: '',
    version: '',
    enabled: false,
    multiSessionEnabled: false,
    presetSource: 'local_preset',
    officialSupport: false,
    capabilities: ['single_session'],
    headerConfigured: false,
    unreadIndicatorConfigured: false,
    runtimeMode: 'single_session',
    safetyMode: 'default_single_session',
    updatedAt: now().toISOString()
  }
}

export function normalizeChannelAdapterSettings(
  input: ChannelAdapterSettingsInput,
  now: () => Date = () => new Date()
): ChannelAdapterSettings {
  const base = defaultChannelAdapterSettings(input.appType, now)
  const enabled = input.enabled === true
  const multiSessionEnabled = enabled && input.multiSessionEnabled === true
  const headerConfigured = input.headerConfigured === true
  const unreadIndicatorConfigured = input.unreadIndicatorConfigured === true
  const multiSessionReady = multiSessionEnabled && headerConfigured && unreadIndicatorConfigured
  const presetSource = normalizePresetSource(input.presetSource)
  return {
    ...base,
    manifestId: stringValue(input.manifestId),
    version: stringValue(input.version),
    enabled,
    multiSessionEnabled,
    presetSource,
    officialSupport: false,
    capabilities: normalizeCapabilities(input.capabilities),
    headerConfigured,
    unreadIndicatorConfigured,
    runtimeMode: multiSessionEnabled
      ? multiSessionReady
        ? 'multi_session'
        : 'degraded_single_session'
      : 'single_session',
    safetyMode: multiSessionEnabled
      ? multiSessionReady
        ? 'auto_switch_allowed'
        : 'draft_review_only'
      : 'default_single_session',
    installedAt: optionalString(input.installedAt),
    lastVerifiedAt: optionalString(input.lastVerifiedAt),
    updatedAt: now().toISOString()
  }
}

export function normalizeAdapterRegions(regions: BoxRegions | null | undefined): AdapterRegions | null {
  if (!regions) return null
  return {
    ...regions,
    header: normalizeRect(regions.header),
    unreadIndicator: normalizeRect(regions.unreadIndicator),
    adapterId: optionalString(regions.adapterId),
    adapterVersion: optionalString(regions.adapterVersion),
    multiSessionEnabled: regions.multiSessionEnabled === true
  }
}

function normalizePresetSource(value: unknown): ChannelAdapterPresetSource {
  return value === 'custom_manifest' ? 'custom_manifest' : 'local_preset'
}

function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return ['single_session']
  const items = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  )
  const unique = Array.from(new Set(items))
  return unique.includes('single_session') ? unique : ['single_session', ...unique]
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizeRect(value: ScreenRect | null | undefined): ScreenRect | null {
  if (!value) return null
  return value
}
