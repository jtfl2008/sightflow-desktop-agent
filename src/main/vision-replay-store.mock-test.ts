import * as assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { VisionEvalReport, VisionReplaySuiteManifest } from '../core/rpa/vision-eval-types'
import { VisionReplayStore } from './vision-replay-store'

const generatedAt = '2026-05-17T10:00:00.000Z'

function report(overrides: Partial<VisionEvalReport> = {}): VisionEvalReport {
  return {
    schemaVersion: 1,
    generatedAt,
    suiteIds: ['suite-safe'],
    summary: {
      totalSamples: 1,
      totalTasks: 1,
      passedTasks: 1,
      failedTasks: 0,
      passRate: 1,
      privacyViolations: 0
    },
    metrics: {
      bbox: { meanIoU: 1, meanCenterDistancePx: 0 },
      point: { meanDistancePx: 0 },
      unread: { accuracy: 1 },
      diff: { accuracy: 1 },
      boxSelect: { passRate: 1 }
    },
    failures: [],
    ...overrides
  }
}

function manifest(overrides: Partial<VisionReplaySuiteManifest> = {}): VisionReplaySuiteManifest {
  return {
    schemaVersion: 1,
    suiteId: 'suite-safe',
    title: 'Safe suite',
    appType: 'wechat',
    captureStrategy: 'rpa_vlm',
    source: 'synthetic',
    privacy: {
      storesFullScreenshot: false,
      redactionStatus: 'synthetic',
      containsPersonalData: false,
      consentRequired: false,
      retentionDays: 7
    },
    samples: [
      {
        id: 'sample-safe',
        title: 'Alice +8613800138000 /workspace/project/raw.png data:image/png;base64,AAAA',
        appType: 'wechat',
        locale: 'zh-CN',
        platform: 'any',
        scaleFactor: 1,
        windowBounds: { x: 0, y: 0, width: 1000, height: 800 },
        image: {
          path: 'redacted/sample.png',
          sha256: 'a'.repeat(64),
          width: 1000,
          height: 800,
          kind: 'synthetic'
        },
        tasks: [
          {
            type: 'layout_bbox',
            target: 'chatMainArea',
            expectedBbox: [300, 120, 950, 820],
            tolerance: { minIoU: 0.75 },
            mockVlmOutput: '[300,120,950,820]'
          }
        ],
        tags: ['privacy-safe'],
        createdAt: generatedAt
      }
    ],
    ...overrides
  }
}

async function createStore(): Promise<VisionReplayStore> {
  const root = await mkdtemp(path.join(tmpdir(), 'vision-replay-store-'))
  const reportsDir = path.join(root, 'reports/vision-eval')
  const suiteRoot = path.join(root, 'fixtures/vision-replay/suites')
  await mkdir(path.join(suiteRoot, 'suite-safe'), { recursive: true })
  await mkdir(reportsDir, { recursive: true })
  await writeFile(path.join(reportsDir, 'safe.json'), JSON.stringify(report(), null, 2))
  await writeFile(
    path.join(reportsDir, 'blocked.json'),
    JSON.stringify(
      report({
        suiteIds: ['suite-blocked'],
        summary: {
          ...report().summary,
          passedTasks: 0,
          failedTasks: 1,
          passRate: 0,
          privacyViolations: 1
        },
        failures: [
          {
            suiteId: 'suite-blocked',
            sampleId: 'suite',
            taskType: 'privacy',
            category: 'privacy_base64_in_audit',
            message: 'blocked'
          }
        ]
      }),
      null,
      2
    )
  )
  await writeFile(
    path.join(reportsDir, 'hash.json'),
    JSON.stringify(
      report({
        failures: [
          {
            suiteId: 'suite-safe',
            sampleId: 'sample-safe',
            taskType: 'image_hash',
            category: 'sample_hash_mismatch',
            message: 'hash mismatch'
          }
        ]
      }),
      null,
      2
    )
  )
  await writeFile(path.join(reportsDir, 'invalid.json'), '{')
  await writeFile(
    path.join(suiteRoot, 'suite-safe/manifest.json'),
    JSON.stringify(manifest(), null, 2)
  )
  await mkdir(path.join(suiteRoot, 'suite-blocked'), { recursive: true })
  await writeFile(
    path.join(suiteRoot, 'suite-blocked/manifest.json'),
    JSON.stringify(
      manifest({
        suiteId: 'suite-blocked',
        privacy: {
          storesFullScreenshot: true,
          redactionStatus: 'redacted',
          containsPersonalData: true,
          consentRequired: true,
          retentionDays: 31
        }
      }),
      null,
      2
    )
  )
  return new VisionReplayStore({ projectRoot: root, reportsDir, suiteRoots: [suiteRoot] })
}

async function testListReportsNormalizesStatuses(): Promise<void> {
  const store = await createStore()
  const { reports, total } = await store.listReports({ limit: 10 })
  assert.equal(total, 4)
  assert.equal(reports.find((item) => item.reportId === 'safe')?.result, 'passed')
  assert.equal(reports.find((item) => item.reportId === 'blocked')?.privacyGateStatus, 'blocked')
  assert.equal(reports.find((item) => item.reportId === 'hash')?.hashStatus, 'mismatch')
  assert.equal(reports.find((item) => item.reportId === 'invalid')?.schemaStatus, 'invalid')
}

async function testBlockedAndHashReportsReturnPlaceholders(): Promise<void> {
  const store = await createStore()
  const blocked = await store.openReport('blocked')
  assert.equal(blocked.privacyGate.status, 'blocked')
  assert.equal(blocked.selectedSample?.imagePreview.kind, 'placeholder')

  const hash = await store.openReport('hash')
  assert.equal(hash.selectedSample?.imagePreview.kind, 'placeholder')
  assert.deepEqual(hash.exportAvailability, {
    markdown: false,
    json: false,
    blockedReason: 'sample image hash mismatch'
  })
}

async function testRendererDtoDoesNotExposeRawSensitiveData(): Promise<void> {
  const store = await createStore()
  const detail = await store.openReport('safe')
  const payload = JSON.stringify(detail)
  assert.equal(payload.includes('/workspace/project'), false)
  assert.equal(payload.includes('+8613800138000'), false)
  assert.equal(payload.includes('data:image/png'), false)
  assert.equal(payload.includes('redacted/sample.png'), false)
  assert.equal(detail.selectedSample?.imagePreview.kind, 'redacted_image')
}

async function testRunPrivacyGateByReport(): Promise<void> {
  const store = await createStore()
  const gate = await store.runPrivacyGate({ sourceKind: 'report', reportId: 'blocked' })
  assert.equal(gate.status, 'blocked')
  assert.equal(gate.checks.find((check) => check.id === 'retention_days')?.status, 'blocked')
}

async function main(): Promise<void> {
  await testListReportsNormalizesStatuses()
  await testBlockedAndHashReportsReturnPlaceholders()
  await testRendererDtoDoesNotExposeRawSensitiveData()
  await testRunPrivacyGateByReport()
  console.log('vision replay store mock tests passed')
}

void main()
