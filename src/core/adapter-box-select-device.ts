import { intToRGBA, Jimp } from 'jimp'
import { BoxSelectDevice } from './box-select-device'
import { DesktopDevice, DeviceDeliveryResult } from './device'
import { DegradedReason } from './channel-adapter/types'
import { AppType, BoxRegions, ScreenRect } from './rpa/types'
import { BBox } from './rpa/vision-utils'
import { captureScreenRegion } from './rpa/screenshot-utils'

export type AdapterBoxSelectAuditCategory = 'layout' | 'message' | 'error'

export interface AdapterBoxSelectAuditEvent {
  category: AdapterBoxSelectAuditCategory
  action: string
  message?: string
  metadata?: Record<string, unknown>
}

export interface AdapterBoxSelectDeviceOptions {
  lowConfidenceThreshold?: number
  minRedPixels?: number
  maxConsecutiveFailures?: number
  now?: () => number
  onAudit?: (event: AdapterBoxSelectAuditEvent) => void
}

interface UnreadCandidate {
  bbox: BBox
  coordinates: [number, number]
  confidence: number
  redPixels: number
  scanRect: ScreenRect
}

const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.002
const DEFAULT_MIN_RED_PIXELS = 8
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3

export class AdapterBoxSelectDevice implements DesktopDevice {
  private readonly baseDevice: BoxSelectDevice
  private readonly lowConfidenceThreshold: number
  private readonly minRedPixels: number
  private readonly maxConsecutiveFailures: number
  private readonly now: () => number
  private readonly onAudit?: (event: AdapterBoxSelectAuditEvent) => void
  private appType: AppType = 'generic'
  private regions: BoxRegions | null
  private pendingCandidate: UnreadCandidate | null = null
  private consecutiveFailures = 0
  private pausedReason: DegradedReason | null = null
  private auditEvents: AdapterBoxSelectAuditEvent[] = []

  constructor(regions: BoxRegions | null = null, options: AdapterBoxSelectDeviceOptions = {}) {
    this.regions = regions
    this.baseDevice = new BoxSelectDevice(regions)
    this.lowConfidenceThreshold =
      options.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD
    this.minRedPixels = options.minRedPixels ?? DEFAULT_MIN_RED_PIXELS
    this.maxConsecutiveFailures =
      options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES
    this.now = options.now ?? (() => Date.now())
    this.onAudit = options.onAudit
  }

  setAppType(appType: AppType): void {
    this.appType = appType
    this.baseDevice.setAppType(appType)
  }

  setApiKey(apiKey: string): void {
    this.baseDevice.setApiKey(apiKey)
  }

  setRegions(regions: BoxRegions | null): void {
    this.regions = regions
    this.pendingCandidate = null
    this.pausedReason = null
    this.baseDevice.setRegions(regions)
  }

  getRegions(): BoxRegions | null {
    return this.regions
  }

  getAuditEvents(): AdapterBoxSelectAuditEvent[] {
    return [...this.auditEvents]
  }

  onSessionStart(): void {
    this.pendingCandidate = null
    this.consecutiveFailures = 0
    this.pausedReason = null
  }

  onSessionStop(): void {
    this.pendingCandidate = null
    this.consecutiveFailures = 0
    this.pausedReason = null
    this.baseDevice.onSessionStop()
  }

  measureLayout(): Promise<{ success: boolean; error?: string }> {
    return this.baseDevice.measureLayout()
  }

  screenshot(): Promise<string> {
    return this.baseDevice.screenshot()
  }

  async hasUnreadMessage(): Promise<{
    hasUnread: boolean
    chatEntranceArea?: { bbox: BBox; coordinates: [number, number] }
  }> {
    this.pendingCandidate = null

    if (!this.isMultiSessionEnabled()) {
      this.audit('layout', 'adapter.unread_scan_skipped', {
        reason: 'multi_session_disabled',
        fallback: 'chatMain_diff_only'
      })
      return { hasUnread: false }
    }

    const scanRect = this.getUnreadScanRect()
    if (!scanRect) {
      this.audit('layout', 'adapter.degraded', {
        reason: 'missing_unread_indicator',
        fallback: 'chatMain_diff_only'
      })
      return { hasUnread: false }
    }

    const capture = await captureScreenRegion(scanRect)
    if (!capture.success || !capture.screenshotBase64) {
      this.recordFailure('click_verify_failed', 'unread_indicator_capture_failed', {
        error: capture.error
      })
      return { hasUnread: false }
    }

    const candidate = await detectUnreadCandidate(capture.screenshotBase64, scanRect)
    if (!candidate || !this.isCandidateConfident(candidate)) {
      this.audit('layout', 'adapter.degraded', {
        reason: 'unread_low_confidence',
        confidence: candidate?.confidence ?? 0,
        redPixels: candidate?.redPixels ?? 0,
        fallback: 'chatMain_diff_only'
      })
      return { hasUnread: false }
    }

    if (!this.isPointAllowed(candidate.coordinates)) {
      this.recordFailure('candidate_out_of_bounds', 'candidate_out_of_bounds', {
        coordinates: candidate.coordinates,
        scanRect: redactRect(scanRect)
      })
      return { hasUnread: false }
    }

    this.pendingCandidate = candidate
    this.audit('layout', 'adapter.unread_candidate_detected', {
      confidence: candidate.confidence,
      redPixels: candidate.redPixels,
      scanRect: redactRect(scanRect)
    })
    return {
      hasUnread: true,
      chatEntranceArea: {
        bbox: candidate.bbox,
        coordinates: candidate.coordinates
      }
    }
  }

  async isChatContactUnread(): Promise<{
    isUnread: boolean
    firstContactCoords?: [number, number]
  }> {
    if (!this.pendingCandidate || this.pausedReason) return { isUnread: false }
    if (!this.isPointAllowed(this.pendingCandidate.coordinates)) {
      this.recordFailure('candidate_out_of_bounds', 'verify_candidate_out_of_bounds', {
        coordinates: this.pendingCandidate.coordinates
      })
      return { isUnread: false }
    }
    return { isUnread: true, firstContactCoords: this.pendingCandidate.coordinates }
  }

  clearUnreadCache(): void {
    this.pendingCandidate = null
    this.pausedReason = null
  }

  setChatBaseline(): Promise<boolean> {
    return this.baseDevice.setChatBaseline()
  }

  hasChatAreaChanged(): Promise<{ hasDiff: boolean; hasBaseline: boolean }> {
    return this.baseDevice.hasChatAreaChanged()
  }

  clearChatBaseline(): void {
    this.baseDevice.clearChatBaseline()
  }

  async sendMessage(text: string): Promise<void> {
    if (this.pausedReason) {
      throw new Error(`多会话点击验证失败，已暂停发送: ${this.pausedReason}`)
    }
    await this.baseDevice.sendMessage(text)
  }

  async draftMessage(text: string): Promise<DeviceDeliveryResult> {
    if (this.pausedReason) {
      const message = `多会话点击验证失败，已暂停草稿填入: ${this.pausedReason}`
      return {
        success: false,
        mode: 'draft',
        error: message,
        audit: {
          category: 'error',
          action: 'adapter_draft_blocked',
          message,
          metadata: {
            appType: this.appType,
            device: 'adapter-box-select',
            degradedReason: this.pausedReason
          }
        }
      }
    }
    return this.baseDevice.draftMessage(text)
  }

  async activeUnreadByClick(coordinates: [number, number]): Promise<void> {
    const candidate = this.pendingCandidate
    if (!candidate || !samePoint(candidate.coordinates, coordinates) || !this.isPointAllowed(coordinates)) {
      this.recordFailure('click_verify_failed', 'active_click_rejected', {
        coordinates,
        hasPendingCandidate: Boolean(candidate)
      })
      return
    }
    await this.baseDevice.activeUnreadByClick(coordinates)
    this.audit('layout', 'adapter.active_unread_clicked', {
      coordinates,
      confidence: candidate.confidence
    })
  }

  async clickUnreadContact(coordinates: [number, number]): Promise<void> {
    const candidate = this.pendingCandidate
    if (!candidate || !samePoint(candidate.coordinates, coordinates) || !this.isPointAllowed(coordinates)) {
      this.recordFailure('click_verify_failed', 'contact_click_rejected', {
        coordinates,
        hasPendingCandidate: Boolean(candidate)
      })
      return
    }
    await this.baseDevice.clickUnreadContact(coordinates)
    this.consecutiveFailures = 0
    this.audit('layout', 'adapter.contact_click_verified', {
      coordinates,
      confidence: candidate.confidence
    })
  }

  async clickAt(x: number, y: number): Promise<void> {
    const coordinates: [number, number] = [x, y]
    if (!this.pendingCandidate || !samePoint(this.pendingCandidate.coordinates, coordinates)) {
      this.recordFailure('click_verify_failed', 'generic_click_rejected', { coordinates })
      return
    }
    await this.clickUnreadContact(coordinates)
  }

  private isMultiSessionEnabled(): boolean {
    return this.regions?.multiSessionEnabled === true
  }

  private getUnreadScanRect(): ScreenRect | null {
    if (!this.regions?.contactList || !this.regions.unreadIndicator) return null
    return intersectRects(this.regions.contactList, this.regions.unreadIndicator)
  }

  private isCandidateConfident(candidate: UnreadCandidate): boolean {
    return candidate.confidence >= this.lowConfidenceThreshold && candidate.redPixels >= this.minRedPixels
  }

  private isPointAllowed(point: [number, number]): boolean {
    if (!this.regions?.contactList) return false
    if (!pointInRect(point, this.regions.contactList)) return false
    return this.regions.unreadIndicator ? pointInRect(point, this.regions.unreadIndicator) : false
  }

  private recordFailure(
    reason: DegradedReason,
    action: string,
    metadata: Record<string, unknown> = {}
  ): void {
    this.consecutiveFailures += 1
    const finalReason =
      this.consecutiveFailures >= this.maxConsecutiveFailures ? 'repeated_failures' : reason
    this.returnToPreviousOrPause(finalReason)
    this.audit('error', action, {
      ...metadata,
      reason: finalReason,
      failureCountForSession: this.consecutiveFailures,
      finalAction: 'return_to_previous_or_pause',
      fallback: 'chatMain_diff_only'
    })
  }

  private returnToPreviousOrPause(reason: DegradedReason): void {
    this.pausedReason = reason
    this.pendingCandidate = null
    this.audit('layout', 'adapter.return_to_previous_or_pause', {
      reason,
      appType: this.appType,
      at: this.now()
    })
  }

  private audit(
    category: AdapterBoxSelectAuditCategory,
    action: string,
    metadata: Record<string, unknown> = {},
    message?: string
  ): void {
    const event: AdapterBoxSelectAuditEvent = { category, action, message, metadata }
    this.auditEvents.push(event)
    this.onAudit?.(event)
  }
}

async function detectUnreadCandidate(
  screenshotBase64: string,
  scanRect: ScreenRect
): Promise<UnreadCandidate | null> {
  const image = await Jimp.read(
    Buffer.from(screenshotBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64')
  )
  const { width, height } = image.bitmap
  if (width <= 0 || height <= 0) return null

  let redPixels = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let sumX = 0
  let sumY = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { r, g, b, a } = intToRGBA(image.getPixelColor(x, y))
      if (a > 128 && r > 150 && r > g * 1.5 && r > b * 1.5) {
        redPixels += 1
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
        sumX += x
        sumY += y
      }
    }
  }

  if (redPixels === 0) return null
  const centerX = scanRect.x + sumX / redPixels
  const centerY = scanRect.y + sumY / redPixels
  return {
    bbox: [
      scanRect.x + minX,
      scanRect.y + minY,
      scanRect.x + maxX + 1,
      scanRect.y + maxY + 1
    ],
    coordinates: [centerX, centerY],
    confidence: redPixels / (width * height),
    redPixels,
    scanRect
  }
}

function intersectRects(a: ScreenRect, b: ScreenRect): ScreenRect | null {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  if (x2 <= x1 || y2 <= y1) return null
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

function pointInRect([x, y]: [number, number], rect: ScreenRect): boolean {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height
}

function samePoint(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5
}

function redactRect(rect: ScreenRect): Record<string, number> {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }
}
