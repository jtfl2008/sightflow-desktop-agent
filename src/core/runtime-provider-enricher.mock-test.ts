import * as assert from 'node:assert/strict'
import { DesktopDevice, DeviceDeliveryResult } from './device'
import { GenericChannelSession, createInitialGenericChannelState } from './generic-channel-session'
import { RuntimeHost } from './runtime-host'
import { ProviderAdapter, ProviderEvent, ProviderInput } from './session-types'
import { AppType } from './rpa/types'
import { BBox } from './rpa/vision-utils'

class EnricherMockDevice implements DesktopDevice {
  sentMessages: string[] = []
  draftMessages: string[] = []
  baselineWrites = 0

  setAppType(appType: AppType): void { void appType }
  setApiKey(apiKey: string): void { void apiKey }
  async measureLayout(): Promise<{ success: boolean; error?: string }> { return { success: true } }
  async screenshot(): Promise<string> { return 'data:image/png;base64,bW9jaw==' }
  async hasUnreadMessage(): Promise<{ hasUnread: boolean; chatEntranceArea?: { bbox: BBox; coordinates: [number, number] } }> { return { hasUnread: false } }
  async isChatContactUnread(): Promise<{ isUnread: boolean; firstContactCoords?: [number, number] }> { return { isUnread: false } }
  clearUnreadCache(): void { void this.sentMessages }
  async setChatBaseline(): Promise<boolean> { this.baselineWrites += 1; return true }
  async hasChatAreaChanged(): Promise<{ hasDiff: boolean; hasBaseline: boolean }> { return { hasDiff: false, hasBaseline: true } }
  clearChatBaseline(): void { void this.draftMessages }
  async sendMessage(text: string): Promise<void> { this.sentMessages.push(text) }
  async draftMessage(text: string): Promise<DeviceDeliveryResult> { this.draftMessages.push(text); return { success: true, mode: 'draft' } }
  async activeUnreadByClick(coordinates: [number, number]): Promise<void> { void coordinates }
  async clickUnreadContact(coordinates: [number, number]): Promise<void> { void coordinates }
  async clickAt(x: number, y: number): Promise<void> { void x; void y }
}

class CapturingProvider implements ProviderAdapter {
  inputs: ProviderInput[] = []
  async *run(input: ProviderInput): AsyncIterable<ProviderEvent> {
    this.inputs.push(input)
    yield { type: 'reply_text', content: 'ok' }
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timeout')
}

async function testProviderReceivesEnrichedInput(): Promise<void> {
  const device = new EnricherMockDevice()
  const provider = new CapturingProvider()
  const runtime = new RuntimeHost({
    appType: 'wechat',
    channel: new GenericChannelSession(device, {
      providerInputEnricher: (input) => ({
        ...input,
        knowledgeSnippets: [{ id: 'k1', title: 'FAQ', content: '价格说明', sourceType: 'faq' }],
        policyHints: [{ id: 'h1', label: '审核', severity: 'requires_review', reason: '测试', source: 'intent_route' }],
        intent: { primaryIntentId: 'pricing_inquiry', candidates: [], confidence: 0.8, fallbackUsed: false, matchedKnowledgeIds: ['k1'] },
        route: { routeId: 'r1', label: '价格', action: 'run_provider', policyHints: [], auditTags: [] }
      })
    }),
    provider,
    initialState: createInitialGenericChannelState()
  })
  await runtime.startSession()
  await waitFor(() => provider.inputs.length === 1)
  assert.equal(provider.inputs[0].knowledgeSnippets?.[0].id, 'k1')
  assert.equal(provider.inputs[0].intent?.primaryIntentId, 'pricing_inquiry')
  await runtime.stopSession('done')
}

async function testBlockedRouteSkipsProvider(): Promise<void> {
  const provider = new CapturingProvider()
  const runtime = new RuntimeHost({
    appType: 'wechat',
    channel: new GenericChannelSession(new EnricherMockDevice(), {
      providerInputEnricher: (input) => ({
        ...input,
        route: { routeId: 'blocked', label: '阻断', action: 'blocked', policyHints: [], auditTags: [] }
      })
    }),
    provider,
    initialState: createInitialGenericChannelState()
  })
  await runtime.startSession()
  await waitFor(() => !runtime.isRunning() || provider.inputs.length === 0)
  assert.equal(provider.inputs.length, 0)
  await runtime.stopSession('done')
}

async function testRequiresReviewForcesDraft(): Promise<void> {
  const device = new EnricherMockDevice()
  const runtime = new RuntimeHost({
    appType: 'wechat',
    channel: new GenericChannelSession(device, {
      providerInputEnricher: (input) => ({
        ...input,
        route: { routeId: 'review', label: '审核', action: 'run_provider_requires_review', policyHints: [], auditTags: [] }
      })
    }),
    provider: new CapturingProvider(),
    initialState: createInitialGenericChannelState()
  })
  await runtime.startSession()
  await waitFor(() => device.draftMessages.length === 1)
  assert.equal(device.sentMessages.length, 0)
  await runtime.stopSession('done')
}

async function testChannelDraftModeForcesDraft(): Promise<void> {
  const device = new EnricherMockDevice()
  const runtime = new RuntimeHost({
    appType: 'wechat',
    channel: new GenericChannelSession(device, {
      providerInputEnricher: (input) => ({
        ...input,
        draftMode: 'draft_review',
        channelContext: {
          multiSessionEnabled: true,
          headerConfigured: false,
          unreadIndicatorConfigured: true,
          currentContactVerified: false,
          customerMemoryOmittedReason: 'missing_header',
          finalAction: 'draft_review',
          reasons: ['missing_header', 'contact_not_verified']
        }
      })
    }),
    provider: new CapturingProvider(),
    initialState: createInitialGenericChannelState()
  })
  await runtime.startSession()
  await waitFor(() => device.draftMessages.length === 1)
  assert.equal(device.sentMessages.length, 0)
  await runtime.stopSession('done')
}

async function main(): Promise<void> {
  await testProviderReceivesEnrichedInput()
  await testBlockedRouteSkipsProvider()
  await testRequiresReviewForcesDraft()
  await testChannelDraftModeForcesDraft()
  console.log('runtime provider enricher mock tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
