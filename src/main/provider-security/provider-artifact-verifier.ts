import type { SecureProviderBundleManifest } from './provider-manifest-security'
import { sha256Hex, validateProviderEntryPath } from './provider-manifest-security'
import type { ProviderArtifactVerification } from './provider-security-types'

export function verifyProviderArtifacts(
  manifest: SecureProviderBundleManifest,
  artifactContentByPath: Record<string, Uint8Array | string>
): ProviderArtifactVerification {
  const entryPath = validateProviderEntryPath(manifest.entry)
  if (!entryPath.valid) {
    return {
      valid: false,
      code: entryPath.code,
      message: entryPath.message,
      artifactHashes: {}
    }
  }

  const artifacts = manifest.artifacts || []
  const entryArtifact = artifacts.find(
    (artifact) => validateProviderEntryPath(artifact.path).normalizedPath === entryPath.normalizedPath
  )
  if (!entryArtifact) {
    return {
      valid: false,
      code: 'provider.security.missing_artifact',
      message: `artifacts must include entry path: ${manifest.entry}`,
      artifactHashes: {}
    }
  }

  const artifactHashes: Record<string, string> = {}
  for (const artifact of artifacts) {
    const pathCheck = validateProviderEntryPath(artifact.path)
    if (!pathCheck.valid || !pathCheck.normalizedPath) {
      return {
        valid: false,
        code: pathCheck.code,
        message: pathCheck.message,
        artifactHashes
      }
    }

    const content = artifactContentByPath[artifact.path] ?? artifactContentByPath[pathCheck.normalizedPath]
    if (content === undefined) {
      return {
        valid: false,
        code: 'provider.security.missing_artifact',
        message: `missing artifact content: ${artifact.path}`,
        artifactHashes
      }
    }

    const digest = sha256Hex(content)
    artifactHashes[pathCheck.normalizedPath] = digest
    if (digest !== artifact.sha256.toLowerCase()) {
      return {
        valid: false,
        code: 'provider.security.artifact_hash_mismatch',
        message: `sha256 mismatch for ${artifact.path}`,
        artifactHashes
      }
    }
  }

  return { valid: true, artifactHashes }
}
