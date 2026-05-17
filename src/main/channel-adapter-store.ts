import { createRequire } from 'node:module'
import { AppType } from '../core/rpa/types'

const nodeRequire = createRequire(__filename)

export interface ChannelAdapterSettings {
  appType: AppType
  manifestId: string
  version: string
  enabled: boolean
  multiSessionEnabled: boolean
  capabilities: string[]
  headerConfigured: boolean
  unreadIndicatorConfigured: boolean
  runtimeMode: 'single_session' | 'multi_session' | 'degraded_single_session'
  safetyMode: 'default_single_session' | 'draft_review_only' | 'auto_switch_allowed'
  updatedAt: string
}

interface ChannelAdapterBackend {
  get(key: 'settings'): Partial<Record<AppType, ChannelAdapterSettings>> | undefined
  set(key: 'settings', value: Partial<Record<AppType, ChannelAdapterSettings>>): void
}

export class ChannelAdapterStore {
  private readonly backend: ChannelAdapterBackend

  constructor(options: { backend?: ChannelAdapterBackend } = {}) {
    this.backend =
      options.backend ?? (createElectronStoreBackend() as unknown as ChannelAdapterBackend)
  }

  get(appType: AppType): ChannelAdapterSettings {
    return this.read()[appType] || defaultChannelAdapterSettings(appType)
  }

  save(input: ChannelAdapterSettings): ChannelAdapterSettings {
    const normalized = normalizeChannelAdapterSettings(input)
    const all = this.read()
    this.backend.set('settings', { ...all, [normalized.appType]: normalized })
    return normalized
  }

  list(): ChannelAdapterSettings[] {
    return Object.values(this.read())
  }

  private read(): Partial<Record<AppType, ChannelAdapterSettings>> {
    const settings = this.backend.get('settings')
    return settings && typeof settings === 'object' ? settings : {}
  }
}

export function defaultChannelAdapterSettings(appType: AppType): ChannelAdapterSettings {
  return {
    appType,
    manifestId: '',
    version: '',
    enabled: false,
    multiSessionEnabled: false,
    capabilities: ['single_session'],
    headerConfigured: false,
    unreadIndicatorConfigured: false,
    runtimeMode: 'single_session',
    safetyMode: 'default_single_session',
    updatedAt: new Date().toISOString()
  }
}

export function normalizeChannelAdapterSettings(
  input: ChannelAdapterSettings
): ChannelAdapterSettings {
  const multiSessionEnabled = input.multiSessionEnabled === true && input.enabled === true
  const headerConfigured = input.headerConfigured === true
  return {
    ...defaultChannelAdapterSettings(input.appType),
    ...input,
    multiSessionEnabled,
    headerConfigured,
    runtimeMode: multiSessionEnabled ? (headerConfigured ? 'multi_session' : 'degraded_single_session') : 'single_session',
    safetyMode: multiSessionEnabled
      ? headerConfigured
        ? 'auto_switch_allowed'
        : 'draft_review_only'
      : 'default_single_session',
    updatedAt: new Date().toISOString()
  }
}

function createElectronStoreBackend(): unknown {
  const storeModule = nodeRequire('electron-store') as {
    default?: new (options: Record<string, unknown>) => unknown
  }
  const StoreClass =
    storeModule.default ??
    (storeModule as unknown as new (options: Record<string, unknown>) => unknown)
  return new StoreClass({
    name: 'channel-adapter-store',
    defaults: { settings: {} }
  })
}
