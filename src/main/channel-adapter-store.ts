import { createRequire } from 'node:module'
import { AppType } from '../core/rpa/types'
import {
  defaultChannelAdapterSettings,
  normalizeChannelAdapterSettings
} from '../core/channel-adapter/settings-normalizer'
import { listChannelAdapterPresets } from '../core/channel-adapter/presets'
import type {
  ChannelAdapterPreset,
  ChannelAdapterSettings,
  ChannelAdapterSettingsInput
} from '../core/channel-adapter/types'

const nodeRequire = createRequire(__filename)

export type { ChannelAdapterPreset, ChannelAdapterSettings }
export { defaultChannelAdapterSettings, normalizeChannelAdapterSettings }

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
    return normalizeChannelAdapterSettings({
      ...defaultChannelAdapterSettings(appType),
      ...(this.read()[appType] || {}),
      appType
    })
  }

  save(input: ChannelAdapterSettingsInput): ChannelAdapterSettings {
    const normalized = normalizeChannelAdapterSettings(input)
    const all = this.read()
    this.backend.set('settings', { ...all, [normalized.appType]: normalized })
    return normalized
  }

  list(): ChannelAdapterSettings[] {
    return Object.entries(this.read()).map(([appType, settings]) =>
      normalizeChannelAdapterSettings({
        ...defaultChannelAdapterSettings(appType as AppType),
        ...settings,
        appType: appType as AppType
      })
    )
  }

  listPresets(): ChannelAdapterPreset[] {
    return listChannelAdapterPresets()
  }

  private read(): Partial<Record<AppType, ChannelAdapterSettings>> {
    const settings = this.backend.get('settings')
    return settings && typeof settings === 'object' ? settings : {}
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
