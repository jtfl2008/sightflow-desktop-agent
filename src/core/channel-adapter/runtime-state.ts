import type { AppType } from '../rpa/types'
import type {
  ChannelAdapterRuntimeState,
  ChannelAdapterSettings,
  DegradedReason
} from './types'

export function createChannelAdapterRuntimeState(input: {
  appType: AppType
  settings: ChannelAdapterSettings
  invalidManifest?: boolean
  failureCountForSession?: number
  unreadConfidence?: number
  runId?: string
}): ChannelAdapterRuntimeState {
  const failureCountForSession = input.failureCountForSession ?? 0
  const degradedReason = resolveDegradedReason(input.settings, input.invalidManifest)
  const currentMode = input.invalidManifest
    ? 'degraded_single_session'
    : input.settings.multiSessionEnabled
      ? degradedReason
        ? 'degraded_single_session'
        : 'multi_session'
      : 'single_session'
  return {
    runId: input.runId ?? `adapter-${Date.now()}`,
    appType: input.appType,
    manifestId: input.settings.manifestId || undefined,
    manifestVersion: input.settings.version || undefined,
    currentMode,
    multiSessionEnabled: input.settings.multiSessionEnabled,
    headerConfigured: input.settings.headerConfigured,
    unreadIndicatorConfigured: input.settings.unreadIndicatorConfigured,
    unreadConfidence: input.unreadConfidence,
    clickVerifyStatus: input.settings.multiSessionEnabled ? 'not_attempted' : 'skipped_low_confidence',
    degradedReason,
    failureCountForSession,
    finalAction:
      input.invalidManifest || degradedReason === 'missing_header'
        ? 'draft_review'
        : currentMode === 'multi_session'
          ? 'allow_send'
          : 'draft_review'
  }
}

function resolveDegradedReason(
  settings: ChannelAdapterSettings,
  invalidManifest?: boolean
): DegradedReason | undefined {
  if (invalidManifest) return 'invalid_manifest'
  if (!settings.multiSessionEnabled) return 'multi_session_disabled'
  if (!settings.headerConfigured) return 'missing_header'
  if (!settings.unreadIndicatorConfigured) return 'missing_unread_indicator'
  return undefined
}
