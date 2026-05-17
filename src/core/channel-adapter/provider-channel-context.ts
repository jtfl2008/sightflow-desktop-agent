import type {
  ProviderInputChannelContext,
  ProviderInputChannelFinalAction
} from '../session-types'
import type { AppType, BoxRegions } from '../rpa/types'
import type { ChannelAdapterSettings } from './types'

export interface BuildProviderChannelContextInput {
  appType: AppType
  currentContact?: string
  adapterSettings: ChannelAdapterSettings
  regions: BoxRegions | null
  hashContactKey: (appType: AppType, contactKey: string) => string
}

export function buildProviderChannelContextFromAdapter(
  input: BuildProviderChannelContextInput
): ProviderInputChannelContext {
  const multiSessionEnabled = input.adapterSettings.multiSessionEnabled
  const headerConfigured =
    input.adapterSettings.headerConfigured && Boolean(input.regions?.header)
  const unreadIndicatorConfigured =
    input.adapterSettings.unreadIndicatorConfigured && Boolean(input.regions?.unreadIndicator)
  const hasContactKey = Boolean(input.currentContact?.trim())
  const currentContactVerified = multiSessionEnabled
    ? headerConfigured && hasContactKey
    : hasContactKey
  const contactKeyHash = currentContactVerified
    ? input.hashContactKey(input.appType, input.currentContact || '')
    : undefined
  const reasons: string[] = []
  if (multiSessionEnabled && !headerConfigured) reasons.push('missing_header')
  if (multiSessionEnabled && !currentContactVerified) reasons.push('contact_not_verified')
  if (multiSessionEnabled && !unreadIndicatorConfigured) reasons.push('missing_unread_indicator')

  return {
    multiSessionEnabled,
    headerConfigured,
    unreadIndicatorConfigured,
    currentContactVerified,
    contactKeyHash,
    customerMemoryOmittedReason: resolveChannelMemoryOmittedReason({
      multiSessionEnabled,
      headerConfigured,
      currentContactVerified
    }),
    finalAction: resolveProviderChannelFinalAction({
      multiSessionEnabled,
      safetyMode: input.adapterSettings.safetyMode,
      reasons
    }),
    reasons
  }
}

function resolveProviderChannelFinalAction(input: {
  multiSessionEnabled: boolean
  safetyMode: ChannelAdapterSettings['safetyMode']
  reasons: string[]
}): ProviderInputChannelFinalAction {
  if (!input.multiSessionEnabled) return 'allow_send'
  if (input.safetyMode === 'draft_review_only') return 'draft_review'
  return input.reasons.length ? 'draft_review' : 'allow_send'
}

function resolveChannelMemoryOmittedReason(input: {
  multiSessionEnabled: boolean
  headerConfigured: boolean
  currentContactVerified: boolean
}): ProviderInputChannelContext['customerMemoryOmittedReason'] {
  if (input.multiSessionEnabled && !input.headerConfigured) return 'missing_header'
  if (input.multiSessionEnabled && !input.currentContactVerified) return 'contact_not_verified'
  return undefined
}
