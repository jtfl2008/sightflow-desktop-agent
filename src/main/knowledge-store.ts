import { createRequire } from 'node:module'

const nodeRequire = createRequire(__filename)

export type KnowledgeSourceType = 'manual' | 'faq' | 'doc' | 'url'

export interface KnowledgeEntry {
  id: string
  title: string
  content: string
  sourceType: KnowledgeSourceType
  keywords: string[]
  enabled: boolean
  updatedAt: string
  lastHitScore?: number
}

export interface KnowledgeHit extends KnowledgeEntry {
  score: number
  keywordHits: string[]
}

interface KnowledgeStoreBackend {
  get(key: 'entries'): KnowledgeEntry[] | undefined
  set(key: 'entries', value: KnowledgeEntry[]): void
}

export class KnowledgeStore {
  private readonly backend: KnowledgeStoreBackend
  private readonly fragmentLimit: number
  private sequence = 0

  constructor(options: { backend?: KnowledgeStoreBackend; fragmentLimit?: number } = {}) {
    this.backend =
      options.backend ??
      (createElectronStoreBackend() as unknown as KnowledgeStoreBackend)
    this.fragmentLimit = options.fragmentLimit ?? 10
  }

  list(): KnowledgeEntry[] {
    return this.readEntries()
  }

  save(input: Omit<KnowledgeEntry, 'id' | 'updatedAt'> & { id?: string }): KnowledgeEntry {
    const normalized = this.normalize(input)
    const entries = this.readEntries()
    const existingIndex = entries.findIndex((entry) => entry.id === normalized.id)
    const next =
      existingIndex === -1
        ? [...entries, normalized]
        : entries.map((entry) => (entry.id === normalized.id ? normalized : entry))
    this.backend.set('entries', next)
    return normalized
  }

  delete(id: string): void {
    this.backend.set(
      'entries',
      this.readEntries().filter((entry) => entry.id !== id)
    )
  }

  toggle(id: string, enabled: boolean): KnowledgeEntry | null {
    let updated: KnowledgeEntry | null = null
    const next = this.readEntries().map((entry) => {
      if (entry.id !== id) return entry
      updated = { ...entry, enabled, updatedAt: new Date().toISOString() }
      return updated
    })
    this.backend.set('entries', next)
    return updated
  }

  preview(query: string, limit = this.fragmentLimit): {
    hits: KnowledgeHit[]
    providerFragmentCount: number
    providerFragmentLimit: number
    blocked: boolean
  } {
    const normalizedQuery = query.toLocaleLowerCase()
    const hits = this.readEntries()
      .filter((entry) => entry.enabled)
      .map((entry) => {
        const keywordHits = entry.keywords.filter((keyword) =>
          normalizedQuery.includes(keyword.toLocaleLowerCase())
        )
        const titleHit = normalizedQuery && entry.title.toLocaleLowerCase().includes(normalizedQuery)
        const contentHit =
          normalizedQuery && entry.content.toLocaleLowerCase().includes(normalizedQuery)
        const score = Math.min(0.99, keywordHits.length * 0.25 + (titleHit ? 0.3 : 0) + (contentHit ? 0.2 : 0))
        return score > 0 ? { ...entry, score, keywordHits } : null
      })
      .filter((hit): hit is KnowledgeHit => Boolean(hit))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    const providerFragmentCount = hits.length
    return {
      hits,
      providerFragmentCount,
      providerFragmentLimit: this.fragmentLimit,
      blocked: providerFragmentCount > this.fragmentLimit
    }
  }

  private readEntries(): KnowledgeEntry[] {
    const entries = this.backend.get('entries')
    return Array.isArray(entries) ? entries : []
  }

  private normalize(input: Omit<KnowledgeEntry, 'id' | 'updatedAt'> & { id?: string }): KnowledgeEntry {
    const title = input.title.trim()
    const content = input.content.trim()
    if (!title) throw new Error('标题不能为空')
    if (!content) throw new Error('内容不能为空')
    if (!['manual', 'faq', 'doc', 'url'].includes(input.sourceType)) {
      throw new Error('sourceType 不合法')
    }
    const keywords = Array.from(new Set(input.keywords.map((item) => item.trim()).filter(Boolean)))
    if (keywords.some((keyword) => keyword.length > 32)) {
      throw new Error('关键词不能超过 32 个字符')
    }
    return {
      id: input.id || this.createId(),
      title,
      content,
      sourceType: input.sourceType,
      keywords,
      enabled: input.enabled,
      updatedAt: new Date().toISOString()
    }
  }

  private createId(): string {
    this.sequence += 1
    return `kn-${Date.now()}-${this.sequence}`
  }
}

function createElectronStoreBackend(): unknown {
  const storeModule = nodeRequire('electron-store') as {
    default?: new (options: Record<string, unknown>) => unknown
  }
  const StoreClass =
    storeModule.default ??
    (storeModule as unknown as new (options: Record<string, unknown>) => unknown)
  return new StoreClass({
    name: 'knowledge-store',
    defaults: { entries: [] }
  })
}
