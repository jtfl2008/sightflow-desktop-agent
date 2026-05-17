import * as assert from 'node:assert/strict'
import { DesktopDevice, DeviceDeliveryResult } from './device'
import { AppType } from './rpa/types'
import { BBox } from './rpa/vision-utils'

class DeliveryMockDevice implements DesktopDevice {
  sentMessages: string[] = []
  draftMessages: string[] = []
  failDraft = false

  setAppType(appType: AppType): void {
    void appType
  }

  setApiKey(apiKey: string): void {
    void apiKey
  }

  async measureLayout(): Promise<{ success: boolean; error?: string }> {
    return { success: true }
  }

  async screenshot(): Promise<string> {
    return 'data:image/png;base64,bW9jaw=='
  }

  async hasUnreadMessage(): Promise<{
    hasUnread: boolean
    chatEntranceArea?: { bbox: BBox; coordinates: [number, number] }
  }> {
    return { hasUnread: false }
  }

  async isChatContactUnread(): Promise<{
    isUnread: boolean
    firstContactCoords?: [number, number]
  }> {
    return { isUnread: false }
  }

  clearUnreadCache(): void {
    void this.sentMessages
  }

  async setChatBaseline(): Promise<boolean> {
    return true
  }

  async hasChatAreaChanged(): Promise<{ hasDiff: boolean; hasBaseline: boolean }> {
    return { hasDiff: false, hasBaseline: true }
  }

  clearChatBaseline(): void {
    void this.draftMessages
  }

  async sendMessage(text: string): Promise<void> {
    this.sentMessages.push(text)
  }

  async draftMessage(text: string): Promise<DeviceDeliveryResult> {
    if (this.failDraft) {
      return {
        success: false,
        mode: 'draft',
        error: 'mock draft failure',
        audit: {
          category: 'error',
          action: 'draft_fill_failed',
          message: 'mock draft failure'
        }
      }
    }
    this.draftMessages.push(text)
    return {
      success: true,
      mode: 'draft',
      audit: { category: 'message', action: 'draft_filled' }
    }
  }

  async activeUnreadByClick(coordinates: [number, number]): Promise<void> {
    void coordinates
  }

  async clickUnreadContact(coordinates: [number, number]): Promise<void> {
    void coordinates
  }

  async clickAt(x: number, y: number): Promise<void> {
    void x
    void y
  }
}

async function testDraftDoesNotSend(): Promise<void> {
  const device = new DeliveryMockDevice()
  const result = await device.draftMessage('draft only')

  assert.equal(result.success, true)
  assert.equal(result.mode, 'draft')
  assert.deepEqual(device.draftMessages, ['draft only'])
  assert.deepEqual(device.sentMessages, [])
}

async function testSendMessageKeepsLegacyBehavior(): Promise<void> {
  const device = new DeliveryMockDevice()
  await device.sendMessage('send now')

  assert.deepEqual(device.sentMessages, ['send now'])
  assert.deepEqual(device.draftMessages, [])
}

async function testDraftFailureIsAuditable(): Promise<void> {
  const device = new DeliveryMockDevice()
  device.failDraft = true

  const result = await device.draftMessage('will fail')

  assert.equal(result.success, false)
  assert.equal(result.audit?.category, 'error')
  assert.equal(result.audit?.action, 'draft_fill_failed')
  assert.equal(result.error, 'mock draft failure')
}

async function main(): Promise<void> {
  await testDraftDoesNotSend()
  await testSendMessageKeepsLegacyBehavior()
  await testDraftFailureIsAuditable()
  console.log('device draft delivery mock tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
