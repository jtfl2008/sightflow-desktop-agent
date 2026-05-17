import { createRequire } from 'node:module'
import {
  defaultIntentRoutingSettings,
  IntentRouter
} from '../core/intent-router'
import {
  IntentEvaluationContext,
  IntentRoute,
  IntentRoutingSettings,
  IntentRule
} from '../core/intent-types'

const nodeRequire = createRequire(__filename)
const VALID_ID = /^[a-z][a-z0-9_]{1,63}$/

interface IntentRoutingBackend {
  get(key: 'settings'): IntentRoutingSettings | undefined
  set(key: 'settings', value: IntentRoutingSettings): void
}

export class IntentRoutingStore {
  private readonly backend: IntentRoutingBackend

  constructor(options: { backend?: IntentRoutingBackend } = {}) {
    this.backend =
      options.backend ?? (createElectronStoreBackend() as unknown as IntentRoutingBackend)
  }

  get(): IntentRoutingSettings {
    return normalizeIntentRoutingSettings(this.backend.get('settings'))
  }

  save(settings: IntentRoutingSettings): IntentRoutingSettings {
    const normalized = normalizeIntentRoutingSettings(settings)
    validateIntentRoutingSettings(normalized)
    this.backend.set('settings', normalized)
    return normalized
  }

  resetDefaults(): IntentRoutingSettings {
    const defaults = normalizeIntentRoutingSettings(defaultIntentRoutingSettings)
    this.backend.set('settings', defaults)
    return defaults
  }

  preview(context: IntentEvaluationContext, settings?: IntentRoutingSettings) {
    const normalized = normalizeIntentRoutingSettings(settings ?? this.get())
    validateIntentRoutingSettings(normalized)
    return new IntentRouter(normalized).evaluate(context)
  }
}

export function normalizeIntentRoutingSettings(raw: unknown): IntentRoutingSettings {
  const value = isRecord(raw) ? raw : {}
  return {
    ...defaultIntentRoutingSettings,
    ...value,
    minConfidenceForAutoRoute:
      typeof value.minConfidenceForAutoRoute === 'number' ? value.minConfidenceForAutoRoute : 0.62,
    maxCandidateIntents: Math.round(clampNumber(value.maxCandidateIntents, 1, 5, 3)),
    rules: Array.isArray(value.rules) ? (value.rules as IntentRule[]) : [],
    routes: Array.isArray(value.routes)
      ? (value.routes as IntentRoute[])
      : defaultIntentRoutingSettings.routes,
    promptPresets: Array.isArray(value.promptPresets) ? value.promptPresets as any : []
  }
}

export function validateIntentRoutingSettings(settings: IntentRoutingSettings): void {
  if (settings.minConfidenceForAutoRoute < 0 || settings.minConfidenceForAutoRoute > 1) {
    throw new Error('minConfidenceForAutoRoute 必须在 0-1 之间')
  }
  validateUniqueIds('rule', settings.rules.map((rule) => rule.id))
  validateUniqueIds('route', settings.routes.map((route) => route.id))
  validateUniqueIds('promptPreset', settings.promptPresets.map((preset) => preset.id))
  for (const rule of settings.rules) {
    validateId(rule.id, 'rule.id')
    validateId(rule.intentId, 'rule.intentId')
    if (rule.score < 0 || rule.score > 1) throw new Error(`规则 ${rule.id} score 越界`)
  }
  for (const route of settings.routes) {
    validateId(route.id, 'route.id')
    for (const intentId of route.intentIds) validateId(intentId, 'route.intentIds')
  }
}

function validateUniqueIds(kind: string, ids: string[]): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${kind} ID 重复: ${id}`)
    seen.add(id)
  }
}

function validateId(id: string, label: string): void {
  if (!VALID_ID.test(id)) throw new Error(`${label} 不合法: ${id}`)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
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
    name: 'intent-routing-store',
    defaults: { settings: defaultIntentRoutingSettings }
  })
}
