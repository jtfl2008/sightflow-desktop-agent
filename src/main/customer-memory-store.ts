import { createHmac, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import type { AppType } from '../core/rpa/types'
import {
  CustomerMemorySettings,
  CustomerMemoryStoreShape,
  CustomerMemorySuggestion,
  CustomerProfileFields,
  CustomerProfileRecord,
  CustomerProfileTombstone
} from '../core/customer-memory-types'
import {
  buildProviderInputCustomerProfile,
  canPromoteSuggestionToProfile,
  normalizeCustomerMemorySettings,
  sanitizeCustomerProfileFields
} from '../core/customer-memory-sanitizer'

const nodeRequire = createRequire(__filename)

interface CustomerMemoryBackend {
  get(key: 'state'): Partial<CustomerMemoryStoreShape> | undefined
  set(key: 'state', value: CustomerMemoryStoreShape): void
  get(key: 'secret'): string | undefined
  set(key: 'secret', value: string): void
}

export interface CustomerMemoryCreateRequest {
  contactKey: string
  sourceAppType: AppType
  displayName?: string
  fields: Partial<CustomerProfileFields>
  retentionDays?: 30 | 90 | 180
}

export class CustomerMemoryStore {
  private readonly backend: CustomerMemoryBackend
  private readonly now: () => Date
  private sequence = 0

  constructor(options: { backend?: CustomerMemoryBackend; now?: () => Date } = {}) {
    this.backend =
      options.backend ?? (createElectronStoreBackend() as unknown as CustomerMemoryBackend)
    this.now = options.now ?? (() => new Date())
  }

  getState(): CustomerMemoryStoreShape {
    return normalizeCustomerMemoryState(this.backend.get('state'))
  }

  getSettings(): CustomerMemorySettings {
    return this.getState().settings
  }

  updateSettings(input: Partial<CustomerMemorySettings>): CustomerMemorySettings {
    const state = this.getState()
    const settings = normalizeCustomerMemorySettings({ ...state.settings, ...input })
    this.save({ ...state, settings })
    return settings
  }

  hashContactKey(appType: AppType, contactKey: string): string {
    const normalized = `${appType}:${normalizeContactKey(contactKey)}`
    return createHmac('sha256', this.getOrCreateSecret()).update(normalized).digest('hex')
  }

  createOrUpdateProfile(request: CustomerMemoryCreateRequest):
    | { created: true; profile: CustomerProfileRecord; warnings: string[] }
    | { created: false; omittedReason: 'disabled' | 'sanitized' } {
    const state = this.getState()
    if (!state.settings.enabled) return { created: false, omittedReason: 'disabled' }

    const sanitized = sanitizeCustomerProfileFields(request.fields)
    if (!sanitized.ok) return { created: false, omittedReason: 'sanitized' }

    const contactKeyHash = this.hashContactKey(request.sourceAppType, request.contactKey)
    const existingId = state.profileIdsByContactKeyHash[contactKeyHash]
    const existing = existingId ? state.profilesById[existingId] : null
    const now = this.now().toISOString()
    const retentionDays = request.retentionDays ?? state.settings.defaultRetentionDays
    const profileId = existing?.profileId || this.createId('cm-profile')
    const profile: CustomerProfileRecord = {
      profileId,
      contactKeyHash,
      displayName: request.displayName,
      sourceAppType: request.sourceAppType,
      version: existing ? existing.version + 1 : 1,
      disabled: false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      expiresAt: addDays(this.now(), retentionDays).toISOString(),
      fields: sanitized.sanitizedFields,
      provenance: Object.keys(sanitized.sanitizedFields).map((fieldPath) => ({
        fieldPath,
        source: 'user_entered',
        confirmedByUser: true,
        createdAt: now
      }))
    }

    this.save({
      ...state,
      profilesById: { ...state.profilesById, [profileId]: profile },
      profileIdsByContactKeyHash: {
        ...state.profileIdsByContactKeyHash,
        [contactKeyHash]: profileId
      }
    })
    return { created: true, profile, warnings: sanitized.warnings.map((warning) => warning.code) }
  }

  createPendingSuggestion(input: {
    contactKey: string
    sourceAppType: AppType
    suggestedFields: Partial<CustomerProfileFields>
    sourceAuditId?: string
  }): CustomerMemorySuggestion {
    const state = this.getState()
    const sanitized = sanitizeCustomerProfileFields(input.suggestedFields)
    const suggestion: CustomerMemorySuggestion = {
      suggestionId: this.createId('cm-suggestion'),
      contactKeyHash: this.hashContactKey(input.sourceAppType, input.contactKey),
      sourceAppType: input.sourceAppType,
      createdAt: this.now().toISOString(),
      expiresAt: addDays(this.now(), state.settings.pendingSuggestionExpiresInDays).toISOString(),
      suggestedFields: sanitized.sanitizedFields,
      sourceAuditId: input.sourceAuditId,
      status: 'pending',
      sanitizerWarnings: sanitized.warnings.map((warning) => warning.code)
    }
    this.save({
      ...state,
      pendingSuggestionsById: {
        ...state.pendingSuggestionsById,
        [suggestion.suggestionId]: suggestion
      }
    })
    return suggestion
  }

  confirmSuggestion(suggestionId: string): CustomerMemorySuggestion | null {
    const state = this.getState()
    const suggestion = state.pendingSuggestionsById[suggestionId]
    if (!suggestion) return null
    const next = { ...suggestion, status: 'confirmed' as const }
    this.save({
      ...state,
      pendingSuggestionsById: { ...state.pendingSuggestionsById, [suggestionId]: next }
    })
    return next
  }

  canPromoteSuggestion(suggestionId: string): boolean {
    const suggestion = this.getState().pendingSuggestionsById[suggestionId]
    return Boolean(suggestion && canPromoteSuggestionToProfile(suggestion))
  }

  deleteProfile(
    profileId: string,
    reason: CustomerProfileTombstone['reason'] = 'user_deleted'
  ): CustomerProfileTombstone | null {
    const state = this.getState()
    const profile = state.profilesById[profileId]
    if (!profile) return null
    const tombstone: CustomerProfileTombstone = {
      profileId,
      contactKeyHash: profile.contactKeyHash,
      deletedAt: this.now().toISOString(),
      deletedBy: 'local_user',
      reason
    }
    const profilesById = { ...state.profilesById }
    delete profilesById[profileId]
    const profileIdsByContactKeyHash = { ...state.profileIdsByContactKeyHash }
    delete profileIdsByContactKeyHash[profile.contactKeyHash]
    this.save({
      ...state,
      profilesById,
      profileIdsByContactKeyHash,
      tombstonesByContactKeyHash: {
        ...state.tombstonesByContactKeyHash,
        [profile.contactKeyHash]: tombstone
      }
    })
    return tombstone
  }

  clearAllProfiles(): CustomerProfileTombstone[] {
    const state = this.getState()
    const tombstones = Object.values(state.profilesById).map((profile) => ({
      profileId: profile.profileId,
      contactKeyHash: profile.contactKeyHash,
      deletedAt: this.now().toISOString(),
      deletedBy: 'local_user' as const,
      reason: 'clear_all' as const
    }))
    this.save({
      ...state,
      profilesById: {},
      profileIdsByContactKeyHash: {},
      tombstonesByContactKeyHash: {
        ...state.tombstonesByContactKeyHash,
        ...Object.fromEntries(tombstones.map((item) => [item.contactKeyHash, item]))
      }
    })
    return tombstones
  }

  cleanupExpired(): CustomerProfileTombstone[] {
    const state = this.getState()
    const now = this.now().getTime()
    const expired = Object.values(state.profilesById).filter(
      (profile) => profile.expiresAt && Date.parse(profile.expiresAt) <= now
    )
    for (const profile of expired) {
      this.deleteProfile(profile.profileId, 'retention_expired')
    }
    return expired.map((profile) => this.getState().tombstonesByContactKeyHash[profile.contactKeyHash])
  }

  buildProviderInputByContact(appType: AppType, contactKey?: string): {
    customerProfile?: ReturnType<typeof buildProviderInputCustomerProfile>['customerProfile']
    omittedReason?: string
  } {
    const state = this.getState()
    if (!state.settings.enabled || !state.settings.providerInjectionEnabledByDefault) {
      return { omittedReason: 'disabled' }
    }
    if (!contactKey?.trim()) return { omittedReason: 'missing_contact' }

    const contactKeyHash = this.hashContactKey(appType, contactKey)
    if (state.tombstonesByContactKeyHash[contactKeyHash]) return { omittedReason: 'deleted' }
    const profileId = state.profileIdsByContactKeyHash[contactKeyHash]
    const profile = profileId ? state.profilesById[profileId] : null
    if (!profile) return { omittedReason: 'not_found' }
    if (profile.disabled) return { omittedReason: 'disabled' }
    if (profile.expiresAt && Date.parse(profile.expiresAt) <= this.now().getTime()) {
      return { omittedReason: 'expired' }
    }
    const hasPending = Object.values(state.pendingSuggestionsById).some(
      (suggestion) => suggestion.contactKeyHash === contactKeyHash && suggestion.status === 'pending'
    )
    if (hasPending) return { omittedReason: 'not_confirmed' }
    return buildProviderInputCustomerProfile(profile)
  }

  private save(state: CustomerMemoryStoreShape): void {
    this.backend.set('state', normalizeCustomerMemoryState(state))
  }

  private getOrCreateSecret(): string {
    const existing = this.backend.get('secret')
    if (existing) return existing
    const next = randomBytes(32).toString('hex')
    this.backend.set('secret', next)
    return next
  }

  private createId(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${this.now().getTime()}-${this.sequence}`
  }
}

export function normalizeCustomerMemoryState(
  raw: Partial<CustomerMemoryStoreShape> | undefined
): CustomerMemoryStoreShape {
  return {
    settings: normalizeCustomerMemorySettings(raw?.settings),
    profilesById: isRecord(raw?.profilesById) ? raw.profilesById : {},
    profileIdsByContactKeyHash: isRecord(raw?.profileIdsByContactKeyHash)
      ? raw.profileIdsByContactKeyHash
      : {},
    tombstonesByContactKeyHash: isRecord(raw?.tombstonesByContactKeyHash)
      ? raw.tombstonesByContactKeyHash
      : {},
    pendingSuggestionsById: isRecord(raw?.pendingSuggestionsById)
      ? raw.pendingSuggestionsById
      : {}
  }
}

export function normalizeContactKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function isRecord<T>(value: unknown): value is Record<string, T> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createElectronStoreBackend(): unknown {
  const storeModule = nodeRequire('electron-store') as {
    default?: new (options: Record<string, unknown>) => unknown
  }
  const StoreClass =
    storeModule.default ??
    (storeModule as unknown as new (options: Record<string, unknown>) => unknown)
  return new StoreClass({
    name: 'customer-memory-store',
    defaults: { state: normalizeCustomerMemoryState(undefined) }
  })
}
