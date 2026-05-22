import { desktopCapturer, ipcMain } from 'electron'
import {
  createEngineController,
  getCaptureRegions,
  getProviderInstallState,
  openCaptureSetupWizard,
  resetCaptureRegions
} from './engine-runtime'
import { installProviderFromUrl } from './provider-bundle'
import {
  AppSettings,
  mergeSettings,
  normalizeSettings,
  settingsStore,
  withSchemaDefaults
} from './settings'

export function registerMainIpcHandlers(engine = createEngineController()): void {
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('settings:getAll', async () => {
    return normalizeSettings(settingsStore.store)
  })

  ipcMain.handle('settings:get', async (_event, key: string) => {
    const settings = normalizeSettings(settingsStore.store)
    return (settings as Record<string, any>)[key]
  })

  ipcMain.handle('settings:set', async (_event, data: Record<string, any>) => {
    const next = mergeSettings(normalizeSettings(settingsStore.store), data)
    settingsStore.set(next as any)
    return { success: true }
  })

  ipcMain.handle('provider:installFromUrl', async (_event, manifestUrl: string) => {
    try {
      const result = await installProviderFromUrl(manifestUrl)
      const current = normalizeSettings(settingsStore.store)
      const next: AppSettings = {
        ...current,
        chatProvider: {
          ...current.chatProvider,
          manifestUrl,
          installed: result.installed,
          config: withSchemaDefaults(result.manifest.configSchema, current.chatProvider.config)
        }
      }
      settingsStore.set(next as any)
      return {
        success: true,
        installed: result.installed,
        manifest: result.manifest
      }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('provider:getInstalled', async () => {
    return getProviderInstallState()
  })

  ipcMain.handle('engine:start', async (_event, config) => {
    const result = await engine.start(config)
    if (result.ok) return { success: true }
    return { success: false, error: result.message || result.reason }
  })

  ipcMain.handle('engine:stop', async (_event, reason?: string) => {
    const result = await engine.stop(reason || 'ipc_stop')
    if (result.ok) return { success: true }
    return { success: false, error: result.message || result.reason }
  })

  ipcMain.handle('engine:status', async () => {
    return { running: engine.isRunning() }
  })

  ipcMain.handle('engine:updateConfig', async (_event, config) => {
    engine.updateConfig(config)
    return { success: true }
  })

  ipcMain.handle('engine:testConnection', async (_event, config) => {
    return engine.testConnection(config)
  })

  ipcMain.handle('capture:openSetupWizard', async (_event, args) => {
    return openCaptureSetupWizard(args)
  })

  ipcMain.handle('capture:getRegions', async (_event, appType) => {
    return getCaptureRegions(appType)
  })

  ipcMain.handle('capture:resetRegions', async (_event, appType) => {
    resetCaptureRegions(appType)
    return { success: true }
  })

  ipcMain.handle('capture-screen', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      return sources?.[0]?.thumbnail?.toDataURL() || null
    } catch (error) {
      console.error('Screen capture failed:', error)
      return null
    }
  })

  ipcMain.handle('test:vlm-parallel', async () => {
    const apiKey = normalizeSettings(settingsStore.store).vision.apiKey
    if (!apiKey) return { error: '请先在设置中填写视觉接口密钥' }
    const { runVlmParallelTest } = await import('../core/rpa/tests/test-vlm-parallel')
    return runVlmParallelTest(apiKey, 'wechat')
  })

}
