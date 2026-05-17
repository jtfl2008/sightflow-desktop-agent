import { createRequire } from 'node:module'
import type { InstalledProviderInfo, ProviderBundleManifest } from '../provider-bundle'
import type { ProviderProductionTrustDecision } from './provider-production-gate'

const nodeRequire = createRequire(__filename)

export type ProviderLifecycleTrustLevel = 'builtin' | 'trusted_signed' | 'debug_only' | 'blocked'
export type ProviderLifecycleState = 'installed' | 'active' | 'previous' | 'blocked' | 'removed'
export type ProviderLifecycleOperation = 'install' | 'update' | 'rollback'

export interface ProviderInstalledVersionRecord {
  providerId: string
  version: string
  publisherId?: string
  keyId?: string
  installedAt: string
  activatedAt?: string
  manifestPath: string
  artifactHashes: Record<string, string>
  permissionNames: string[]
  trustLevel: ProviderLifecycleTrustLevel
  lifecycleState: ProviderLifecycleState
}

export interface ProviderActivePointer {
  providerId: string
  activeVersion: string
  previousVersion?: string
  rollbackEligible: boolean
  rollbackIneligibleReason?: string
  updatedAt: string
}

export interface ProviderLifecycleStoreShape {
  activePointersByProviderId: Record<string, ProviderActivePointer>
  versionsByProviderId: Record<string, Record<string, Partial<ProviderInstalledVersionRecord>>>
}

export interface ProviderLifecycleCandidate {
  installed: InstalledProviderInfo
  manifest: ProviderBundleManifest
  gate: ProviderProductionTrustDecision
  manifestPath: string
  activatedAt?: string
}

export interface ProviderLifecycleMutationResult {
  ok: boolean
  operation: ProviderLifecycleOperation
  providerId: string
  targetVersion: string
  activePointer?: ProviderActivePointer
  reasonCodes: string[]
}

interface ProviderLifecycleBackend {
  get(key: 'providerLifecycle'): ProviderLifecycleStoreShape | undefined
  set(key: 'providerLifecycle', value: ProviderLifecycleStoreShape): void
}

export interface ProviderLifecycleStoreOptions {
  backend?: ProviderLifecycleBackend
  now?: () => Date
}

const EMPTY_SHAPE: ProviderLifecycleStoreShape = {
  activePointersByProviderId: {},
  versionsByProviderId: {}
}

export class ProviderLifecycleStore {
  private readonly backend: ProviderLifecycleBackend
  private readonly now: () => Date

  constructor(options: ProviderLifecycleStoreOptions = {}) {
    this.backend = options.backend ?? createElectronStoreBackend()
    this.now = options.now ?? (() => new Date())
  }

  getState(): ProviderLifecycleStoreShape {
    return normalizeShape(this.backend.get('providerLifecycle'))
  }

  getActivePointer(providerId: string): ProviderActivePointer | undefined {
    return this.getState().activePointersByProviderId[providerId]
  }

  replaceStateForRecovery(state: ProviderLifecycleStoreShape): void {
    this.backend.set('providerLifecycle', normalizeShape(state))
  }

  commitInstallOrUpdate(
    operation: 'install' | 'update',
    candidate: ProviderLifecycleCandidate
  ): ProviderLifecycleMutationResult {
    const providerId = candidate.manifest.id
    const targetVersion = candidate.manifest.version
    const current = this.getState()
    const currentPointer = current.activePointersByProviderId[providerId]

    const denied = validateCandidate(candidate, operation)
    if (denied.length) {
      return {
        ok: false,
        operation,
        providerId,
        targetVersion,
        activePointer: currentPointer,
        reasonCodes: denied
      }
    }

    const next = cloneShape(current)
    const versions = (next.versionsByProviderId[providerId] ??= {})
    const previousVersion =
      currentPointer?.activeVersion && currentPointer.activeVersion !== targetVersion
        ? currentPointer.activeVersion
        : currentPointer?.previousVersion

    if (previousVersion && versions[previousVersion]) {
      versions[previousVersion] = {
        ...versions[previousVersion],
        lifecycleState: 'previous'
      }
    }

    const activatedAt = candidate.activatedAt ?? this.now().toISOString()
    versions[targetVersion] = toInstalledVersionRecord(candidate, activatedAt, 'active')

    const rollbackStatus = evaluateRollbackEligibility(versions, previousVersion)
    const activePointer: ProviderActivePointer = {
      providerId,
      activeVersion: targetVersion,
      previousVersion,
      rollbackEligible: rollbackStatus.eligible,
      rollbackIneligibleReason: rollbackStatus.reason,
      updatedAt: activatedAt
    }
    next.activePointersByProviderId[providerId] = activePointer
    this.backend.set('providerLifecycle', next)

    return {
      ok: true,
      operation,
      providerId,
      targetVersion,
      activePointer,
      reasonCodes: []
    }
  }

  rollback(candidate: ProviderLifecycleCandidate): ProviderLifecycleMutationResult {
    const providerId = candidate.manifest.id
    const targetVersion = candidate.manifest.version
    const current = this.getState()
    const currentPointer = current.activePointersByProviderId[providerId]
    const versions = current.versionsByProviderId[providerId] ?? {}
    const targetRecord = versions[targetVersion]

    const historicalReason = rollbackIneligibleReasonForRecord(targetRecord)
    if (historicalReason) {
      return {
        ok: false,
        operation: 'rollback',
        providerId,
        targetVersion,
        activePointer: currentPointer,
        reasonCodes: [historicalReason]
      }
    }

    const denied = validateCandidate(candidate, 'rollback')
    if (denied.length) {
      return {
        ok: false,
        operation: 'rollback',
        providerId,
        targetVersion,
        activePointer: currentPointer,
        reasonCodes: denied
      }
    }

    const next = cloneShape(current)
    const nextVersions = (next.versionsByProviderId[providerId] ??= {})
    const previousVersion =
      currentPointer?.activeVersion && currentPointer.activeVersion !== targetVersion
        ? currentPointer.activeVersion
        : undefined
    if (previousVersion && nextVersions[previousVersion]) {
      nextVersions[previousVersion] = {
        ...nextVersions[previousVersion],
        lifecycleState: 'previous'
      }
    }

    const activatedAt = candidate.activatedAt ?? this.now().toISOString()
    nextVersions[targetVersion] = toInstalledVersionRecord(candidate, activatedAt, 'active')
    const rollbackStatus = evaluateRollbackEligibility(nextVersions, previousVersion)
    const activePointer: ProviderActivePointer = {
      providerId,
      activeVersion: targetVersion,
      previousVersion,
      rollbackEligible: rollbackStatus.eligible,
      rollbackIneligibleReason: rollbackStatus.reason,
      updatedAt: activatedAt
    }
    next.activePointersByProviderId[providerId] = activePointer
    this.backend.set('providerLifecycle', next)

    return {
      ok: true,
      operation: 'rollback',
      providerId,
      targetVersion,
      activePointer,
      reasonCodes: []
    }
  }
}

function validateCandidate(
  candidate: ProviderLifecycleCandidate,
  operation: ProviderLifecycleOperation
): string[] {
  const reasons = new Set<string>(candidate.gate.reasonCodes)
  if (!candidate.gate.productionInstallAllowed) {
    reasons.add('provider.lifecycle.production_gate_denied')
  }
  if (candidate.gate.providerId !== candidate.manifest.id) {
    reasons.add('provider.lifecycle.provider_id_mismatch')
  }
  if (candidate.gate.version !== candidate.manifest.version) {
    reasons.add('provider.lifecycle.version_mismatch')
  }
  if (candidate.installed.id !== candidate.manifest.id) {
    reasons.add('provider.lifecycle.installed_provider_mismatch')
  }
  if (candidate.installed.version !== candidate.manifest.version) {
    reasons.add('provider.lifecycle.installed_version_mismatch')
  }
  if (!candidate.manifestPath || isAbsoluteOrEscaped(candidate.manifestPath)) {
    reasons.add('provider.lifecycle.manifest_path_boundary_violation')
  }
  if (operation === 'rollback' && candidate.gate.trustLevel === 'debug_only') {
    reasons.add('provider.lifecycle.rollback_debug_only_denied')
  }
  return Array.from(reasons).sort()
}

function toInstalledVersionRecord(
  candidate: ProviderLifecycleCandidate,
  activatedAt: string,
  lifecycleState: ProviderLifecycleState
): ProviderInstalledVersionRecord {
  return {
    providerId: candidate.manifest.id,
    version: candidate.manifest.version,
    publisherId: candidate.manifest.security?.publisherId,
    keyId: candidate.manifest.security?.keyId,
    installedAt: candidate.installed.installedAt,
    activatedAt,
    manifestPath: candidate.manifestPath,
    artifactHashes: { ...candidate.gate.artifactHashes },
    permissionNames: (candidate.manifest.permissions || []).map((permission) => permission.name),
    trustLevel: candidate.gate.trustLevel,
    lifecycleState
  }
}

function evaluateRollbackEligibility(
  versions: Record<string, Partial<ProviderInstalledVersionRecord>>,
  previousVersion?: string
): { eligible: boolean; reason?: string } {
  if (!previousVersion) return { eligible: false, reason: 'provider.lifecycle.no_previous_version' }
  const reason = rollbackIneligibleReasonForRecord(versions[previousVersion])
  return reason ? { eligible: false, reason } : { eligible: true }
}

function rollbackIneligibleReasonForRecord(
  record: Partial<ProviderInstalledVersionRecord> | undefined
): string | undefined {
  if (!record) return 'provider.lifecycle.previous_version_missing_metadata'
  if (!record.providerId || !record.version) {
    return 'provider.lifecycle.previous_version_missing_metadata'
  }
  if (!record.manifestPath || typeof record.manifestPath !== 'string') {
    return 'provider.lifecycle.previous_version_missing_manifest_path'
  }
  if (isAbsoluteOrEscaped(record.manifestPath)) {
    return 'provider.lifecycle.previous_version_path_boundary_violation'
  }
  if (!record.artifactHashes || !Object.keys(record.artifactHashes).length) {
    return 'provider.lifecycle.previous_version_missing_artifact_hashes'
  }
  if (record.trustLevel !== 'trusted_signed' && record.trustLevel !== 'builtin') {
    return 'provider.lifecycle.previous_version_not_trusted'
  }
  return undefined
}

function isAbsoluteOrEscaped(value: string): boolean {
  return (
    value.startsWith('/') ||
    /^[A-Za-z]:\\/.test(value) ||
    value.includes('..') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  )
}

function cloneShape(value: ProviderLifecycleStoreShape): ProviderLifecycleStoreShape {
  return {
    activePointersByProviderId: { ...value.activePointersByProviderId },
    versionsByProviderId: Object.fromEntries(
      Object.entries(value.versionsByProviderId).map(([providerId, versions]) => [
        providerId,
        Object.fromEntries(
          Object.entries(versions).map(([version, record]) => [version, { ...record }])
        )
      ])
    )
  }
}

function normalizeShape(value: ProviderLifecycleStoreShape | undefined): ProviderLifecycleStoreShape {
  if (!value || typeof value !== 'object') return cloneShape(EMPTY_SHAPE)
  return {
    activePointersByProviderId: isPlainRecord(value.activePointersByProviderId)
      ? { ...value.activePointersByProviderId }
      : {},
    versionsByProviderId: isPlainRecord(value.versionsByProviderId)
      ? Object.fromEntries(
          Object.entries(value.versionsByProviderId).map(([providerId, versions]) => [
            providerId,
            isPlainRecord(versions) ? { ...versions } : {}
          ])
        )
      : {}
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createElectronStoreBackend(): ProviderLifecycleBackend {
  const storeModule = nodeRequire('electron-store') as {
    default?: new (options: Record<string, unknown>) => unknown
  }
  const StoreClass =
    storeModule.default ??
    (storeModule as unknown as new (options: Record<string, unknown>) => unknown)
  return new StoreClass({
    name: 'provider-lifecycle',
    defaults: { providerLifecycle: EMPTY_SHAPE }
  }) as ProviderLifecycleBackend
}
