import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface RecoveryFixtureCase {
  id: string
  settingsBefore: Record<string, unknown>
  providerLifecycleBefore: Record<string, unknown>
  expectedAfter: {
    decision: string
    productionVisible: boolean
    activeProviderId: string
    activeVersion?: string
    reasonCodes: string[]
  }
}

interface RecoveryFixtureIndex {
  schema: string
  version: number
  cases: RecoveryFixtureCase[]
}

const FIXTURE_ROOT = join(process.cwd(), 'fixtures/provider-recovery')
const REQUIRED_CASE_IDS = new Set([
  'lifecycle-active-settings-missing',
  'lifecycle-active-settings-missing-missing-source',
  'lifecycle-active-http-source',
  'lifecycle-active-unsupported-source',
  'lifecycle-active-debug-only',
  'lifecycle-active-tampered',
  'lifecycle-active-sha256-mismatch',
  'lifecycle-active-unknown-publisher',
  'lifecycle-active-revoked-publisher',
  'settings-trusted-lifecycle-missing',
  'unsigned',
  'debug-only',
  'tampered',
  'sha256-mismatch',
  'revoked',
  'missing-install',
  'settings-insecure-transport',
  'active-denied-previous-trusted',
  'active-denied-previous-insecure',
  'active-denied-no-previous',
  'audit-gap',
  'url-query-local-path-redaction'
])
const NEGATIVE_CASE_IDS = new Set([
  'unsigned',
  'lifecycle-active-settings-missing-missing-source',
  'lifecycle-active-http-source',
  'lifecycle-active-unsupported-source',
  'lifecycle-active-debug-only',
  'lifecycle-active-tampered',
  'lifecycle-active-sha256-mismatch',
  'lifecycle-active-unknown-publisher',
  'lifecycle-active-revoked-publisher',
  'debug-only',
  'tampered',
  'sha256-mismatch',
  'revoked',
  'missing-install',
  'settings-insecure-transport',
  'active-denied-previous-insecure',
  'active-denied-no-previous',
  'url-query-local-path-redaction'
])
const FORBIDDEN_FIXTURE_CONTENT =
  /(sk-[A-Za-z0-9_-]+|Bearer\s+|apiKey|api_key|password|token=|secret=|\/workspace\/|\/home\/|\/Users\/|[A-Z]:\\|deployment_manifest|bundle secret)/i

function readFixtureIndex(): RecoveryFixtureIndex {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, 'crash-injection-index.json'), 'utf8'))
}

function assertFixtureCoverage(index: RecoveryFixtureIndex): void {
  assert.equal(index.schema, 'sightflow.provider-recovery.crash-injection-fixtures')
  assert.equal(index.version, 1)
  assert.equal(index.cases.length >= REQUIRED_CASE_IDS.size, true)
  const ids = new Set(index.cases.map((item) => item.id))
  for (const id of Array.from(REQUIRED_CASE_IDS)) {
    assert.equal(ids.has(id), true, `missing recovery fixture ${id}`)
  }
}

function assertExpectedOutcomes(index: RecoveryFixtureIndex): void {
  for (const item of index.cases) {
    assert.ok(item.settingsBefore && typeof item.settingsBefore === 'object')
    assert.ok(item.providerLifecycleBefore && typeof item.providerLifecycleBefore === 'object')
    assert.ok(item.expectedAfter && typeof item.expectedAfter === 'object')
    assert.equal(Array.isArray(item.expectedAfter.reasonCodes), true)
    assert.equal(item.expectedAfter.reasonCodes.length > 0, true)
    if (NEGATIVE_CASE_IDS.has(item.id)) {
      assert.equal(item.expectedAfter.productionVisible, false, item.id)
      assert.equal(item.expectedAfter.activeProviderId, 'builtin-doubao', item.id)
    }
  }
}

function assertRedactionHygiene(): void {
  const readme = readFileSync(join(FIXTURE_ROOT, 'README.md'), 'utf8')
  const index = readFileSync(join(FIXTURE_ROOT, 'crash-injection-index.json'), 'utf8')
  assert.equal(FORBIDDEN_FIXTURE_CONTENT.test(index), false)
  assert.equal(/deployment_manifest/i.test(readme), false)
}

function main(): void {
  const index = readFixtureIndex()
  assertFixtureCoverage(index)
  assertExpectedOutcomes(index)
  assertRedactionHygiene()
  console.log('provider recovery fixtures mock tests passed')
}

main()
