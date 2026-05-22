import Store from 'electron-store'
import { DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL } from '../core/ai-client'
import { AppType, BoxRegions, CaptureStrategy } from '../core/rpa/types'
import { InstalledProviderInfo } from './provider-bundle'

const StoreClass = typeof Store === 'function' ? Store : ((Store as any).default as typeof Store)

export interface PerAppCapture {
  strategy: CaptureStrategy
  regions: BoxRegions | null
}

export interface AppSettings {
  locale: 'zh' | 'en'
  appType: AppType
  vision: {
    apiKey: string
    model: string
    baseURL: string
  }
  chatProvider: {
    manifestUrl: string
    installed: InstalledProviderInfo | null
    config: Record<string, any>
  }
  defaultCaptureStrategy: CaptureStrategy
  capture: Partial<Record<AppType, PerAppCapture>>
}

export const settingsStore = new StoreClass({
  ...(process.type ? {} : ({ projectName: 'sightflow-desktop-agent' } as any)),
  name: 'settings',
  defaults: {
    locale: 'zh',
    appType: 'wechat',
    vision: { apiKey: '', model: DEFAULT_AI_MODEL, baseURL: DEFAULT_AI_BASE_URL },
    chatProvider: {
      manifestUrl: '',
      installed: null,
      config: {}
    },
    defaultCaptureStrategy: 'auto',
    capture: {}
  }
})

const VALID_APP_TYPES: AppType[] = [
  'wechat',
  'wework',
  'dingtalk',
  'lark',
  'slack',
  'telegram',
  'generic'
]

const VALID_CAPTURE_STRATEGIES: CaptureStrategy[] = ['auto', 'vlm', 'box-select']

export function coerceAppType(raw: unknown): AppType {
  return typeof raw === 'string' && (VALID_APP_TYPES as string[]).includes(raw)
    ? (raw as AppType)
    : 'wechat'
}

export function coerceStrategy(
  raw: unknown,
  fallback: CaptureStrategy = 'auto'
): CaptureStrategy {
  return typeof raw === 'string' && (VALID_CAPTURE_STRATEGIES as string[]).includes(raw)
    ? (raw as CaptureStrategy)
    : fallback
}

function coerceRect(raw: unknown): BoxRegions['contactList'] | null {
  if (!raw || typeof raw !== 'object') return null
  const rect = raw as Record<string, unknown>
  const x = Number(rect.x)
  const y = Number(rect.y)
  const width = Number(rect.width)
  const height = Number(rect.height)
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null
  return { x, y, width, height }
}

export function coerceRegions(raw: unknown): BoxRegions | null {
  if (!raw || typeof raw !== 'object') return null
  const regions = raw as Record<string, unknown>
  const contactList = coerceRect(regions.contactList)
  const chatMain = coerceRect(regions.chatMain)
  const inputBox = coerceRect(regions.inputBox)
  if (!contactList || !chatMain || !inputBox) return null
  return {
    contactList,
    chatMain,
    inputBox,
    unreadIndicator: coerceRect(regions.unreadIndicator),
    displayId: typeof regions.displayId === 'number' ? regions.displayId : undefined,
    scaleFactor: typeof regions.scaleFactor === 'number' ? regions.scaleFactor : undefined,
    capturedAt: typeof regions.capturedAt === 'number' ? regions.capturedAt : Date.now()
  }
}

export function normalizeCapture(raw: unknown): Partial<Record<AppType, PerAppCapture>> {
  const capture: Partial<Record<AppType, PerAppCapture>> = {}
  if (!raw || typeof raw !== 'object') return capture
  for (const key of VALID_APP_TYPES) {
    const value = (raw as Record<string, unknown>)[key]
    if (!value || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    capture[key] = {
      strategy: coerceStrategy(item.strategy),
      regions: coerceRegions(item.regions)
    }
  }
  return capture
}

export function normalizeSettings(raw: any): AppSettings {
  const oldApiKey = typeof raw?.apiKey === 'string' ? raw.apiKey : ''
  const oldModel = typeof raw?.model === 'string' && raw.model ? raw.model : DEFAULT_AI_MODEL
  const oldBaseURL =
    typeof raw?.baseURL === 'string' && raw.baseURL
      ? raw.baseURL
      : typeof raw?.baseUrl === 'string' && raw.baseUrl
        ? raw.baseUrl
        : DEFAULT_AI_BASE_URL
  const oldSystemPrompt = typeof raw?.systemPrompt === 'string' ? raw.systemPrompt : ''
  const rawProviderConfig =
    raw?.chatProvider?.config && typeof raw.chatProvider.config === 'object'
      ? { ...raw.chatProvider.config }
      : {}

  if (rawProviderConfig.model === undefined && oldModel) {
    rawProviderConfig.model = oldModel
  }
  if (rawProviderConfig.baseURL === undefined && oldBaseURL) {
    rawProviderConfig.baseURL = oldBaseURL
  }
  if (rawProviderConfig.systemPrompt === undefined && oldSystemPrompt) {
    rawProviderConfig.systemPrompt = oldSystemPrompt
  }

  return {
    locale: raw?.locale === 'en' ? 'en' : 'zh',
    appType: coerceAppType(raw?.appType),
    vision: {
      apiKey: raw?.vision?.apiKey || oldApiKey || '',
      model: raw?.vision?.model || oldModel || DEFAULT_AI_MODEL,
      baseURL: raw?.vision?.baseURL || raw?.vision?.baseUrl || oldBaseURL || DEFAULT_AI_BASE_URL
    },
    chatProvider: {
      manifestUrl: raw?.chatProvider?.manifestUrl || raw?.providerManifestUrl || '',
      installed: raw?.chatProvider?.installed || null,
      config: rawProviderConfig
    },
    defaultCaptureStrategy: coerceStrategy(raw?.defaultCaptureStrategy, 'auto'),
    capture: normalizeCapture(raw?.capture)
  }
}

export function mergeSettings(current: AppSettings, data: Record<string, any>): AppSettings {
  return {
    ...current,
    ...data,
    vision: {
      ...current.vision,
      ...(data.vision || {})
    },
    chatProvider: {
      ...current.chatProvider,
      ...(data.chatProvider || {}),
      config: {
        ...current.chatProvider.config,
        ...(data.chatProvider?.config || {})
      }
    },
    capture: {
      ...current.capture,
      ...(data.capture || {})
    }
  }
}

export function withSchemaDefaults(
  schema: { properties: Record<string, { default?: unknown }> },
  current: Record<string, any>
): Record<string, any> {
  const next = { ...current }
  for (const [key, field] of Object.entries(schema.properties || {})) {
    if (next[key] === undefined && field.default !== undefined) {
      next[key] = field.default
    }
  }
  return next
}
