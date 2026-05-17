import * as assert from 'node:assert/strict'
import { parseManifest, renderVisionEvalMarkdown, runVisionEval } from './vision-eval-runner'

async function testSyntheticFixturePasses(): Promise<void> {
  const report = await runVisionEval({ suitePath: 'fixtures/vision-replay/suites/synthetic-basic' })
  assert.equal(report.summary.privacyViolations, 0)
  assert.equal(report.summary.passRate, 1)
  assert.equal(report.failures.length, 0)
  assert.ok(renderVisionEvalMarkdown(report).includes('Privacy gate: passed'))
}

function testSchemaInvalidRejected(): void {
  assert.throws(() => parseManifest('{"schemaVersion":2}'), /schema_invalid/)
}

async function testPrivacyGateFailsRawWithoutConsent(): Promise<void> {
  const report = await runVisionEval({ suitePath: 'fixtures/vision-replay/suites/privacy-raw-blocked' })
  assert.equal(report.summary.privacyViolations, 1)
  assert.equal(report.failures[0].category, 'privacy_raw_screenshot_without_consent')
}

async function main(): Promise<void> {
  await testSyntheticFixturePasses()
  testSchemaInvalidRejected()
  await testPrivacyGateFailsRawWithoutConsent()
  console.log('vision eval mock tests passed')
}

void main()
