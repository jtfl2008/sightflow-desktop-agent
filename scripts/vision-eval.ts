import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { renderVisionEvalMarkdown, runVisionEval } from '../src/core/rpa/vision-eval-runner'

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const suitePath = args.suite || 'fixtures/vision-replay/suites'
  const reportDir = args['report-dir'] || 'reports/vision-eval'
  const failUnder = Number(args['fail-under-pass-rate'] || '0.95')
  const failOnPrivacy = args['fail-on-privacy-violation'] !== 'false'

  try {
    const report = await runVisionEval({ suitePath, failUnderPassRate: failUnder })
    await mkdir(reportDir, { recursive: true })
    const stamp = report.generatedAt.replace(/[^0-9]/g, '')
    const jsonPath = path.join(reportDir, `${stamp}.json`)
    const mdPath = path.join(reportDir, `${stamp}.md`)
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await writeFile(mdPath, renderVisionEvalMarkdown(report), 'utf8')
    await writeFile(path.join(reportDir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await writeFile(path.join(reportDir, 'latest.md'), renderVisionEvalMarkdown(report), 'utf8')
    console.log(`Vision eval report written: ${jsonPath}`)

    if (failOnPrivacy && report.summary.privacyViolations > 0) process.exitCode = 3
    else if (report.failures.some((failure) => failure.category === 'sample_hash_mismatch')) process.exitCode = 4
    else if (report.summary.passRate < failUnder) process.exitCode = 1
    else process.exitCode = 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = message.includes('schema_invalid') ? 2 : 4
  }
}

function parseArgs(args: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = args[index + 1]
    out[key] = next && !next.startsWith('--') ? next : 'true'
    if (next && !next.startsWith('--')) index += 1
  }
  return out
}

void main()
