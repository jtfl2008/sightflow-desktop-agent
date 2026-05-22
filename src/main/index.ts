import { app } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { checkAndRequestPermissions } from './permission'
import { createEngineController } from './engine-runtime'
import { registerMainIpcHandlers } from './ipc'
import { createMainWindow, registerWindowLifecycle } from './main-window'
import {
  SkillEngineController,
  startSkillServer,
  stopSkillServer
} from './skill-server'

const engineController = createEngineController()

const skillEngineController: SkillEngineController = {
  start: () => engineController.start(),
  pause: () => engineController.stop('skill_pause'),
  isRunning: () => engineController.isRunning()
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')
  await checkAndRequestPermissions()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerMainIpcHandlers(engineController)
  startSkillServer(skillEngineController)
  registerWindowLifecycle(createMainWindow)
})

app.on('before-quit', () => {
  stopSkillServer()
})
