import type { AppType, ScreenRect } from './types'

export interface VisionReplaySuiteManifest {
  schemaVersion: 1
  suiteId: string
  title: string
  appType: AppType
  captureStrategy: 'rpa_vlm' | 'box_select' | 'adapter_multisession'
  source: 'synthetic' | 'manual_redacted' | 'user_opt_in_redacted'
  privacy: VisionSamplePrivacy
  defaults?: VisionEvalDefaults
  samples: VisionReplaySample[]
}

export interface VisionSamplePrivacy {
  storesFullScreenshot: boolean
  redactionStatus: 'synthetic' | 'redacted' | 'hash_only' | 'raw_opt_in'
  containsPersonalData: boolean
  consentRequired: boolean
  consentId?: string
  retentionDays?: number
  notes?: string
}

export interface VisionEvalDefaults {
  bboxMinIoU?: number
  pointMaxDistancePx?: number
}

export interface VisionReplaySample {
  id: string
  title: string
  appType: AppType
  locale: 'zh-CN' | 'ja-JP' | 'en-US' | 'mixed'
  platform: 'darwin' | 'win32' | 'linux' | 'any'
  scaleFactor: number
  windowBounds: ScreenRect
  image: VisionSampleImage
  tasks: VisionExpectedTask[]
  auditContext?: VisionReplayAuditContext
  tags: string[]
  createdAt: string
}

export interface VisionSampleImage {
  path?: string
  sha256: string
  width: number
  height: number
  kind: 'full_window_redacted' | 'crop_chat_main' | 'crop_unread' | 'synthetic'
  redactionMaskPath?: string
}

export type VisionExpectedTask =
  | ExpectedLayoutTask
  | ExpectedPointTask
  | ExpectedUnreadTask
  | ExpectedDiffTask
  | ExpectedBoxSelectTask

export interface ExpectedLayoutTask {
  type: 'layout_bbox'
  target: string
  expectedBbox: [number, number, number, number]
  tolerance: { minIoU: number; maxCenterDistancePx?: number }
  mockVlmOutput?: string
}

export interface ExpectedPointTask {
  type: 'point'
  target: string
  expectedPoint: [number, number]
  coordinateSpace: 'normalized_1000' | 'screen_logical_px'
  tolerance: { maxDistancePx: number }
  mockVlmOutput?: string
}

export interface ExpectedUnreadTask {
  type: 'unread_red_dot'
  target: string
  expectedUnread: boolean
  thresholdPercent: number
  onlyFirstQuadrant: boolean
  mockUnread?: boolean
}

export interface ExpectedDiffTask {
  type: 'chat_main_diff'
  expectedHasDiff: boolean
  threshold: number
  changeThreshold: number
  mockHasDiff?: boolean
}

export interface ExpectedBoxSelectTask {
  type: 'box_select_regions'
  regions: {
    contactList: ScreenRect
    chatMain: ScreenRect
    inputBox: ScreenRect
    unreadIndicator?: ScreenRect | null
    header?: ScreenRect | null
  }
  expectedValid: boolean
  expectedMode: 'single_session' | 'multi_session_opt_in'
}

export interface VisionReplayAuditContext {
  auditRecordIds: string[]
  events: Array<{ category: string; action: string; occurredAt: string; metadata: Record<string, unknown> }>
}

export type VisionFailureCategory =
  | 'schema_invalid'
  | 'sample_file_missing'
  | 'sample_hash_mismatch'
  | 'privacy_raw_screenshot_without_consent'
  | 'privacy_base64_in_audit'
  | 'bbox_low_iou'
  | 'point_far_from_expected'
  | 'red_dot_false_positive'
  | 'red_dot_false_negative'
  | 'diff_false_positive'
  | 'diff_false_negative'
  | 'box_region_invalid'
  | 'box_region_missing_required'
  | 'unknown_error'

export interface VisionEvalFailure {
  suiteId: string
  sampleId: string
  taskType: string
  target?: string
  category: VisionFailureCategory
  message: string
}

export interface VisionEvalReport {
  schemaVersion: 1
  generatedAt: string
  suiteIds: string[]
  summary: {
    totalSamples: number
    totalTasks: number
    passedTasks: number
    failedTasks: number
    passRate: number
    privacyViolations: number
  }
  metrics: {
    bbox: { meanIoU: number; meanCenterDistancePx: number }
    point: { meanDistancePx: number }
    unread: { accuracy: number }
    diff: { accuracy: number }
    boxSelect: { passRate: number }
  }
  failures: VisionEvalFailure[]
}
