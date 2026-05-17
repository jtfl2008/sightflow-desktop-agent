import type { AppType, BoxRegions, CaptureStrategy, ScreenRect } from '../rpa/types'

export type ChannelAdapterPresetSource = 'local_preset' | 'custom_manifest'
export type ChannelAdapterRuntimeMode =
  | 'single_session'
  | 'multi_session'
  | 'degraded_single_session'
export type ChannelAdapterSafetyMode =
  | 'default_single_session'
  | 'draft_review_only'
  | 'auto_switch_allowed'

export interface ChannelAdapterSettings {
  appType: AppType
  manifestId: string
  version: string
  enabled: boolean
  multiSessionEnabled: boolean
  presetSource: ChannelAdapterPresetSource
  officialSupport: false
  capabilities: string[]
  headerConfigured: boolean
  unreadIndicatorConfigured: boolean
  runtimeMode: ChannelAdapterRuntimeMode
  safetyMode: ChannelAdapterSafetyMode
  installedAt?: string
  lastVerifiedAt?: string
  updatedAt: string
}

export interface ChannelAdapterSettingsInput {
  appType: AppType
  manifestId?: unknown
  version?: unknown
  enabled?: unknown
  multiSessionEnabled?: unknown
  presetSource?: unknown
  officialSupport?: unknown
  capabilities?: unknown
  headerConfigured?: unknown
  unreadIndicatorConfigured?: unknown
  runtimeMode?: unknown
  safetyMode?: unknown
  installedAt?: unknown
  lastVerifiedAt?: unknown
  updatedAt?: unknown
}

export interface AdapterRegions extends BoxRegions {
  header?: ScreenRect | null
  adapterId?: string
  adapterVersion?: string
  multiSessionEnabled?: boolean
}

export interface PerAppCaptureWithAdapter {
  strategy: CaptureStrategy
  regions: AdapterRegions | null
  channelAdapter?: ChannelAdapterSettings | null
}

export interface ChannelAdapterPreset {
  presetId:
    | 'generic-basic'
    | 'slack-local-basic'
    | 'lark-local-basic'
    | 'dingtalk-local-basic'
  displayName: string
  appType: AppType
  source: 'local_preset'
  officialSupport: false
  description: string
  defaultSettings: {
    enabled: false
    multiSessionEnabled: false
  }
  capabilities: Array<
    | 'single_session'
    | 'multi_session_unread_scan'
    | 'header_contact_identity'
    | 'unread_badge_detection'
  >
  status: 'default' | 'installed' | 'incomplete' | 'verified'
}
