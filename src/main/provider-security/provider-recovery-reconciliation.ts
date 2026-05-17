import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import type { AuditStore } from '../audit-store'
import type { InstalledProviderInfo, ProviderBundleManifest } from '../provider-bundle'
import {
  ProviderRecoveryDecision,
  ProviderRecoverySafeSummary,
  recordProviderRecoveryReconciliationAudit
} from '../provider-lifecycle-audit'
import type { ProviderProductionTrustDecision } from './provider-production-gate'
import { evaluateProviderProductionGate } from './provider-production-gate'
import { validateProviderEntryPath } from './provider-manifest-security'
import type {
  ProviderInstalledVersionRecord,
  ProviderLifecycleStore,
  ProviderLifecycleStoreShape
} from './provider-lifecycle-store'
import type { TrustedPublisherRecord } from './provider-security-types'

export interface ProviderRecoverySettings {
  chatProvider: {
    manifestUrl: string
    installed: InstalledProviderInfo | null
    previousInstalled: InstalledProviderInfo | null
    config: Record<string, any>
  }
}

export interface ProviderRecoverySettingsStore<TSettings extends ProviderRecoverySettings> {
  store: unknown
  set(value: TSettings): void
}

interface LoadedRecoveryCandidate {
  installed: InstalledProviderInfo
  manifest: ProviderBundleManifest
  manifestPath: string
}

export interface ProviderRecoveryReconciliationOptions<TSettings extends ProviderRecoverySettings> {
  settings: TSettings
  settingsStore: ProviderRecoverySettingsStore<TSettings>
  providerLifecycleStore: ProviderLifecycleStore
  auditStore: Pick<AuditStore, 'record'>
  loadInstalledProviderManifest(installed: InstalledProviderInfo): Promise<ProviderBundleManifest | null>
  loadLifecycleInstalledProvider?(
    providerId: string,
    version: string,
    record: Partial<ProviderInstalledVersionRecord>
  ): Promise<LoadedRecoveryCandidate | null>
  evaluateInstalledProviderGate?(
    installed: InstalledProviderInfo,
    manifest: ProviderBundleManifest
  ): Promise<ProviderProductionTrustDecision>
  trustedPublishers?: TrustedPublisherRecord[]
  now?: () => Date
}

export interface ProviderRecoveryReconciliationResult {
  decision: ProviderRecoveryDecision
  productionVisible: boolean
  activeProviderId: string
  activeVersion?: string
  reasonCodes: string[]
}

const BUILTIN_PROVIDER_ID = 'builtin-doubao'

export async function reconcileProviderLifecycleWithSettings<TSettings extends ProviderRecoverySettings>(
  options: ProviderRecoveryReconciliationOptions<TSettings>
): Promise<ProviderRecoveryReconciliationResult> {
  const state = options.providerLifecycleStore.getState()
  const activePointer = firstActivePointer(state)
  const activeRecord = activePointer
    ? state.versionsByProviderId[activePointer.providerId]?.[activePointer.activeVersion]
    : undefined
  const beforeSummary = summarizeRecoveryState(options.settings, activePointer, activeRecord)
  const reasonCodes = new Set<string>()
  const checkedAt = (options.now ?? (() => new Date()))().toISOString()
  addInputRedactionReasons(options.settings, reasonCodes)

  const settingsCandidate = await loadSettingsCandidate(options)
  const activeCandidate =
    activePointer && activeRecord
      ? await loadLifecycleCandidate(options, activePointer.providerId, activePointer.activeVersion, activeRecord)
      : null
  const activeGate = activeCandidate
    ? await evaluateCandidateGate(options, activeCandidate)
    : null

  if (options.settings.chatProvider.installed && !settingsCandidate) {
    reasonCodes.add('provider.recovery.settings_points_to_missing_install')
    return fallbackToBuiltin(options, state, beforeSummary, reasonCodes, checkedAt, {
      settingsProviderId: options.settings.chatProvider.installed.id,
      settingsVersion: options.settings.chatProvider.installed.version,
      lifecycleActiveVersion: activePointer?.activeVersion,
      inconsistencyType: 'settings_points_to_missing_install'
    })
  }

  if (activeCandidate && activeGate && !activeGate.productionInstallAllowed) {
    reasonCodes.add('provider.recovery.active_pointer_gate_denied')
    for (const code of activeGate.reasonCodes) reasonCodes.add(code)
    const rollback = await tryRollbackToPrevious(options, state, activePointer!, reasonCodes)
    if (rollback) {
      const nextSettings = withInstalledProvider(options.settings, rollback.candidate.installed, options.settings.chatProvider.installed)
      options.settingsStore.set(nextSettings)
      const afterSummary = summarizeInstalled(rollback.candidate.installed, rollback.gate, true)
      recordProviderRecoveryReconciliationAudit(options.auditStore, {
        success: true,
        decision: 'recovery_rollback_to_previous',
        reasonCodes: Array.from(reasonCodes).sort(),
        providerId: rollback.candidate.installed.id,
        settingsProviderId: options.settings.chatProvider.installed?.id,
        settingsVersion: options.settings.chatProvider.installed?.version,
        lifecycleActiveVersion: activePointer?.activeVersion,
        previousTrustedVersion: rollback.candidate.installed.version,
        inconsistencyType: 'active_pointer_gate_denied',
        beforeSummary,
        afterSummary,
        redactionExportSummary: passedRedactionSummary(checkedAt)
      })
      return {
        decision: 'recovery_rollback_to_previous',
        productionVisible: true,
        activeProviderId: rollback.candidate.installed.id,
        activeVersion: rollback.candidate.installed.version,
        reasonCodes: Array.from(reasonCodes).sort()
      }
    }
    return fallbackToBuiltin(options, state, beforeSummary, reasonCodes, checkedAt, {
      settingsProviderId: options.settings.chatProvider.installed?.id,
      settingsVersion: options.settings.chatProvider.installed?.version,
      lifecycleActiveVersion: activePointer?.activeVersion,
      inconsistencyType: 'active_pointer_gate_denied'
    })
  }

  if (settingsCandidate) {
    const settingsGate = await evaluateCandidateGate(options, settingsCandidate)
    if (!settingsGate.productionInstallAllowed) {
      addSettingsUntrustedReason(reasonCodes, settingsGate)
      for (const code of settingsGate.reasonCodes) reasonCodes.add(code)
      return fallbackToBuiltin(options, state, beforeSummary, reasonCodes, checkedAt, {
        providerId: settingsCandidate.installed.id,
        settingsProviderId: settingsCandidate.installed.id,
        settingsVersion: settingsCandidate.installed.version,
        lifecycleActiveVersion: activePointer?.activeVersion,
        inconsistencyType: 'settings_points_to_untrusted_provider'
      })
    }

    if (!activePointer || activePointer.providerId !== settingsCandidate.installed.id || activePointer.activeVersion !== settingsCandidate.installed.version) {
      reasonCodes.add(activePointer ? 'provider.recovery.settings_lifecycle_mismatch' : 'provider.recovery.settings_trusted_lifecycle_missing')
      options.providerLifecycleStore.commitInstallOrUpdate(activePointer ? 'update' : 'install', {
        installed: settingsCandidate.installed,
        manifest: settingsCandidate.manifest,
        gate: settingsGate,
        manifestPath: settingsCandidate.manifestPath,
        activatedAt: checkedAt
      })
      recordProviderRecoveryReconciliationAudit(options.auditStore, {
        success: true,
        decision: 'recovery_reconciled',
        reasonCodes: Array.from(reasonCodes).sort(),
        providerId: settingsCandidate.installed.id,
        settingsProviderId: settingsCandidate.installed.id,
        settingsVersion: settingsCandidate.installed.version,
        lifecycleActiveVersion: activePointer?.activeVersion,
        inconsistencyType: activePointer ? 'settings_lifecycle_mismatch' : 'settings_trusted_lifecycle_missing',
        beforeSummary,
        afterSummary: summarizeInstalled(settingsCandidate.installed, settingsGate, true),
        redactionExportSummary: passedRedactionSummary(checkedAt)
      })
      return {
        decision: 'recovery_reconciled',
        productionVisible: true,
        activeProviderId: settingsCandidate.installed.id,
        activeVersion: settingsCandidate.installed.version,
        reasonCodes: Array.from(reasonCodes).sort()
      }
    }

    reasonCodes.add('provider.recovery.audit_gap_detected')
    recordProviderRecoveryReconciliationAudit(options.auditStore, {
      success: true,
      decision: 'recovery_reconciled',
      reasonCodes: Array.from(reasonCodes).sort(),
      providerId: settingsCandidate.installed.id,
      settingsProviderId: settingsCandidate.installed.id,
      settingsVersion: settingsCandidate.installed.version,
      lifecycleActiveVersion: activePointer.activeVersion,
      inconsistencyType: 'audit_gap_detected',
      beforeSummary,
      afterSummary: summarizeInstalled(settingsCandidate.installed, settingsGate, true),
      redactionExportSummary: passedRedactionSummary(checkedAt)
    })
    return {
      decision: 'recovery_reconciled',
      productionVisible: true,
      activeProviderId: settingsCandidate.installed.id,
      activeVersion: settingsCandidate.installed.version,
      reasonCodes: Array.from(reasonCodes).sort()
    }
  }

  if (activeCandidate && activeGate?.productionInstallAllowed) {
    reasonCodes.add('provider.recovery.lifecycle_active_trusted_settings_missing')
    const nextSettings = withInstalledProvider(options.settings, activeCandidate.installed, null)
    options.settingsStore.set(nextSettings)
    recordProviderRecoveryReconciliationAudit(options.auditStore, {
      success: true,
      decision: 'recovery_reconciled',
      reasonCodes: Array.from(reasonCodes).sort(),
      providerId: activeCandidate.installed.id,
      lifecycleActiveVersion: activeCandidate.installed.version,
      inconsistencyType: 'lifecycle_active_trusted_settings_missing',
      beforeSummary,
      afterSummary: summarizeInstalled(activeCandidate.installed, activeGate, true),
      redactionExportSummary: passedRedactionSummary(checkedAt)
    })
    return {
      decision: 'recovery_reconciled',
      productionVisible: true,
      activeProviderId: activeCandidate.installed.id,
      activeVersion: activeCandidate.installed.version,
      reasonCodes: Array.from(reasonCodes).sort()
    }
  }

  reasonCodes.add('provider.recovery.not_needed')
  recordProviderRecoveryReconciliationAudit(options.auditStore, {
    success: true,
    decision: 'recovery_not_needed',
    reasonCodes: Array.from(reasonCodes).sort(),
    lifecycleActiveVersion: activePointer?.activeVersion,
    beforeSummary,
    afterSummary: beforeSummary,
    redactionExportSummary: passedRedactionSummary(checkedAt)
  })
  return {
    decision: 'recovery_not_needed',
    productionVisible: false,
    activeProviderId: BUILTIN_PROVIDER_ID,
    reasonCodes: Array.from(reasonCodes).sort()
  }
}

export async function loadLifecycleInstalledProviderFromUserData(
  userDataRoot: string,
  providerId: string,
  version: string
): Promise<LoadedRecoveryCandidate | null> {
  const manifestPath = `providers/${providerId}/${version}/manifest.json`
  const manifestFile = join(userDataRoot, manifestPath)
  try {
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as ProviderBundleManifest
    if (manifest.id !== providerId || manifest.version !== version) return null
    const entryPath = validateProviderEntryPath(manifest.entry)
    if (!entryPath.valid || !entryPath.normalizedPath) return null
    return {
      installed: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        entryFile: join(dirname(manifestFile), entryPath.normalizedPath),
        installedAt: '0'
      },
      manifest,
      manifestPath
    }
  } catch {
    return null
  }
}

async function loadSettingsCandidate<TSettings extends ProviderRecoverySettings>(
  options: ProviderRecoveryReconciliationOptions<TSettings>
): Promise<LoadedRecoveryCandidate | null> {
  const installed = options.settings.chatProvider.installed
  if (!installed) return null
  const manifest = await options.loadInstalledProviderManifest(installed)
  if (!manifest) return null
  return { installed, manifest, manifestPath: relativeProviderManifestPath(installed) }
}

async function loadLifecycleCandidate<TSettings extends ProviderRecoverySettings>(
  options: ProviderRecoveryReconciliationOptions<TSettings>,
  providerId: string,
  version: string,
  record: Partial<ProviderInstalledVersionRecord>
): Promise<LoadedRecoveryCandidate | null> {
  return (await options.loadLifecycleInstalledProvider?.(providerId, version, record)) ?? null
}

async function evaluateCandidateGate<TSettings extends ProviderRecoverySettings>(
  options: ProviderRecoveryReconciliationOptions<TSettings>,
  candidate: LoadedRecoveryCandidate
): Promise<ProviderProductionTrustDecision> {
  if (options.evaluateInstalledProviderGate) {
    return options.evaluateInstalledProviderGate(candidate.installed, candidate.manifest)
  }
  const installDir = dirname(candidate.installed.entryFile)
  const artifactPaths = new Set<string>((candidate.manifest.artifacts || []).map((artifact) => artifact.path))
  artifactPaths.add(candidate.manifest.entry)
  const artifactContentByPath: Record<string, string> = {}
  for (const artifactPath of Array.from(artifactPaths)) {
    const pathCheck = validateProviderEntryPath(artifactPath)
    if (!pathCheck.valid || !pathCheck.normalizedPath) {
      throw new Error(pathCheck.message || 'Provider artifact path invalid')
    }
    artifactContentByPath[pathCheck.normalizedPath] = await readFile(
      join(installDir, pathCheck.normalizedPath),
      'utf8'
    )
  }
  return evaluateProviderProductionGate({
    manifest: candidate.manifest,
    sourceUrl: pathToFileURL(join(installDir, 'manifest.json')).toString(),
    trustedPublishers: options.trustedPublishers ?? [],
    artifactContentByPath
  })
}

async function tryRollbackToPrevious<TSettings extends ProviderRecoverySettings>(
  options: ProviderRecoveryReconciliationOptions<TSettings>,
  state: ProviderLifecycleStoreShape,
  activePointer: NonNullable<ReturnType<typeof firstActivePointer>>,
  reasonCodes: Set<string>
): Promise<{ candidate: LoadedRecoveryCandidate; gate: ProviderProductionTrustDecision } | null> {
  if (!activePointer.previousVersion) {
    reasonCodes.add('provider.recovery.previous_pointer_missing')
    return null
  }
  const record = state.versionsByProviderId[activePointer.providerId]?.[activePointer.previousVersion]
  if (!record) {
    reasonCodes.add('provider.recovery.previous_pointer_missing')
    return null
  }
  const candidate = await loadLifecycleCandidate(
    options,
    activePointer.providerId,
    activePointer.previousVersion,
    record
  )
  if (!candidate) {
    reasonCodes.add('provider.recovery.previous_pointer_missing_install')
    return null
  }
  const gate = await evaluateCandidateGate(options, candidate)
  if (!gate.productionInstallAllowed) {
    reasonCodes.add('provider.recovery.previous_pointer_gate_denied')
    for (const code of gate.reasonCodes) reasonCodes.add(code)
    return null
  }
  const rollback = options.providerLifecycleStore.rollback({
    installed: candidate.installed,
    manifest: candidate.manifest,
    gate,
    manifestPath: candidate.manifestPath
  })
  if (!rollback.ok) {
    for (const code of rollback.reasonCodes) reasonCodes.add(code)
    return null
  }
  reasonCodes.add('provider.recovery.previous_pointer_reverified')
  return { candidate, gate }
}

function fallbackToBuiltin<TSettings extends ProviderRecoverySettings>(
  options: ProviderRecoveryReconciliationOptions<TSettings>,
  state: ProviderLifecycleStoreShape,
  beforeSummary: ProviderRecoverySafeSummary,
  reasonCodes: Set<string>,
  checkedAt: string,
  metadata: {
    providerId?: string
    settingsProviderId?: string
    settingsVersion?: string
    lifecycleActiveVersion?: string
    inconsistencyType?: string
  }
): ProviderRecoveryReconciliationResult {
  reasonCodes.add('provider.recovery.fallback_builtin')
  options.settingsStore.set({
    ...options.settings,
    chatProvider: {
      ...options.settings.chatProvider,
      manifestUrl: '',
      installed: null,
      config: {}
    }
  })
  options.providerLifecycleStore.replaceStateForRecovery(blockActivePointers(state))
  const afterSummary: ProviderRecoverySafeSummary = {
    providerId: BUILTIN_PROVIDER_ID,
    trustLevel: 'builtin',
    productionInstallAllowed: true,
    hasSettingsInstalled: false,
    hasLifecyclePointer: false
  }
  recordProviderRecoveryReconciliationAudit(options.auditStore, {
    success: false,
    decision: 'recovery_fallback_builtin',
    reasonCodes: Array.from(reasonCodes).sort(),
    ...metadata,
    beforeSummary,
    afterSummary,
    redactionExportSummary: passedRedactionSummary(checkedAt)
  })
  return {
    decision: 'recovery_fallback_builtin',
    productionVisible: false,
    activeProviderId: BUILTIN_PROVIDER_ID,
    reasonCodes: Array.from(reasonCodes).sort()
  }
}

function blockActivePointers(state: ProviderLifecycleStoreShape): ProviderLifecycleStoreShape {
  return {
    activePointersByProviderId: {},
    versionsByProviderId: Object.fromEntries(
      Object.entries(state.versionsByProviderId).map(([providerId, versions]) => [
        providerId,
        Object.fromEntries(
          Object.entries(versions).map(([version, record]) => [
            version,
            record.lifecycleState === 'active'
              ? { ...record, lifecycleState: 'blocked', trustLevel: record.trustLevel === 'builtin' ? 'builtin' : 'blocked' }
              : { ...record }
          ])
        )
      ])
    )
  }
}

function firstActivePointer(state: ProviderLifecycleStoreShape) {
  return Object.values(state.activePointersByProviderId)[0]
}

function withInstalledProvider<TSettings extends ProviderRecoverySettings>(
  settings: TSettings,
  installed: InstalledProviderInfo,
  previousInstalled: InstalledProviderInfo | null
): TSettings {
  return {
    ...settings,
    chatProvider: {
      ...settings.chatProvider,
      manifestUrl: '',
      installed,
      previousInstalled
    }
  }
}

function summarizeRecoveryState<TSettings extends ProviderRecoverySettings>(
  settings: TSettings,
  activePointer: ReturnType<typeof firstActivePointer>,
  activeRecord: Partial<ProviderInstalledVersionRecord> | undefined
): ProviderRecoverySafeSummary {
  return {
    providerId: settings.chatProvider.installed?.id || activePointer?.providerId,
    version: settings.chatProvider.installed?.version || activePointer?.activeVersion,
    trustLevel: activeRecord?.trustLevel,
    hasSettingsInstalled: Boolean(settings.chatProvider.installed),
    hasLifecyclePointer: Boolean(activePointer),
    hasPreviousPointer: Boolean(activePointer?.previousVersion),
    manifestUrlOrigin: safeUrlOrigin(settings.chatProvider.manifestUrl),
    manifestUrlHasRedactedQuery: hasUrlQuery(settings.chatProvider.manifestUrl)
  }
}

function summarizeInstalled(
  installed: InstalledProviderInfo,
  gate: ProviderProductionTrustDecision,
  hasLifecyclePointer: boolean
): ProviderRecoverySafeSummary {
  return {
    providerId: installed.id,
    version: installed.version,
    trustLevel: gate.trustLevel,
    productionInstallAllowed: gate.productionInstallAllowed,
    hasSettingsInstalled: true,
    hasLifecyclePointer
  }
}

function addSettingsUntrustedReason(
  reasonCodes: Set<string>,
  gate: ProviderProductionTrustDecision
): void {
  if (gate.reasonCodes.includes('provider.security.missing_signature')) {
    reasonCodes.add('provider.recovery.settings_untrusted_unsigned')
    return
  }
  if (gate.reasonCodes.includes('provider.security.artifact_hash_mismatch')) {
    reasonCodes.add('provider.recovery.settings_untrusted_sha256_mismatch')
    return
  }
  if (gate.reasonCodes.includes('provider.security.revoked_publisher')) {
    reasonCodes.add('provider.recovery.settings_untrusted_revoked_publisher')
    return
  }
  if (gate.trustLevel === 'debug_only') {
    reasonCodes.add('provider.recovery.settings_untrusted_debug_only')
    return
  }
  reasonCodes.add('provider.recovery.settings_untrusted_tampered')
}

function addInputRedactionReasons<TSettings extends ProviderRecoverySettings>(
  settings: TSettings,
  reasonCodes: Set<string>
): void {
  if (hasUrlQuery(settings.chatProvider.manifestUrl)) {
    reasonCodes.add('provider.recovery.redacted_manifest_url_query')
  }
  const entryFile = settings.chatProvider.installed?.entryFile
  if (entryFile && (entryFile.startsWith('/') || /^[A-Za-z]:\\/.test(entryFile))) {
    reasonCodes.add('provider.recovery.redacted_local_absolute_path')
  }
}

function relativeProviderManifestPath(installed: InstalledProviderInfo): string {
  return `providers/${installed.id}/${installed.version}/manifest.json`
}

function safeUrlOrigin(value: string): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

function hasUrlQuery(value: string): boolean {
  if (!value) return false
  try {
    return Boolean(new URL(value).search)
  } catch {
    return false
  }
}

function passedRedactionSummary(checkedAt: string) {
  return {
    status: 'passed' as const,
    blockedTypes: [],
    omittedFieldPaths: [],
    unknownFieldCount: 0,
    checkedAt
  }
}
