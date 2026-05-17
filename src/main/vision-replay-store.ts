import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import * as path from 'node:path'
import type {
  VisionEvalFailure,
  VisionEvalReport,
  VisionFailureCategory,
  VisionReplaySample,
  VisionReplaySuiteManifest
} from '../core/rpa/vision-eval-types'
import type {
  VisionEvalReportDetail,
  VisionEvalReportListItem,
  VisionFailureCategorySummary,
  VisionHashStatus,
  VisionImportPrivacyGateResult,
  VisionOverlayAnnotation,
  VisionReplayListReportsRequest,
  VisionReplaySamplePreview,
  VisionSafeImagePreview,
  VisionSampleMetric,
  VisionSchemaStatus
} from '../core/rpa/vision-replay-ui-types'
import { runVisionReplayPrivacyGate } from './vision-replay-privacy-gate'

export interface VisionReplayStoreOptions {
  projectRoot: string
  reportsDir?: string
  suiteRoots?: string[]
  userDataRoot?: string
}

interface ReportRecord {
  item: VisionEvalReportListItem
  report?: VisionEvalReport
  fileName: string
  schemaStatus: VisionSchemaStatus
  hashStatus: VisionHashStatus
}

const DEFAULT_FAILURE_COUNTS = {} as Record<VisionFailureCategory, number>
const PATH_PATTERN = /(?:[A-Za-z]:\\|\/(?:Users|home|workspace|tmp|var|private)\/)[^\s"']+/g
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g
const SECRET_PATTERN =
  /(sk-[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]+|token[:=][A-Za-z0-9._-]+|secret[:=][A-Za-z0-9._-]+)/gi
const BASE64_PATTERN = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/gi

export class VisionReplayStore {
  private readonly projectRoot: string
  private readonly reportsDir: string
  private readonly suiteRoots: string[]
  private readonly userDataRoot?: string

  constructor(options: VisionReplayStoreOptions) {
    this.projectRoot = path.resolve(options.projectRoot)
    this.reportsDir = path.resolve(
      options.reportsDir ?? path.join(this.projectRoot, 'reports/vision-eval')
    )
    this.suiteRoots = (
      options.suiteRoots ?? [path.join(this.projectRoot, 'fixtures/vision-replay/suites')]
    ).map((root) => path.resolve(root))
    this.userDataRoot = options.userDataRoot ? path.resolve(options.userDataRoot) : undefined
  }

  async listReports(
    query: VisionReplayListReportsRequest = {}
  ): Promise<{ reports: VisionEvalReportListItem[]; total: number }> {
    const reports = (await this.loadReportRecords())
      .map((record) => record.item)
      .filter((item) => filterReport(item, query))
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    const offset = clampInteger(query.offset, 0, reports.length, 0)
    const limit = clampInteger(query.limit, 1, 200, 50)
    return { reports: reports.slice(offset, offset + limit), total: reports.length }
  }

  async openReport(reportId: string, sampleId?: string): Promise<VisionEvalReportDetail> {
    const record = await this.getReportRecord(reportId)
    const gate = await this.runPrivacyGateForRecord(record)
    const failureCategories = summarizeFailureCategories(record.report?.failures ?? [])
    const selectedSample = await this.findSelectedSample(record, sampleId, gate)
    const blockedReason = gate.status === 'blocked' ? firstBlockedReason(gate) : undefined
    return {
      report: record.item,
      privacyGate: gate,
      selectedSample,
      failureCategories,
      exportAvailability: {
        markdown: gate.status !== 'blocked',
        json: gate.status !== 'blocked',
        blockedReason
      }
    }
  }

  async listSamples(
    args: { suiteId?: string; reportId?: string; category?: VisionFailureCategory } = {}
  ): Promise<VisionReplaySamplePreview[]> {
    const suiteIds = args.reportId
      ? (await this.getReportRecord(args.reportId)).item.suiteIds
      : args.suiteId
        ? [args.suiteId]
        : undefined
    const manifests = await this.loadSuiteManifests()
    const filtered = suiteIds
      ? manifests.filter((manifest) => suiteIds.includes(manifest.suiteId))
      : manifests
    const samples: VisionReplaySamplePreview[] = []
    for (const manifest of filtered) {
      const gate = runVisionReplayPrivacyGate({
        sourceKind: 'suite',
        sampleRootKind:
          manifest.source === 'user_opt_in_redacted' ? 'user_data_redacted' : 'repo_fixture',
        repoRoot: this.projectRoot,
        suitePath: this.findSuiteRootForManifest(manifest),
        manifest
      })
      for (const sample of manifest.samples) {
        samples.push(
          this.toSamplePreview(manifest, sample, gate, { schemaStatus: 'ok', hashStatus: 'ok' })
        )
      }
    }
    if (!args.category) return samples
    if (args.category.startsWith('privacy_'))
      return samples.filter((sample) => sample.imagePreview.kind === 'placeholder')
    return samples
  }

  async runPrivacyGate(args: {
    sourceKind: 'report' | 'suite' | 'sample'
    reportId?: string
    suitePathToken?: string
    sampleId?: string
  }): Promise<VisionImportPrivacyGateResult> {
    if (args.sourceKind === 'report' && args.reportId) {
      return this.runPrivacyGateForRecord(await this.getReportRecord(args.reportId))
    }
    const manifests = await this.loadSuiteManifests()
    const manifest = args.suitePathToken
      ? manifests.find(
          (item) =>
            safeToken(item.suiteId) === args.suitePathToken || item.suiteId === args.suitePathToken
        )
      : manifests[0]
    if (!manifest) {
      return runVisionReplayPrivacyGate({ sourceKind: args.sourceKind, schemaStatus: 'invalid' })
    }
    const samples = args.sampleId
      ? manifest.samples.filter((sample) => sample.id === args.sampleId)
      : manifest.samples
    return runVisionReplayPrivacyGate({
      sourceKind: args.sourceKind,
      sampleRootKind:
        manifest.source === 'user_opt_in_redacted' ? 'user_data_redacted' : 'repo_fixture',
      repoRoot: this.projectRoot,
      suitePath: this.findSuiteRootForManifest(manifest),
      manifest: { ...manifest, samples }
    })
  }

  private async loadReportRecords(): Promise<ReportRecord[]> {
    const files = await listFiles(this.reportsDir, (file) => file.endsWith('.json'))
    const records = await Promise.all(files.map((file) => this.readReportRecord(file)))
    return dedupeLatestReports(records)
  }

  private async readReportRecord(file: string): Promise<ReportRecord> {
    const fileName = path.basename(file)
    const reportId = path.basename(file, '.json')
    try {
      const report = JSON.parse(await readFile(file, 'utf8')) as VisionEvalReport
      if (!isValidReport(report)) throw new Error('schema_invalid')
      const item = this.toReportListItem(reportId, report)
      return { item, report, fileName, schemaStatus: 'ok', hashStatus: item.hashStatus }
    } catch {
      const generatedAt =
        reportId === 'latest' ? new Date(0).toISOString() : reportIdToIso(reportId)
      return {
        item: {
          reportId,
          suiteIds: [],
          scenario: 'schema invalid',
          result: 'blocked',
          generatedAt,
          passRate: 0,
          totalSamples: 0,
          totalTasks: 0,
          failedTasks: 0,
          privacyGateStatus: 'blocked',
          schemaStatus: 'invalid',
          hashStatus: 'unknown',
          failureCategoryCounts: DEFAULT_FAILURE_COUNTS
        },
        fileName,
        schemaStatus: 'invalid',
        hashStatus: 'unknown'
      }
    }
  }

  private toReportListItem(reportId: string, report: VisionEvalReport): VisionEvalReportListItem {
    const failureCategoryCounts = countFailures(report.failures)
    const hashStatus = report.failures.some(
      (failure) => failure.category === 'sample_hash_mismatch'
    )
      ? 'mismatch'
      : 'ok'
    const privacyGateStatus = report.summary.privacyViolations > 0 ? 'blocked' : 'passed'
    const result =
      privacyGateStatus === 'blocked' || hashStatus === 'mismatch'
        ? 'blocked'
        : report.summary.passRate >= 0.95
          ? 'passed'
          : report.summary.failedTasks > 0
            ? 'failed'
            : 'warning'
    return {
      reportId,
      suiteIds: [...report.suiteIds],
      scenario: sanitizeText(report.suiteIds.join(', ') || 'vision replay'),
      result,
      generatedAt: report.generatedAt,
      passRate: report.summary.passRate,
      totalSamples: report.summary.totalSamples,
      totalTasks: report.summary.totalTasks,
      failedTasks: report.summary.failedTasks,
      privacyGateStatus,
      schemaStatus: 'ok',
      hashStatus,
      failureCategoryCounts
    }
  }

  private async getReportRecord(reportId: string): Promise<ReportRecord> {
    const record = (await this.loadReportRecords()).find((item) => item.item.reportId === reportId)
    if (!record) throw new Error(`vision replay report not found: ${reportId}`)
    return record
  }

  private async runPrivacyGateForRecord(
    record: ReportRecord
  ): Promise<VisionImportPrivacyGateResult> {
    const manifests = await this.loadSuiteManifests()
    const matching = manifests.filter((manifest) => record.item.suiteIds.includes(manifest.suiteId))
    const privacy = matching[0]?.privacy
    const samples = matching.flatMap((manifest) => manifest.samples)
    return runVisionReplayPrivacyGate({
      sourceKind: 'report',
      sampleRootKind:
        matching[0]?.source === 'user_opt_in_redacted' ? 'user_data_redacted' : 'repo_fixture',
      repoRoot: this.projectRoot,
      suitePath: matching[0] ? this.findSuiteRootForManifest(matching[0]) : undefined,
      privacy,
      samples,
      schemaStatus: record.schemaStatus,
      hashStatus: record.hashStatus
    })
  }

  private async findSelectedSample(
    record: ReportRecord,
    sampleId: string | undefined,
    gate: VisionImportPrivacyGateResult
  ): Promise<VisionReplaySamplePreview | undefined> {
    const manifests = (await this.loadSuiteManifests()).filter((manifest) =>
      record.item.suiteIds.includes(manifest.suiteId)
    )
    for (const manifest of manifests) {
      const sample = sampleId
        ? manifest.samples.find((item) => item.id === sampleId)
        : manifest.samples[0]
      if (sample) {
        return this.toSamplePreview(manifest, sample, gate, {
          schemaStatus: record.schemaStatus,
          hashStatus: record.hashStatus
        })
      }
    }
    return undefined
  }

  private async loadSuiteManifests(): Promise<VisionReplaySuiteManifest[]> {
    const roots = [...this.suiteRoots]
    if (this.userDataRoot)
      roots.push(path.join(this.userDataRoot, 'vision-replay/redacted-samples'))
    const files = (
      await Promise.all(
        roots.map((root) => listFiles(root, (file) => path.basename(file) === 'manifest.json'))
      )
    ).flat()
    const manifests: VisionReplaySuiteManifest[] = []
    for (const file of files) {
      try {
        const manifest = JSON.parse(await readFile(file, 'utf8')) as VisionReplaySuiteManifest
        if (manifest.schemaVersion === 1 && manifest.suiteId && Array.isArray(manifest.samples)) {
          manifests.push(manifest)
        }
      } catch {
        // Invalid fixture manifests are surfaced by fixture tasks, not by renderer DTOs.
      }
    }
    return manifests
  }

  private findSuiteRootForManifest(manifest: VisionReplaySuiteManifest): string | undefined {
    return this.suiteRoots.find((root) => this.isRepoSuite(manifest, root))
  }

  private isRepoSuite(manifest: VisionReplaySuiteManifest, root: string): boolean {
    return (
      manifest.source !== 'user_opt_in_redacted' && path.resolve(root).startsWith(this.projectRoot)
    )
  }

  private toSamplePreview(
    manifest: VisionReplaySuiteManifest,
    sample: VisionReplaySample,
    gate: VisionImportPrivacyGateResult,
    statuses: { schemaStatus: VisionSchemaStatus; hashStatus: VisionHashStatus }
  ): VisionReplaySamplePreview {
    return {
      sampleId: safeToken(sample.id),
      suiteId: safeToken(manifest.suiteId),
      title: sanitizeText(sample.title || sample.id),
      appType: sample.appType,
      locale: sample.locale,
      platform: sample.platform,
      imagePreview: safeImagePreview(manifest, sample, gate, statuses),
      overlays: buildOverlays(sample),
      metrics: buildMetrics(sample),
      metadata: {
        tags: sample.tags.map(sanitizeText),
        createdAt: sample.createdAt,
        source: manifest.source ?? 'unknown',
        redactionStatus:
          manifest.privacy.redactionStatus === 'raw_opt_in'
            ? 'hash_only'
            : manifest.privacy.redactionStatus,
        sha256Short: shortHash(sample.image.sha256)
      }
    }
  }
}

function safeImagePreview(
  manifest: VisionReplaySuiteManifest,
  sample: VisionReplaySample,
  gate: VisionImportPrivacyGateResult,
  statuses: { schemaStatus: VisionSchemaStatus; hashStatus: VisionHashStatus }
): VisionSafeImagePreview {
  if (statuses.schemaStatus === 'invalid') return { kind: 'placeholder', reason: 'schema_invalid' }
  if (statuses.hashStatus === 'mismatch')
    return { kind: 'placeholder', reason: 'sample_hash_mismatch' }
  if (gate.status === 'blocked') return { kind: 'placeholder', reason: 'privacy_blocked' }
  if (!sample.image.path || manifest.privacy.redactionStatus === 'hash_only') {
    return { kind: 'placeholder', reason: 'hash_only' }
  }
  return {
    kind: 'redacted_image',
    objectUrlToken: createObjectToken(manifest.suiteId, sample.id, sample.image.sha256),
    width: sample.image.width,
    height: sample.image.height,
    sha256Short: shortHash(sample.image.sha256) ?? 'unknown',
    redactionStatus:
      manifest.privacy.redactionStatus === 'raw_opt_in'
        ? 'hash_only'
        : manifest.privacy.redactionStatus
  }
}

function buildOverlays(sample: VisionReplaySample): VisionOverlayAnnotation[] {
  return sample.tasks.flatMap((task): VisionOverlayAnnotation[] => {
    if (task.type === 'layout_bbox') {
      return [
        {
          type: 'bbox',
          target: sanitizeText(task.target),
          expected: task.expectedBbox,
          actual: parseNumberTuple(task.mockVlmOutput, 4),
          status: task.mockVlmOutput ? 'passed' : 'missing'
        }
      ]
    }
    if (task.type === 'point') {
      const point = parseNumberTuple(task.mockVlmOutput, 2)
      return [
        {
          type: 'point',
          target: sanitizeText(task.target),
          expected: { x: task.expectedPoint[0], y: task.expectedPoint[1] },
          actual: point ? { x: point[0], y: point[1] } : undefined,
          status: point ? 'passed' : 'missing'
        }
      ]
    }
    return []
  })
}

function buildMetrics(sample: VisionReplaySample): VisionSampleMetric[] {
  return sample.tasks.flatMap((task): VisionSampleMetric[] => {
    if (task.type === 'layout_bbox')
      return [
        {
          id: `${task.target}-iou`,
          label: 'IoU threshold',
          value: task.tolerance.minIoU,
          threshold: task.tolerance.minIoU,
          status: 'passed'
        }
      ]
    if (task.type === 'point')
      return [
        {
          id: `${task.target}-distance`,
          label: 'Point distance threshold',
          value: task.tolerance.maxDistancePx,
          unit: 'px',
          threshold: task.tolerance.maxDistancePx,
          status: 'passed'
        }
      ]
    return []
  })
}

function filterReport(
  item: VisionEvalReportListItem,
  query: VisionReplayListReportsRequest
): boolean {
  if (query.result && item.result !== query.result) return false
  if (query.category && !item.failureCategoryCounts[query.category]) return false
  if (!query.query) return true
  const needle = query.query.toLocaleLowerCase()
  return [item.reportId, item.scenario, ...item.suiteIds].some((value) =>
    value.toLocaleLowerCase().includes(needle)
  )
}

function countFailures(failures: VisionEvalFailure[]): Record<VisionFailureCategory, number> {
  const counts: Record<string, number> = {}
  for (const failure of failures) counts[failure.category] = (counts[failure.category] ?? 0) + 1
  return counts as Record<VisionFailureCategory, number>
}

function summarizeFailureCategories(failures: VisionEvalFailure[]): VisionFailureCategorySummary[] {
  return Object.entries(countFailures(failures)).map(([category, count]) => ({
    category: category as VisionFailureCategory,
    count,
    ownerHint: ownerHint(category as VisionFailureCategory)
  }))
}

function ownerHint(category: VisionFailureCategory): VisionFailureCategorySummary['ownerHint'] {
  if (
    category.startsWith('privacy_') ||
    category === 'schema_invalid' ||
    category === 'sample_hash_mismatch'
  )
    return '@dev'
  if (category.startsWith('box_')) return '@ui'
  return '@cv'
}

async function listFiles(root: string, predicate: (file: string) => boolean): Promise<string[]> {
  try {
    const rootStat = await stat(root)
    if (rootStat.isFile()) return predicate(root) ? [root] : []
    const entries = await readdir(root, { withFileTypes: true })
    const nested = await Promise.all(
      entries.map((entry) => {
        const file = path.join(root, entry.name)
        return entry.isDirectory()
          ? listFiles(file, predicate)
          : Promise.resolve(predicate(file) ? [file] : [])
      })
    )
    return nested.flat()
  } catch {
    return []
  }
}

function isValidReport(report: VisionEvalReport): boolean {
  return (
    report?.schemaVersion === 1 &&
    Array.isArray(report.suiteIds) &&
    typeof report.summary?.passRate === 'number'
  )
}

function dedupeLatestReports(records: ReportRecord[]): ReportRecord[] {
  const byId = new Map<string, ReportRecord>()
  for (const record of records) {
    if (record.item.reportId === 'latest') continue
    byId.set(record.item.reportId, record)
  }
  return Array.from(byId.values())
}

function sanitizeText(value: string): string {
  return value
    .replace(BASE64_PATTERN, '[REDACTED_BASE64]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
    .replace(SECRET_PATTERN, '[REDACTED_SECRET]')
    .replace(PATH_PATTERN, '[REDACTED_PATH]')
}

function shortHash(value?: string): string | undefined {
  if (!value) return undefined
  return value.length <= 12 ? value : value.slice(0, 12)
}

function createObjectToken(suiteId: string, sampleId: string, hash: string): string {
  return createHash('sha256').update(`${suiteId}:${sampleId}:${hash}`).digest('hex').slice(0, 24)
}

function safeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 128)
}

function parseNumberTuple(value: string | undefined, length: 2): [number, number] | undefined
function parseNumberTuple(
  value: string | undefined,
  length: 4
): [number, number, number, number] | undefined
function parseNumberTuple(
  value: string | undefined,
  length: 2 | 4
): [number, number] | [number, number, number, number] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (
      Array.isArray(parsed) &&
      parsed.length === length &&
      parsed.every((item) => typeof item === 'number')
    ) {
      return parsed as [number, number] | [number, number, number, number]
    }
  } catch {
    return undefined
  }
  return undefined
}

function firstBlockedReason(gate: VisionImportPrivacyGateResult): string | undefined {
  return gate.checks.find((check) => check.status === 'blocked')?.reason
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function reportIdToIso(reportId: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})$/.exec(reportId)
  if (!match) return new Date(0).toISOString()
  const [, year, month, day, hour, minute, second, ms] = match
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`).toISOString()
}
