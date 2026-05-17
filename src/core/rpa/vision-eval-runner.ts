import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  ExpectedBoxSelectTask,
  ExpectedLayoutTask,
  ExpectedPointTask,
  VisionEvalFailure,
  VisionEvalReport,
  VisionExpectedTask,
  VisionReplaySample,
  VisionReplaySuiteManifest
} from './vision-eval-types'

export interface VisionEvalOptions {
  suitePath: string
  failUnderPassRate?: number
}

interface TaskResult {
  passed: boolean
  failure?: VisionEvalFailure
  bboxIoU?: number
  centerDistancePx?: number
  pointDistancePx?: number
  unreadCorrect?: boolean
  diffCorrect?: boolean
  boxCorrect?: boolean
}

export async function runVisionEval(options: VisionEvalOptions): Promise<VisionEvalReport> {
  const manifests = await loadSuiteManifests(options.suitePath)
  const failures: VisionEvalFailure[] = []
  const taskResults: TaskResult[] = []
  let privacyViolations = 0

  for (const manifest of manifests) {
    const privacyFailures = validatePrivacy(manifest)
    failures.push(...privacyFailures)
    privacyViolations += privacyFailures.length

    for (const sample of manifest.samples) {
      const hashFailure = await validateSampleImageHash(manifest, sample, options.suitePath)
      if (hashFailure) failures.push(hashFailure)
      for (const task of sample.tasks) {
        const result = evaluateTask(manifest.suiteId, sample, task)
        taskResults.push(result)
        if (result.failure) failures.push(result.failure)
      }
    }
  }

  const totalTasks = taskResults.length
  const failedTasks = taskResults.filter((item) => !item.passed).length
  const passedTasks = totalTasks - failedTasks
  const passRate = totalTasks ? passedTasks / totalTasks : 0
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    suiteIds: manifests.map((manifest) => manifest.suiteId),
    summary: {
      totalSamples: manifests.reduce((count, manifest) => count + manifest.samples.length, 0),
      totalTasks,
      passedTasks,
      failedTasks,
      passRate,
      privacyViolations
    },
    metrics: {
      bbox: {
        meanIoU: mean(taskResults.map((item) => item.bboxIoU)),
        meanCenterDistancePx: mean(taskResults.map((item) => item.centerDistancePx))
      },
      point: { meanDistancePx: mean(taskResults.map((item) => item.pointDistancePx)) },
      unread: { accuracy: accuracy(taskResults.map((item) => item.unreadCorrect)) },
      diff: { accuracy: accuracy(taskResults.map((item) => item.diffCorrect)) },
      boxSelect: { passRate: accuracy(taskResults.map((item) => item.boxCorrect)) }
    },
    failures
  }
}

export async function loadSuiteManifests(suitePath: string): Promise<VisionReplaySuiteManifest[]> {
  const stats = await stat(suitePath)
  if (stats.isFile()) return [parseManifest(await readFile(suitePath, 'utf8'))]
  const directManifest = path.join(suitePath, 'manifest.json')
  try {
    return [parseManifest(await readFile(directManifest, 'utf8'))]
  } catch {
    const entries = await readdir(suitePath, { withFileTypes: true })
    const manifests: VisionReplaySuiteManifest[] = []
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const file = path.join(suitePath, entry.name, 'manifest.json')
      manifests.push(parseManifest(await readFile(file, 'utf8')))
    }
    return manifests
  }
}

export function parseManifest(content: string): VisionReplaySuiteManifest {
  const manifest = JSON.parse(content) as VisionReplaySuiteManifest
  if (manifest.schemaVersion !== 1 || !manifest.suiteId || !Array.isArray(manifest.samples)) {
    throw new Error('schema_invalid')
  }
  return manifest
}

export function renderVisionEvalMarkdown(report: VisionEvalReport): string {
  const lines = [
    '# Vision Eval Report',
    '',
    `Generated at: ${report.generatedAt}`,
    '',
    `Pass rate: ${(report.summary.passRate * 100).toFixed(1)}%`,
    `Privacy violations: ${report.summary.privacyViolations}`,
    '',
    '## Metrics',
    '',
    `- BBox mean IoU: ${report.metrics.bbox.meanIoU.toFixed(3)}`,
    `- Point mean distance px: ${report.metrics.point.meanDistancePx.toFixed(2)}`,
    `- Unread accuracy: ${(report.metrics.unread.accuracy * 100).toFixed(1)}%`,
    `- Diff accuracy: ${(report.metrics.diff.accuracy * 100).toFixed(1)}%`,
    '',
    '## Privacy',
    '',
    report.summary.privacyViolations ? '- Privacy gate: FAILED' : '- Privacy gate: passed',
    '- Raw base64 is not embedded in this report.',
    '',
    '## Failures',
    ''
  ]
  if (!report.failures.length) lines.push('No failures.')
  for (const failure of report.failures) {
    lines.push(`- ${failure.suiteId}/${failure.sampleId} ${failure.category}: ${failure.message}`)
  }
  return `${lines.join('\n')}\n`
}

function evaluateTask(suiteId: string, sample: VisionReplaySample, task: VisionExpectedTask): TaskResult {
  if (task.type === 'layout_bbox') return evaluateLayout(suiteId, sample, task)
  if (task.type === 'point') return evaluatePoint(suiteId, sample, task)
  if (task.type === 'unread_red_dot') {
    const actual = task.mockUnread ?? false
    const passed = actual === task.expectedUnread
    return {
      passed,
      unreadCorrect: passed,
      failure: passed
        ? undefined
        : fail(suiteId, sample.id, task.type, actual ? 'red_dot_false_positive' : 'red_dot_false_negative', 'unread result mismatch', task.target)
    }
  }
  if (task.type === 'chat_main_diff') {
    const actual = task.mockHasDiff ?? false
    const passed = actual === task.expectedHasDiff
    return {
      passed,
      diffCorrect: passed,
      failure: passed
        ? undefined
        : fail(suiteId, sample.id, task.type, actual ? 'diff_false_positive' : 'diff_false_negative', 'diff result mismatch')
    }
  }
  return evaluateBoxSelect(suiteId, sample, task)
}

function evaluateLayout(suiteId: string, sample: VisionReplaySample, task: ExpectedLayoutTask): TaskResult {
  const actual = parseMockArray(task.mockVlmOutput)
  const actualBbox = isBbox(actual) ? actual : null
  const iouValue = actualBbox ? iou(actualBbox, task.expectedBbox) : 0
  const distance = actualBbox ? centerDistance(actualBbox, task.expectedBbox, sample.windowBounds.width, sample.windowBounds.height) : Number.POSITIVE_INFINITY
  const passed = iouValue >= task.tolerance.minIoU && (!task.tolerance.maxCenterDistancePx || distance <= task.tolerance.maxCenterDistancePx)
  return {
    passed,
    bboxIoU: iouValue,
    centerDistancePx: distance,
    failure: passed ? undefined : fail(suiteId, sample.id, task.type, 'bbox_low_iou', `IoU ${iouValue.toFixed(3)}, center ${distance.toFixed(1)}px`, task.target)
  }
}

function evaluatePoint(suiteId: string, sample: VisionReplaySample, task: ExpectedPointTask): TaskResult {
  const actual = parseMockArray(task.mockVlmOutput)
  const actualPoint = isPoint(actual) ? actual : null
  const distance = actualPoint ? pointDistance(actualPoint, task.expectedPoint, sample.windowBounds.width, sample.windowBounds.height) : Number.POSITIVE_INFINITY
  const passed = distance <= task.tolerance.maxDistancePx
  return {
    passed,
    pointDistancePx: distance,
    failure: passed ? undefined : fail(suiteId, sample.id, task.type, 'point_far_from_expected', `distance ${distance.toFixed(1)}px`, task.target)
  }
}

function evaluateBoxSelect(suiteId: string, sample: VisionReplaySample, task: ExpectedBoxSelectTask): TaskResult {
  const valid = Boolean(task.regions.contactList && task.regions.chatMain && task.regions.inputBox)
  const passed = valid === task.expectedValid
  return {
    passed,
    boxCorrect: passed,
    failure: passed ? undefined : fail(suiteId, sample.id, task.type, valid ? 'box_region_invalid' : 'box_region_missing_required', 'box region validity mismatch')
  }
}

function validatePrivacy(manifest: VisionReplaySuiteManifest): VisionEvalFailure[] {
  const failures: VisionEvalFailure[] = []
  const privacy = manifest.privacy
  if (privacy.storesFullScreenshot && (privacy.redactionStatus !== 'raw_opt_in' || !privacy.consentRequired || !privacy.consentId)) {
    failures.push(fail(manifest.suiteId, 'suite', 'privacy', 'privacy_raw_screenshot_without_consent', 'raw screenshot requires explicit consentId'))
  }
  for (const sample of manifest.samples) {
    if (JSON.stringify(sample.auditContext || {}).includes('data:image/')) {
      failures.push(fail(manifest.suiteId, sample.id, 'privacy', 'privacy_base64_in_audit', 'audit context contains base64 image data'))
    }
  }
  return failures
}

async function validateSampleImageHash(
  manifest: VisionReplaySuiteManifest,
  sample: VisionReplaySample,
  suitePath: string
): Promise<VisionEvalFailure | null> {
  if (!sample.image.path) return null
  const baseDir = suitePath.endsWith('manifest.json') ? path.dirname(suitePath) : suitePath
  const content = await readFile(path.resolve(baseDir, sample.image.path))
  const digest = createHash('sha256').update(content).digest('hex')
  return digest === sample.image.sha256
    ? null
    : fail(manifest.suiteId, sample.id, 'image_hash', 'sample_hash_mismatch', 'sample image sha256 mismatch')
}

function parseMockArray(value?: string): [number, number, number, number] | [number, number] | null {
  if (!value) return null
  const parsed = JSON.parse(value)
  return Array.isArray(parsed) ? (parsed as any) : null
}

function isBbox(value: [number, number, number, number] | [number, number] | null): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4
}

function isPoint(value: [number, number, number, number] | [number, number] | null): value is [number, number] {
  return Array.isArray(value) && value.length === 2
}

function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const [ax1, ay1, ax2, ay2] = a
  const [bx1, by1, bx2, by2] = b
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1))
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1))
  const intersection = ix * iy
  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1)
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1)
  return intersection / Math.max(1, areaA + areaB - intersection)
}

function centerDistance(a: number[], b: number[], width: number, height: number): number {
  const ax = ((a[0] + a[2]) / 2 / 1000) * width
  const ay = ((a[1] + a[3]) / 2 / 1000) * height
  const bx = ((b[0] + b[2]) / 2 / 1000) * width
  const by = ((b[1] + b[3]) / 2 / 1000) * height
  return Math.hypot(ax - bx, ay - by)
}

function pointDistance(a: number[], b: number[], width: number, height: number): number {
  return Math.hypot(((a[0] - b[0]) / 1000) * width, ((a[1] - b[1]) / 1000) * height)
}

function mean(values: Array<number | undefined>): number {
  const usable = values.filter((value): value is number => Number.isFinite(value))
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0
}

function accuracy(values: Array<boolean | undefined>): number {
  const usable = values.filter((value): value is boolean => typeof value === 'boolean')
  return usable.length ? usable.filter(Boolean).length / usable.length : 0
}

function fail(
  suiteId: string,
  sampleId: string,
  taskType: string,
  category: VisionEvalFailure['category'],
  message: string,
  target?: string
): VisionEvalFailure {
  return { suiteId, sampleId, taskType, target, category, message }
}
