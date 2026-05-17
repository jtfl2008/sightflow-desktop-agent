import * as assert from 'node:assert/strict'
import { DesktopDevice, DeviceDeliveryResult } from './device'
import { GenericChannelSession, createInitialGenericChannelState } from './generic-channel-session'
import { RuntimeHost } from './runtime-host'
import { ProviderAdapter, ProviderEvent, ProviderInput } from './session-types'
import { AppType } from './rpa/types'
import { BBox } from './rpa/vision-utils'

class DraftReviewMockDevice implements DesktopDevice {
  sentMessages: string[] = []
  draftMessages: string[] = []
  baselineWrites = 0
  appType: AppType = 'wechat'
  apiKey = ''

  setAppType(appType: AppType): void {
    this.appType = appType
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey
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
    this.baselineWrites += 1
    return true
  }

  async hasChatAreaChanged(): Promise<{ hasDiff: boolean; hasBaseline: boolean }> {
    return { hasDiff: false, hasBaseline: true }
  }

  clearChatBaseline(): void {
    void this.baselineWrites
  }

  async sendMessage(text: string): Promise<void> {
    this.sentMessages.push(text)
  }

  async draftMessage(text: string): Promise<DeviceDeliveryResult> {
    this.draftMessages.push(text)
    return { success: true, mode: 'draft' }
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

class StaticReplyProvider implements ProviderAdapter {
  private readonly reply: string

  constructor(reply: string) {
    this.reply = reply
  }

  async *run(input: ProviderInput): AsyncIterable<ProviderEvent> {
    void input
    yield { type: 'reply_text', content: this.reply }
  }
}

class DeferredReplyProvider implements ProviderAdapter {
  started = false
  release: (() => void) | null = null

  async *run(input: ProviderInput): AsyncIterable<ProviderEvent> {
    void input
    this.started = true
    await new Promise<void>((resolve) => {
      this.release = resolve
    })
    yield { type: 'reply_text', content: 'late reply' }
  }
}

async function createDraftRuntime(provider: ProviderAdapter): Promise<{
  runtime: RuntimeHost<ReturnType<typeof createInitialGenericChannelState>>
  device: DraftReviewMockDevice
  state: ReturnType<typeof createInitialGenericChannelState>
}> {
  const device = new DraftReviewMockDevice()
  const state = createInitialGenericChannelState()
  const runtime = new RuntimeHost({
    appType: 'wechat',
    channel: new GenericChannelSession(device, { replyMode: 'draft_review' }),
    provider,
    initialState: state
  })
  await runtime.startSession()
  return { runtime, device, state }
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function testDraftDoesNotAutoSend(): Promise<void> {
  const { runtime, device, state } = await createDraftRuntime(new StaticReplyProvider('hello'))
  await waitFor(() => state.replyDrafts.length === 1, 'draft creation')

  assert.equal(device.sentMessages.length, 0)
  assert.deepEqual(device.draftMessages, ['hello'])
  assert.equal(state.replyDrafts[0].content, 'hello')
  assert.equal(state.replyDrafts[0].status, 'pending')
  await runtime.stopSession('test_done')
}

async function testApproveSendsDraft(): Promise<void> {
  const { runtime, device, state } = await createDraftRuntime(new StaticReplyProvider('approve me'))
  await waitFor(() => state.replyDrafts.length === 1, 'draft creation')

  runtime.dispatch({ type: 'draft.approve', draftId: state.replyDrafts[0].id })
  await waitFor(() => device.sentMessages.length === 1, 'approved send')

  assert.deepEqual(device.sentMessages, ['approve me'])
  assert.equal(state.replyDrafts[0].status, 'approved')
  await runtime.stopSession('test_done')
}

async function testSkipContinuesWithoutSend(): Promise<void> {
  const { runtime, device, state } = await createDraftRuntime(new StaticReplyProvider('skip me'))
  await waitFor(() => state.replyDrafts.length === 1, 'draft creation')

  runtime.dispatch({ type: 'draft.skip', draftId: state.replyDrafts[0].id })
  await waitFor(() => state.replyDrafts[0].status === 'skipped', 'draft skip')

  assert.equal(device.sentMessages.length, 0)
  assert.equal(device.baselineWrites, 1)
  assert.equal(runtime.isRunning(), true)
  await runtime.stopSession('test_done')
}

async function testTakeoverStopsCurrentSession(): Promise<void> {
  const { runtime, device, state } = await createDraftRuntime(new StaticReplyProvider('take over'))
  await waitFor(() => state.replyDrafts.length === 1, 'draft creation')

  runtime.dispatch({ type: 'draft.takeover', draftId: state.replyDrafts[0].id })
  await waitFor(() => !runtime.isRunning(), 'session takeover stop')

  assert.equal(device.sentMessages.length, 0)
  assert.equal(state.replyDrafts[0].status, 'takeover')
}

async function testStoppedSessionDropsLateProviderReply(): Promise<void> {
  const provider = new DeferredReplyProvider()
  const { runtime, device, state } = await createDraftRuntime(provider)
  await waitFor(() => provider.started, 'provider start')

  await runtime.stopSession('test_stop_before_provider_reply')
  provider.release?.()
  await new Promise((resolve) => setTimeout(resolve, 50))

  assert.equal(runtime.isRunning(), false)
  assert.equal(device.sentMessages.length, 0)
  assert.equal(state.replyDrafts.length, 0)
}

async function main(): Promise<void> {
  await testDraftDoesNotAutoSend()
  await testApproveSendsDraft()
  await testSkipContinuesWithoutSend()
  await testTakeoverStopsCurrentSession()
  await testStoppedSessionDropsLateProviderReply()
  console.log('runtime draft review mock tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
