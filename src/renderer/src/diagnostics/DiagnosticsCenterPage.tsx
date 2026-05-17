import { useCallback, useMemo, useState } from 'react'
import type {
  DiagnosticsExportResponse,
  DiagnosticsRecordView,
  DiagnosticsSource,
  DiagnosticsTimelineNode,
  DiagnosticsQueryResponse
} from './diagnosticsTypes'

const SOURCES: DiagnosticsSource[] = [
  'runtime',
  'debug_console',
  'vision_eval',
  'workflow_preview',
  'provider_lifecycle',
  'recovery_reconciliation'
]
const SOURCE_LABELS: Record<DiagnosticsSource, string> = {
  runtime: 'runtime',
  debug_console: 'debug_console',
  vision_eval: 'vision_eval',
  workflow_preview: 'workflow_preview',
  provider_lifecycle: 'provider_lifecycle',
  recovery_reconciliation: 'recovery_reconciliation'
}

const FINAL_ACTIONS = [
  'all',
  'draft_created',
  'sent',
  'skipped',
  'blocked',
  'manual_takeover',
  'provider_error',
  'device_error'
]

export function DiagnosticsCenterPage(): React.JSX.Element {
  const [source, setSource] = useState<DiagnosticsSource>('runtime')
  const [runId, setRunId] = useState('')
  const [draftId, setDraftId] = useState('')
  const [contactHash, setContactHash] = useState('')
  const [includeRelatedSources, setIncludeRelatedSources] = useState(false)
  const [records, setRecords] = useState<DiagnosticsRecordView[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [selectedNodeKey, setSelectedNodeKey] = useState('intent')
  const [finalActionFilter, setFinalActionFilter] = useState('all')
  const [hasErrorOnly, setHasErrorOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exportMessage, setExportMessage] = useState('')

  const selectedRecord = records.find((record) => record.recordId === selectedId) || null
  const selectedNode =
    selectedRecord?.timeline.find((node) => node.capability === selectedNodeKey) ||
    selectedRecord?.timeline[0] ||
    null

  const visibleRecords = useMemo(() => {
    return records.filter((record) => {
      if (finalActionFilter !== 'all' && record.finalAction !== finalActionFilter) return false
      if (hasErrorOnly && !record.topErrorCode && !record.timeline.some((node) => node.errorCode)) return false
      return true
    })
  }, [finalActionFilter, hasErrorOnly, records])

  const stats = useMemo(() => buildStats(records), [records])

  const runQuery = useCallback(async () => {
    setLoading(true)
    setError('')
    setExportMessage('')
    try {
      const response = (await window.electron?.invoke('diagnostics:query', {
        source,
        runId: runId.trim() || undefined,
        draftId: draftId.trim() || undefined,
        contactHash: contactHash.trim() || undefined,
        includeRelatedSources,
        limit: 50
      })) as DiagnosticsQueryResponse | undefined
      if (!response) throw new Error('diagnostics IPC unavailable')
      if (!response.ok) {
        setError(response.message || response.errorCode)
        setRecords([])
        setSelectedId('')
        return
      }
      setRecords(response.records)
      setSelectedId((current) =>
        current && response.records.some((record) => record.recordId === current)
          ? current
          : response.records[0]?.recordId || ''
      )
      setSelectedNodeKey('intent')
      if (!response.records.length) setError('未找到匹配记录')
    } catch (err: any) {
      setError(err?.message || '诊断查询失败')
      setRecords([])
      setSelectedId('')
    } finally {
      setLoading(false)
    }
  }, [contactHash, draftId, includeRelatedSources, runId, source])

  const resetQuery = useCallback(() => {
    setRunId('')
    setDraftId('')
    setContactHash('')
    setRecords([])
    setSelectedId('')
    setSelectedNodeKey('intent')
    setError('')
    setExportMessage('')
  }, [])

  const exportRecord = useCallback(
    async (format: 'markdown' | 'json') => {
      if (!selectedRecord) return
      setExportMessage('')
      const response = (await window.electron?.invoke('diagnostics:exportRedacted', {
        source: selectedRecord.source,
        recordId: selectedRecord.recordId,
        format
      })) as DiagnosticsExportResponse | undefined
      if (!response) return
      setExportMessage(
        response.ok
          ? `已生成 ${response.fileName}，脱敏内容 ${response.content.length} 字符`
          : `导出被阻断：${response.blockedTypes.join(', ') || response.errorCode}`
      )
    },
    [selectedRecord]
  )

  return (
    <div className="diagnostics-page">
      <header className="diagnostics-header">
        <div>
          <h1>跨能力诊断中心</h1>
          <p>本地只读聚合 runtime、debug_console、vision_eval 与 workflow_preview 记录。</p>
        </div>
        <div className="diagnostics-chip-row">
          <span>Local only</span>
          <span>Redacted export</span>
          <span>Audit source separated</span>
        </div>
      </header>

      <section className="diagnostics-query">
        <input value={runId} onChange={(event) => setRunId(event.target.value)} placeholder="runId" />
        <input value={draftId} onChange={(event) => setDraftId(event.target.value)} placeholder="draftId" />
        <input
          value={contactHash}
          onChange={(event) => setContactHash(event.target.value)}
          placeholder="contactHash"
        />
        <label className="diagnostics-checkbox">
          <input
            type="checkbox"
            checked={includeRelatedSources}
            onChange={(event) => setIncludeRelatedSources(event.target.checked)}
          />
          包含关联 source
        </label>
        <button className="review-btn primary" onClick={() => void runQuery()} disabled={loading}>
          查询
        </button>
        <button className="review-btn secondary" onClick={resetQuery}>
          重置
        </button>
      </section>

      <div className="diagnostics-source-tabs">
        {SOURCES.map((item) => (
          <button
            key={item}
            className={`diagnostics-source-tab source-${item} ${source === item ? 'active' : ''}`}
            onClick={() => setSource(item)}
          >
            {SOURCE_LABELS[item]}
          </button>
        ))}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {!records.length && !error ? (
        <div className="diagnostics-empty">输入 runId、draftId 或 contactHash 查看诊断链路</div>
      ) : null}

      <div className="diagnostics-grid">
        <section className="diagnostics-panel diagnostics-results">
          <div className="panel-title-row">
            <h2>查询结果</h2>
            <span>{loading ? '加载中' : `${visibleRecords.length} 条`}</span>
          </div>
          <div className="diagnostics-filter-row">
            <select value={finalActionFilter} onChange={(event) => setFinalActionFilter(event.target.value)}>
              {FINAL_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {action === 'all' ? '全部 finalAction' : action}
                </option>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                checked={hasErrorOnly}
                onChange={(event) => setHasErrorOnly(event.target.checked)}
              />
              hasError
            </label>
          </div>
          <div className="diagnostics-result-list">
            {visibleRecords.map((record) => (
              <button
                key={record.recordId}
                className={`diagnostics-result-item ${selectedId === record.recordId ? 'active' : ''}`}
                onClick={() => {
                  setSelectedId(record.recordId)
                  setSelectedNodeKey(record.timeline[0]?.capability || 'intent')
                }}
              >
                <strong>{record.runId || record.draftId || record.recordId}</strong>
                <span>{record.source} · {record.appType || 'unknown app'}</span>
                <span>{shortHash(record.contactHash) || 'contactHash -'} · {record.finalAction || 'not_recorded'}</span>
                <span>{record.primaryIntentId || 'intent -'} · {record.routeAction || 'route -'}</span>
                {record.topErrorCode ? <em>{record.topErrorCode}</em> : null}
              </button>
            ))}
          </div>
        </section>

        <section className="diagnostics-panel diagnostics-timeline">
          <div className="panel-title-row">
            <h2>能力链路</h2>
            <span>{selectedRecord?.createdAt || '未选择'}</span>
          </div>
          {selectedRecord ? (
            selectedRecord.timeline.map((node) => (
              <button
                key={node.capability}
                className={`diagnostics-node ${node.status} ${selectedNodeKey === node.capability ? 'active' : ''}`}
                onClick={() => setSelectedNodeKey(node.capability)}
              >
                <span>{capabilityLabel(node.capability)}</span>
                <strong>{node.status}</strong>
                <small>{node.summary}</small>
              </button>
            ))
          ) : (
            <div className="diagnostics-empty compact">未选择记录</div>
          )}
        </section>

        <aside className="diagnostics-panel diagnostics-detail">
          <NodeDetailPanel node={selectedNode} record={selectedRecord} />
          <RedactedExportPanel
            record={selectedRecord}
            exportMessage={exportMessage}
            onExport={exportRecord}
          />
        </aside>
      </div>

      <footer className="diagnostics-stats">
        <span>finalAction: {stats.finalActions}</span>
        <span>omittedReason: {stats.omittedReasons}</span>
        <span>errorCode: {stats.errorCodes}</span>
      </footer>
    </div>
  )
}

function NodeDetailPanel({
  node,
  record
}: {
  node: DiagnosticsTimelineNode | null
  record: DiagnosticsRecordView | null
}): React.JSX.Element {
  if (!node || !record) return <div className="diagnostics-empty compact">选择节点查看白名单详情</div>
  return (
    <section className="diagnostics-detail-section">
      <div className="panel-title-row">
        <h2>{capabilityLabel(node.capability)}</h2>
        <span>{node.source}</span>
      </div>
      <dl className="diagnostics-detail-list">
        {Object.entries(node.detail).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{formatValue(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="diagnostics-redaction-box">
        <strong>敏感字段已隐藏</strong>
        <p>{record.redaction.blockedTypes.length ? record.redaction.blockedTypes.join(', ') : '无阻断类型'}</p>
        <small>omitted={record.redaction.omittedFieldPaths.length} · unknown={record.redaction.unknownFieldCount}</small>
      </div>
    </section>
  )
}

function RedactedExportPanel({
  record,
  exportMessage,
  onExport
}: {
  record: DiagnosticsRecordView | null
  exportMessage: string
  onExport: (format: 'markdown' | 'json') => void
}): React.JSX.Element {
  const blocked = !record || record.redaction.status === 'blocked' || record.redaction.unknownFieldCount > 0
  return (
    <section className="diagnostics-detail-section">
      <div className="panel-title-row">
        <h2>脱敏导出</h2>
        <span>{record?.redaction.status || 'not_ready'}</span>
      </div>
      {blocked ? <div className="diagnostics-export-blocked">导出被阻断：包含未脱敏字段</div> : null}
      <div className="diagnostics-export-actions">
        <button className="review-btn secondary" disabled={blocked} onClick={() => onExport('markdown')}>
          导出 Markdown
        </button>
        <button className="review-btn secondary" disabled={blocked} onClick={() => onExport('json')}>
          导出 JSON
        </button>
      </div>
      <button
        className="review-btn secondary"
        disabled={!record}
        onClick={() => navigator.clipboard?.writeText(record ? `${record.recordId} ${record.finalAction || ''}` : '')}
      >
        复制脱敏摘要
      </button>
      {exportMessage ? <p className="diagnostics-export-message">{exportMessage}</p> : null}
    </section>
  )
}

function buildStats(records: DiagnosticsRecordView[]): {
  finalActions: string
  omittedReasons: string
  errorCodes: string
} {
  const finalActions = new Map<string, number>()
  const omittedReasons = new Map<string, number>()
  const errorCodes = new Map<string, number>()
  for (const record of records) {
    if (record.finalAction) increment(finalActions, record.finalAction)
    if (record.topErrorCode) increment(errorCodes, record.topErrorCode)
    for (const node of record.timeline) {
      if (node.omittedReason) increment(omittedReasons, node.omittedReason)
      if (node.errorCode) increment(errorCodes, node.errorCode)
    }
  }
  return {
    finalActions: formatStats(finalActions),
    omittedReasons: formatStats(omittedReasons),
    errorCodes: formatStats(errorCodes)
  }
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) || 0) + 1)
}

function formatStats(map: Map<string, number>): string {
  return [...map.entries()].map(([key, count]) => `${key} ${count}`).join(' / ') || '-'
}

function shortHash(value?: string): string {
  if (!value) return ''
  return value.length > 12 ? `${value.slice(0, 8)}...` : value
}

function capabilityLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '-'
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
