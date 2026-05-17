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

export type ChannelAdapterCapability = ChannelAdapterPreset['capabilities'][number]

export interface ChannelAdapterManifest {
  schemaVersion: 1
  manifestId: string
  version: string
  displayName: string
  appType: AppType
  source: ChannelAdapterPresetSource
  officialSupport: false
  capabilities: ChannelAdapterCapability[]
  regions?: {
    required: Array<'contactList' | 'chatMain' | 'inputBox'>
    optional?: Array<'header' | 'unreadIndicator'>
  }
}

export interface ChannelAdapterManifestValidationResult {
  valid: boolean
  manifest?: ChannelAdapterManifest
  errorCode?: string
  errors: string[]
}

export type AdapterRuntimeMode =
  | 'single_session'
  | 'multi_session'
  | 'degraded_single_session'
  | 'paused'

export type ClickVerifyStatus =
  | 'not_attempted'
  | 'candidate_detected'
  | 'clicked'
  | 'verified'
  | 'failed'
  | 'skipped_low_confidence'
  | 'skipped_out_of_bounds'

export type DegradedReason =
  | 'multi_session_disabled'
  | 'missing_header'
  | 'missing_unread_indicator'
  | 'unread_low_confidence'
  | 'candidate_out_of_bounds'
  | 'click_verify_failed'
  | 'repeated_failures'
  | 'invalid_manifest'

export interface ChannelAdapterRuntimeState {
  runId: string
  appType: AppType
  manifestId?: string
  manifestVersion?: string
  currentMode: AdapterRuntimeMode
  multiSessionEnabled: boolean
  headerConfigured: boolean
  unreadIndicatorConfigured: boolean
  unreadConfidence?: number
  clickVerifyStatus: ClickVerifyStatus
  degradedReason?: DegradedReason
  failureCountForSession: number
  finalAction: 'draft_review' | 'pause' | 'allow_send'
}
