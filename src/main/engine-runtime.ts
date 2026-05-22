import { BrowserWindow } from 'electron'
import { AIClient } from '../core/ai-client'
import { DesktopDevice } from '../core/device'
import {
  createInitialGenericChannelState,
  GenericChannelSession
} from '../core/generic-channel-session'
import { RuntimeHost } from '../core/runtime-host'
import { BoxSelectDevice } from '../core/box-select-device'
import { RPADevice } from '../core/rpa-device'
import { AppType, BoxRegions, CaptureStrategy, isWechatLike } from '../core/rpa/types'
import {
  getBuiltinDoubaoInstalledInfo,
  getBuiltinDoubaoManifestForUi,
  getInstalledProviderManifest,
  loadBuiltinDoubaoProvider,
  loadInstalledProvider
} from './provider-bundle'
import { runBoxSelectWizard, type WizardStepKey } from './overlay-window'
import { AppSettings, coerceAppType, normalizeSettings, settingsStore } from './settings'
import { SkillPauseResult, SkillStartResult } from './skill-server'

type LogType = 'thinking' | 'reply' | 'skip' | 'error'

export interface EngineController {
  start: (rawConfig?: any) => Promise<SkillStartResult>
  stop: (stopReason: string) => Promise<SkillPauseResult>
  isRunning: () => boolean
  updateConfig: (config?: any) => void
  testConnection: (config?: {
    apiKey?: string
    model?: string
    baseURL?: string
  }) => Promise<any>
}

function notifyRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

export function notifyEngineStateChanged(status: 'running' | 'idle'): void {
  notifyRenderer('engine:state', { status })
}

export function notifyCaptureRegionsUpdated(appType: AppType, regions: BoxRegions | null): void {
  notifyRenderer('capture:regions-updated', { appType, regions })
}

function resolveEffectiveStrategy(
  appType: AppType,
  requested: CaptureStrategy,
  hasRegions: boolean
): CaptureStrategy {
  if (requested === 'vlm') return isWechatLike(appType) ? 'vlm' : hasRegions ? 'box-select' : 'auto'
  if (requested === 'box-select') return hasRegions ? 'box-select' : 'auto'
  return 'auto'
}

function resolveSettingsStrategy(appType: AppType, settings: AppSettings): CaptureStrategy {
  const perApp = settings.capture[appType]
  const requested = perApp?.strategy ?? settings.defaultCaptureStrategy ?? 'auto'
  const hasRegions = Boolean(perApp?.regions)
  return resolveEffectiveStrategy(appType, requested, hasRegions)
}

function persistRegionsAndStickyStrategy(
  appType: AppType,
  regions: BoxRegions,
  strategy: CaptureStrategy
): void {
  const current = normalizeSettings(settingsStore.store)
  const next: AppSettings = {
    ...current,
    capture: {
      ...current.capture,
      [appType]: { strategy, regions }
    }
  }
  settingsStore.set(next as any)
  notifyCaptureRegionsUpdated(appType, regions)
}

async function buildDevice(
  appType: AppType,
  settings: AppSettings,
  apiKey: string,
  log: (type: LogType, content: string) => void
): Promise<{ device: DesktopDevice; strategy: CaptureStrategy }> {
  const perApp = settings.capture[appType] ?? { strategy: 'auto' as CaptureStrategy, regions: null }
  const effective = resolveSettingsStrategy(appType, settings)

  if (effective === 'vlm') {
    const rpa = new RPADevice()
    rpa.setAppType(appType)
    rpa.setApiKey(apiKey, settings.vision.model, settings.vision.baseURL)
    return { device: rpa, strategy: 'vlm' }
  }

  let regions = perApp.regions
  if (!regions) {
    log('thinking', `首次配置 ${appType}：请框选 3 个关键区域`)
    const wizardResult = await runBoxSelectWizard({ appType, prefill: null })
    if (!wizardResult.ok || !wizardResult.regions) {
      throw new Error('user_cancelled_box_select_wizard')
    }
    regions = wizardResult.regions
    persistRegionsAndStickyStrategy(appType, regions, perApp.strategy)
  }

  return { device: new BoxSelectDevice(regions), strategy: 'box-select' }
}

export function createEngineController(): EngineController {
  let runtime: RuntimeHost<ReturnType<typeof createInitialGenericChannelState>> | null = null
  let runtimeDevice: DesktopDevice | null = null

  return {
    start: async (rawConfig?: any) => {
      if (runtime?.isRunning()) {
        return { ok: false, reason: 'already_running', message: '引擎已在运行中' }
      }

      try {
        const settings = normalizeSettings(rawConfig || settingsStore.store)
        const appType: AppType = settings.appType || 'wechat'
        const startupStrategy = resolveSettingsStrategy(appType, settings)
        const needsVisionKey = startupStrategy === 'vlm'

        if (needsVisionKey && !settings.vision.apiKey) {
          return { ok: false, reason: 'no_vision_key', message: '请先填写视觉接口密钥' }
        }

        let provider
        if (!settings.chatProvider.installed) {
          const loaded = await loadBuiltinDoubaoProvider(settings.chatProvider.config)
          provider = loaded.provider
        } else {
          const installedManifest = await getInstalledProviderManifest(settings.chatProvider.installed)
          const required = installedManifest?.configSchema?.required || []
          const missing = required.find((key) => {
            const value = settings.chatProvider.config?.[key]
            return value === undefined || value === null || value === ''
          })
          if (missing) {
            return {
              ok: false,
              reason: 'missing_required_field',
              message: `缺少必填配置: ${missing}`
            }
          }

          const loaded = await loadInstalledProvider(
            settings.chatProvider.installed,
            settings.chatProvider.config
          )
          provider = loaded.provider
        }

        const mainWindow = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null
        const log = (type: LogType, content: string): void => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('engine:log', { type, content })
          }
        }

        let device: DesktopDevice
        let strategy: CaptureStrategy
        try {
          const built = await buildDevice(appType, settings, settings.vision.apiKey, log)
          device = built.device
          strategy = built.strategy
        } catch (error: any) {
          const message = error?.message || String(error)
          if (message === 'user_cancelled_box_select_wizard') {
            return { ok: false, reason: 'wizard_cancelled', message: '已取消框选，引擎未启动' }
          }
          throw error
        }

        log('thinking', `已选用抓取策略：${strategy}`)
        runtimeDevice = device

        const channel = new GenericChannelSession(device)
        runtime = new RuntimeHost({
          appType,
          channel,
          provider,
          initialState: createInitialGenericChannelState(),
          onLog: log
        })

        runtime.startSession().catch((error: any) => {
          console.error('[Main] Runtime session error:', error)
        })

        notifyEngineStateChanged('running')
        return { ok: true }
      } catch (error: any) {
        return {
          ok: false,
          reason: 'engine_failed',
          message: error?.message || String(error)
        }
      }
    },
    stop: async (stopReason: string) => {
      if (!runtime?.isRunning()) {
        return { ok: false, reason: 'not_running', message: '引擎未运行' }
      }
      try {
        await runtime.stopSession(stopReason)
        notifyEngineStateChanged('idle')
        return { ok: true }
      } catch (error: any) {
        return {
          ok: false,
          reason: 'pause_failed',
          message: error?.message || String(error)
        }
      }
    },
    isRunning: () => runtime?.isRunning() ?? false,
    updateConfig: (config?: any) => {
      const settings = normalizeSettings(config || settingsStore.store)
      if (runtimeDevice) {
        runtimeDevice.setApiKey(
          settings.vision.apiKey,
          settings.vision.model,
          settings.vision.baseURL
        )
        runtimeDevice.setAppType(settings.appType)
      }
      if (runtime) {
        runtime.updateAppType(settings.appType)
      }
    },
    testConnection: async (config) => {
      const settings = normalizeSettings(settingsStore.store)
      const client = new AIClient({
        apiKey: config?.apiKey || settings.vision.apiKey,
        model: config?.model || settings.vision.model,
        baseURL: config?.baseURL || settings.vision.baseURL
      })
      return client.testConnection()
    }
  }
}

export async function getProviderInstallState() {
  const settings = normalizeSettings(settingsStore.store)
  if (settings.chatProvider.installed) {
    const manifest = await getInstalledProviderManifest(settings.chatProvider.installed)
    return {
      installed: settings.chatProvider.installed,
      manifest,
      isBuiltinDefault: false
    }
  }

  const installed = await getBuiltinDoubaoInstalledInfo()
  const manifest = await getBuiltinDoubaoManifestForUi()
  return {
    installed,
    manifest,
    isBuiltinDefault: true
  }
}

export async function openCaptureSetupWizard(args: {
  appType: AppType
  steps?: WizardStepKey[]
}): Promise<{ success: boolean; reason?: string; regions?: BoxRegions }> {
  const settings = normalizeSettings(settingsStore.store)
  const appType = coerceAppType(args?.appType)
  const prefill = settings.capture[appType]?.regions ?? null
  const result = await runBoxSelectWizard({
    appType,
    steps: args?.steps,
    prefill
  })

  if (!result.ok || !result.regions) {
    return { success: false, reason: result.reason || 'cancelled' }
  }

  const current = normalizeSettings(settingsStore.store)
  const next: AppSettings = {
    ...current,
    capture: {
      ...current.capture,
      [appType]: {
        strategy: current.capture[appType]?.strategy ?? 'auto',
        regions: result.regions
      }
    }
  }
  settingsStore.set(next as any)
  notifyCaptureRegionsUpdated(appType, result.regions)
  return { success: true, regions: result.regions }
}

export function getCaptureRegions(appType: AppType): BoxRegions | null {
  const settings = normalizeSettings(settingsStore.store)
  return settings.capture[coerceAppType(appType)]?.regions ?? null
}

export function resetCaptureRegions(appType: AppType): void {
  const current = normalizeSettings(settingsStore.store)
  const key = coerceAppType(appType)
  const next: AppSettings = {
    ...current,
    capture: {
      ...current.capture,
      [key]: { strategy: current.capture[key]?.strategy ?? 'auto', regions: null }
    }
  }
  settingsStore.set(next as any)
  notifyCaptureRegionsUpdated(key, null)
}
