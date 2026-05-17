import * as assert from 'node:assert/strict'
import { KnowledgeEntry, KnowledgeStore } from './knowledge-store'

class MemoryKnowledgeBackend {
  private entries: KnowledgeEntry[] = []

  get(key: 'entries'): KnowledgeEntry[] {
    assert.equal(key, 'entries')
    return this.entries
  }

  set(key: 'entries', value: KnowledgeEntry[]): void {
    assert.equal(key, 'entries')
    this.entries = value
  }
}

function testDisabledEntriesDoNotEnterPreview(): void {
  const store = new KnowledgeStore({ backend: new MemoryKnowledgeBackend(), fragmentLimit: 10 })
  store.save({
    title: '启用条目',
    content: '价格说明',
    sourceType: 'faq',
    keywords: ['价格'],
    enabled: true
  })
  store.save({
    title: '禁用条目',
    content: '价格隐藏说明',
    sourceType: 'doc',
    keywords: ['价格'],
    enabled: false
  })

  const preview = store.preview('价格')
  assert.equal(preview.hits.length, 1)
  assert.equal(preview.hits[0].title, '启用条目')
}

function testFragmentLimitBlocksOverLimit(): void {
  const store = new KnowledgeStore({ backend: new MemoryKnowledgeBackend(), fragmentLimit: 1 })
  store.save({ title: 'A', content: '退款', sourceType: 'faq', keywords: ['退款'], enabled: true })
  store.save({ title: 'B', content: '退款', sourceType: 'doc', keywords: ['退款'], enabled: true })

  const preview = store.preview('退款', 99)
  assert.equal(preview.providerFragmentCount, 2)
  assert.equal(preview.blocked, true)
}

function testValidationAndDuplicateKeywordNormalization(): void {
  const store = new KnowledgeStore({ backend: new MemoryKnowledgeBackend() })
  const saved = store.save({
    title: '账号',
    content: '账号权限说明',
    sourceType: 'manual',
    keywords: ['账号', '账号', ' 权限 '],
    enabled: true
  })

  assert.deepEqual(saved.keywords, ['账号', '权限'])
  assert.throws(() =>
    store.save({ title: '', content: 'x', sourceType: 'manual', keywords: [], enabled: true })
  )
}

function main(): void {
  testDisabledEntriesDoNotEnterPreview()
  testFragmentLimitBlocksOverLimit()
  testValidationAndDuplicateKeywordNormalization()
  console.log('knowledge store mock tests passed')
}

main()
