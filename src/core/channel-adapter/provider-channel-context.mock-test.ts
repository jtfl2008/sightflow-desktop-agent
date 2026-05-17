import * as assert from 'node:assert/strict'
import { defaultChannelAdapterSettings } from './settings-normalizer'
import { buildProviderChannelContextFromAdapter } from './provider-channel-context'
import type { BoxRegions } from '../rpa/types'

const completeRegions: BoxRegions = {
  contactList: { x: 0, y: 0, width: 200, height: 400 },
  chatMain: { x: 210, y: 0, width: 500, height: 400 },
  inputBox: { x: 210, y: 410, width: 500, height: 80 },
  header: { x: 210, y: 0, width: 500, height: 50 },
  unreadIndicator: { x: 180, y: 0, width: 20, height: 400 },
  capturedAt: 1
}

function baseMultiSessionSettings(): ReturnType<typeof defaultChannelAdapterSettings> {
  return {
    ...defaultChannelAdapterSettings('slack'),
    enabled: true,
    multiSessionEnabled: true,
    headerConfigured: true,
    unreadIndicatorConfigured: true,
    runtimeMode: 'multi_session',
    safetyMode: 'auto_switch_allowed'
  }
}

function testVerifiedContactAllowsSend(): void {
  const context = buildProviderChannelContextFromAdapter({
    appType: 'slack',
    currentContact: 'contact-a',
    adapterSettings: baseMultiSessionSettings(),
    regions: completeRegions,
    hashContactKey: () => 'hash-a'
  })

  assert.equal(context.finalAction, 'allow_send')
  assert.equal(context.currentContactVerified, true)
  assert.equal(context.contactKeyHash, 'hash-a')
}

function testUnverifiedContactForcesDraftReview(): void {
  const context = buildProviderChannelContextFromAdapter({
    appType: 'slack',
    currentContact: '',
    adapterSettings: baseMultiSessionSettings(),
    regions: completeRegions,
    hashContactKey: () => 'hash-a'
  })

  assert.equal(context.finalAction, 'draft_review')
  assert.equal(context.currentContactVerified, false)
  assert.equal(context.contactKeyHash, undefined)
  assert.deepEqual(context.reasons, ['contact_not_verified'])
}

function testMissingHeaderForcesDraftReview(): void {
  const context = buildProviderChannelContextFromAdapter({
    appType: 'slack',
    currentContact: 'contact-a',
    adapterSettings: baseMultiSessionSettings(),
    regions: { ...completeRegions, header: null },
    hashContactKey: () => 'hash-a'
  })

  assert.equal(context.finalAction, 'draft_review')
  assert.equal(context.customerMemoryOmittedReason, 'missing_header')
  assert.ok(context.reasons.includes('missing_header'))
}

function testMissingUnreadIndicatorForcesDraftReview(): void {
  const context = buildProviderChannelContextFromAdapter({
    appType: 'slack',
    currentContact: 'contact-a',
    adapterSettings: baseMultiSessionSettings(),
    regions: { ...completeRegions, unreadIndicator: null },
    hashContactKey: () => 'hash-a'
  })

  assert.equal(context.finalAction, 'draft_review')
  assert.ok(context.reasons.includes('missing_unread_indicator'))
}

function main(): void {
  testVerifiedContactAllowsSend()
  testUnverifiedContactForcesDraftReview()
  testMissingHeaderForcesDraftReview()
  testMissingUnreadIndicatorForcesDraftReview()
  console.log('provider channel context mock tests passed')
}

main()
