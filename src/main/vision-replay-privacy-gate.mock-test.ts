import * as assert from 'node:assert/strict'
import type { VisionReplaySample, VisionReplaySuiteManifest } from '../core/rpa/vision-eval-types'
import {
  hasBlockedVisionReplayGate,
  runVisionReplayPrivacyGate
} from './vision-replay-privacy-gate'

const baseSample: VisionReplaySample = {
  id: 'sample-1',
  title: 'Synthetic sample',
  appType: 'wechat',
  locale: 'zh-CN',
  platform: 'any',
  scaleFactor: 1,
  windowBounds: { x: 0, y: 0, width: 1200, height: 800 },
  image: {
    path: 'redacted/sample.png',
    sha256: 'a'.repeat(64),
    width: 1200,
    height: 800,
    kind: 'synthetic'
  },
  tasks: [],
  tags: ['synthetic'],
  createdAt: '2026-05-17T00:00:00.000Z'
}

function manifest(overrides: Partial<VisionReplaySuiteManifest> = {}): VisionReplaySuiteManifest {
  return {
    schemaVersion: 1,
    suiteId: 'suite-1',
    title: 'Suite',
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
    samples: [baseSample],
    ...overrides
  }
}

function assertBlockedCheck(
  result: ReturnType<typeof runVisionReplayPrivacyGate>,
  id: string
): void {
  assert.equal(result.status, 'blocked')
  assert.equal(hasBlockedVisionReplayGate(result), true)
  assert.equal(result.checks.find((check) => check.id === id)?.status, 'blocked')
}

function testSafeSyntheticPasses(): void {
  const result = runVisionReplayPrivacyGate({
    sourceKind: 'suite',
    sampleRootKind: 'repo_fixture',
    repoRoot: '/workspace/project',
    suitePath: '/workspace/project/fixtures/vision-replay/suites/synthetic-basic',
    manifest: manifest()
  })
  assert.equal(result.status, 'passed')
  assert.equal(hasBlockedVisionReplayGate(result), false)
  assert.equal(result.redactionSummary.emails, 0)
}

function testRawFullScreenshotWithoutConsentBlocked(): void {
  const result = runVisionReplayPrivacyGate({
    sourceKind: 'suite',
    manifest: manifest({
      privacy: {
        storesFullScreenshot: true,
        redactionStatus: 'raw_opt_in',
        containsPersonalData: true,
        consentRequired: true,
        retentionDays: 7
      }
    })
  })
  assertBlockedCheck(result, 'raw_full_screenshot_blocked')
  assertBlockedCheck(result, 'consent_required')
}

function testMissingConsentIdBlockedEvenWithRedactedFullScreenshot(): void {
  const result = runVisionReplayPrivacyGate({
    sourceKind: 'suite',
    manifest: manifest({
      privacy: {
        storesFullScreenshot: true,
        redactionStatus: 'redacted',
        containsPersonalData: true,
        consentRequired: true,
        retentionDays: 7
      }
    })
  })
  assertBlockedCheck(result, 'consent_required')
}

function testAuditDataImageBlocked(): void {
  const result = runVisionReplayPrivacyGate({
    sourceKind: 'sample',
    privacy: manifest().privacy,
    auditContext: {
      events: [
        {
          metadata: {
            screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
          }
        }
      ]
    }
  })
  assertBlockedCheck(result, 'base64_audit_scan')
}

function testLongAuditBase64Blocked(): void {
  const payload = 'a'.repeat(2004)
  const result = runVisionReplayPrivacyGate({
    sourceKind: 'sample',
    privacy: manifest().privacy,
    auditContext: { imageBase64: payload }
  })
  assertBlockedCheck(result, 'base64_audit_scan')
}

function testRetentionOverThirtyDaysBlocked(): void {
  const result = runVisionReplayPrivacyGate({
    sourceKind: 'suite',
    manifest: manifest({
      privacy: {
        storesFullScreenshot: false,
        redactionStatus: 'redacted',
        containsPersonalData: false,
        consentRequired: false,
        retentionDays: 31
      }
    })
  })
  assertBlockedCheck(result, 'retention_days')
}

function testRepoRawPathBlocked(): void {
  const result = runVisionReplayPrivacyGate({
    sourceKind: 'suite',
    sampleRootKind: 'repo_fixture',
    repoRoot: '/workspace/project',
    suitePath: '/workspace/project/fixtures/vision-replay/suites/raw-case',
    manifest: manifest({
      samples: [
        {
          ...baseSample,
          image: {
            ...baseSample.image,
            path: 'raw/full-screenshot.png'
          }
        }
      ]
    })
  })
  assertBlockedCheck(result, 'repo_fixture_raw_path')
}

function testSchemaAndHashFailuresBlock(): void {
  const result = runVisionReplayPrivacyGate({
    sourceKind: 'report',
    privacy: manifest().privacy,
    schemaStatus: 'invalid',
    hashStatus: 'mismatch'
  })
  assertBlockedCheck(result, 'schema_ok')
  assertBlockedCheck(result, 'hash_ok')
}

function main(): void {
  testSafeSyntheticPasses()
  testRawFullScreenshotWithoutConsentBlocked()
  testMissingConsentIdBlockedEvenWithRedactedFullScreenshot()
  testAuditDataImageBlocked()
  testLongAuditBase64Blocked()
  testRetentionOverThirtyDaysBlocked()
  testRepoRawPathBlocked()
  testSchemaAndHashFailuresBlock()
  console.log('vision replay privacy gate mock tests passed')
}

main()
