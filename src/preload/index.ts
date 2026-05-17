import { contextBridge, ipcRenderer } from 'electron'

const electronHandler = {
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  providerLifecycle: (request: ProviderLifecycleRequest) =>
    ipcRenderer.invoke('provider:lifecycle', request),
  on: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (_: any, ...args: any[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
  send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronHandler)
    contextBridge.exposeInMainWorld('osInfo', { platform: process.platform })
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronHandler
  // @ts-ignore
  window.osInfo = { platform: process.platform }
}

export type ProviderLifecycleRequest =
  | { operation: 'install' | 'update'; manifestUrl: string }
  | { operation: 'rollback' }

export type ElectronHandler = typeof electronHandler
