import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SecureProviderBundleManifest } from './provider-manifest-security'
import { evaluateProviderProductionGate } from './provider-production-gate'
import type { ProviderProductionTrustDecision } from './provider-production-gate'
import type { TrustedPublisherRecord } from './provider-security-types'

export interface ProviderVerifyFileInput {
  manifestPath: string
  publishersPath: string
  sourceUrl: string
}

export interface ProviderVerifyOutput extends ProviderProductionTrustDecision {
  status: 'PASS' | 'FAIL'
}

export function verifyProviderManifestFile(input: ProviderVerifyFileInput): ProviderVerifyOutput {
  const manifest = readJson<SecureProviderBundleManifest>(input.manifestPath)
  const publishers = readTrustedPublishers(input.publishersPath)
  const manifestDir = path.dirname(input.manifestPath)
  const artifactContentByPath: Record<string, Uint8Array> = {}

  for (const artifact of manifest.artifacts || []) {
    const artifactPath = path.resolve(manifestDir, artifact.path)
    if (fs.existsSync(artifactPath)) {
      artifactContentByPath[artifact.path] = fs.readFileSync(artifactPath)
    }
  }

  const decision = evaluateProviderProductionGate({
    manifest,
    sourceUrl: input.sourceUrl,
    trustedPublishers: publishers,
    artifactContentByPath
  })

  return {
    status: decision.productionInstallAllowed ? 'PASS' : 'FAIL',
    ...decision
  }
}

function readTrustedPublishers(publishersPath: string): TrustedPublisherRecord[] {
  const payload = readJson<
    TrustedPublisherRecord[] | { trustedPublishers?: TrustedPublisherRecord[] }
  >(publishersPath)
  if (Array.isArray(payload)) return payload
  return payload.trustedPublishers || []
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function getArg(name: string, required = true): string | undefined {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (required && !value) {
    throw new Error(`Missing required argument: ${name}`)
  }
  return value
}

function main(): void {
  const manifestPath = path.resolve(getArg('--manifest')!)
  const publishersPath = path.resolve(getArg('--publishers')!)
  const sourceUrl = getArg('--source-url')!
  const output = verifyProviderManifestFile({ manifestPath, publishersPath, sourceUrl })
  console.log(JSON.stringify(output, null, 2))
  if (output.status === 'FAIL') process.exitCode = 1
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          status: 'FAIL',
          reasonCodes: ['provider.security.verifier_error'],
          message: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      )
    )
    process.exitCode = 1
  }
}
