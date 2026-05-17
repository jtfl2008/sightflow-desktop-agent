import * as assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { VisionEvalReport, VisionReplaySuiteManifest } from '../core/rpa/vision-eval-types'
import {
  exportRedactedVisionReplayReport,
  sanitizeForExport
} from './vision-replay-export'
import { VisionReplayStore } from './vision-replay-store'

const generatedAt = '2026-05-17T10:00:00.000Z'
const fixedNow = (): Date => new Date('2026-05-17T11:00:00.000Z')

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
        title:
          'Alice +8613800138000 alice@example.com /workspace/project/raw.png token:secret-token data:image/png;base64,AAAA',
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
        auditContext: {
          auditRecordIds: ['audit-safe'],
          events: [
            {
              category: 'layout',
              action: 'sample',
              occurredAt: generatedAt,
              metadata: { safe: true }
            }
          ]
        },
        tags: ['privacy-safe'],
        createdAt: generatedAt
      }
    ],
    ...overrides
  }
}

async function createStore(): Promise<VisionReplayStore> {
  const root = await mkdtemp(path.join(tmpdir(), 'vision-replay-export-'))
  const reportsDir = path.join(root, 'reports/vision-eval')
  const suiteRoot = path.join(root, 'fixtures/vision-replay/suites')
  await mkdir(path.join(suiteRoot, 'suite-safe'), { recursive: true })
  await mkdir(path.join(suiteRoot, 'suite-blocked'), { recursive: true })
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
    path.join(suiteRoot, 'suite-safe/manifest.json'),
    JSON.stringify(manifest(), null, 2)
  )
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

async function testJsonAndMarkdownExportAreRedacted(): Promise<void> {
  const store = await createStore()
  const json = await exportRedactedVisionReplayReport(
    store,
    { reportId: 'safe', format: 'json', includeFailureDetails: true },
    fixedNow
  )
  const markdown = await exportRedactedVisionReplayReport(
    store,
    { reportId: 'safe', format: 'markdown', includeFailureDetails: true },
    fixedNow
  )

  for (const content of [json.content, markdown.content]) {
    assert.equal(content.includes('/workspace/project'), false)
    assert.equal(content.includes('+8613800138000'), false)
    assert.equal(content.includes('alice@example.com'), false)
    assert.equal(content.includes('token:secret-token'), false)
    assert.equal(content.includes('data:image/png'), false)
    assert.equal(content.includes('redacted/sample.png'), false)
    assert.equal(content.includes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), false)
    assert.equal(content.includes('sha256Short'), true)
    assert.equal(content.includes('Vision Replay Redacted Export') || content.includes('reportId'), true)
  }
  assert.equal(json.fileName, 'vision-replay-safe.json')
  assert.equal(markdown.fileName, 'vision-replay-safe.md')
  assert.equal(json.redactionExportSummary.status, 'blocked')
  assert.ok(json.redactionExportSummary.blockedTypes.includes('plaintext_contact'))
  assert.equal(json.redactionExportSummary.unknownFieldCount, 0)
  assert.ok(json.content.includes('redactionExportSummary'))
}

async function testBlockedPrivacyGateCannotExport(): Promise<void> {
  const store = await createStore()
  await assert.rejects(
    () =>
      exportRedactedVisionReplayReport(
        store,
        { reportId: 'blocked', format: 'json', includeFailureDetails: true },
        fixedNow
      ),
    /vision replay export blocked/
  )
}

function testStandaloneSanitizerStripsForbiddenFields(): void {
  const sanitized = sanitizeForExport({
    contactName: 'Alice',
    fullChat: 'complete transcript',
    email: 'alice@example.com',
    phone: '+8613800138000',
    nested: {
      path: '/workspace/project/private/raw.png',
      secret: 'Bearer abc.def',
      imageBase64: 'data:image/png;base64,AAAA'
    }
  })
  const content = JSON.stringify(sanitized.value)
  assert.equal(content.includes('Alice'), false)
  assert.equal(content.includes('complete transcript'), false)
  assert.equal(content.includes('/workspace/project'), false)
  assert.equal(content.includes('alice@example.com'), false)
  assert.equal(content.includes('+8613800138000'), false)
  assert.equal(content.includes('Bearer abc.def'), false)
  assert.equal(content.includes('data:image/png'), false)
  assert.ok(sanitized.redactionSummary.contactNames > 0)
  assert.ok(sanitized.redactionSummary.emails > 0)
  assert.ok(sanitized.redactionSummary.phones > 0)
  assert.equal(sanitized.redactionExportSummary.status, 'blocked')
  assert.equal(sanitized.redactionExportSummary.unknownFieldCount, 1)
  assert.ok(sanitized.redactionExportSummary.blockedTypes.includes('unknown_nested_object'))
  assert.ok(sanitized.redactionExportSummary.omittedFieldPaths.includes('nested'))
}

async function main(): Promise<void> {
  await testJsonAndMarkdownExportAreRedacted()
  await testBlockedPrivacyGateCannotExport()
  testStandaloneSanitizerStripsForbiddenFields()
  console.log('vision replay export mock tests passed')
}

void main()
