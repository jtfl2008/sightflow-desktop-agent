import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { t } from './i18n'
import logoUrl from './assets/logo.png'
import './index.css'

interface LogEntry {
  time: string
  type: 'thinking' | 'reply' | 'skip' | 'error'
  content: string
}

type EngineStatus = 'idle' | 'running' | 'error'
type SettingsSection = 'base' | 'agent' | 'review' | 'knowledge' | 'intent' | 'channel'
type AppType = 'wechat' | 'wework' | 'dingtalk' | 'lark' | 'slack' | 'telegram' | 'generic'

type CaptureStrategy = 'auto' | 'vlm' | 'box-select'

interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

interface BoxRegions {
  contactList: ScreenRect
  chatMain: ScreenRect
  inputBox: ScreenRect
  header?: ScreenRect | null
  unreadIndicator: ScreenRect | null
  adapterId?: string
  adapterVersion?: string
  multiSessionEnabled?: boolean
  displayId?: number
  scaleFactor?: number
  capturedAt: number
}

const APP_TYPE_LABELS: Record<AppType, string> = {
  wechat: '微信',
  wework: '企业微信',
  dingtalk: '钉钉',
  lark: '飞书 / Lark',
  slack: 'Slack',
  telegram: 'Telegram',
  generic: '其他桌面应用'
}

const VLM_SUPPORTED_APPS: AppType[] = ['wechat', 'wework']

function isVlmSupported(appType: AppType): boolean {
  return VLM_SUPPORTED_APPS.includes(appType)
}

interface ProviderSchemaField {
  type: 'string' | 'password' | 'select' | 'boolean'
  title: string
  default?: string | boolean
  enum?: string[]
}

interface ProviderManifest {
  apiVersion: 1
  id: string
  name: string
  version: string
  entry: string
  capabilities: ['chat']
  configSchema: {
    type: 'object'
    properties: Record<string, ProviderSchemaField>
    required?: string[]
  }
}

interface InstalledProviderInfo {
  id: string
  name: string
  version: string
  entryFile: string
  installedAt: string
}

type ProviderConfigFieldType = 'text' | 'password' | 'url' | 'select' | 'textarea'

interface ProviderConfigField {
  key: string
  label: string
  type: ProviderConfigFieldType
  required?: boolean
  readonly?: boolean
  placeholder?: string
  hint?: string
  defaultValue?: string
  options?: Array<{ label: string; value: string }>
}

interface ProviderCatalogItem {
  id: string
  name: string
  description?: string
  version: string
  manifestUrl: string
  capabilities?: string[]
  configSchema: {
    fields: ProviderConfigField[]
  }
}

interface ProviderHubCache {
  sourceUrl: string
  fetchedAt: string
  providers: ProviderCatalogItem[]
}

interface ProviderHubResult {
  success: boolean
  error?: string
  catalog?: ProviderHubCache | null
}

interface PerAppCapture {
  strategy: CaptureStrategy
  regions: BoxRegions | null
}

interface AppSettings {
  locale: 'zh' | 'en'
  appType: AppType
  vision: {
    apiKey: string
  }
  chatProvider: {
    manifestUrl: string
    installed: InstalledProviderInfo | null
    config: Record<string, any>
  }
  defaultCaptureStrategy: CaptureStrategy
  capture: Partial<Record<AppType, PerAppCapture>>
}

interface ReplyDraft {
  id: string
  content: string
  appType: AppType
  screenshot: string
  status: 'pending' | 'approved' | 'skipped' | 'takeover'
  riskLabels?: string[]
  policyReasons?: string[]
  createdAt: number
  resolvedAt?: number
}

interface AuditRecord {
  id: string
  category: 'engine' | 'layout' | 'provider' | 'draft' | 'policy' | 'message' | 'error'
  action: string
  severity: 'debug' | 'info' | 'warn' | 'error'
  message?: string
  metadata: Record<string, unknown>
  occurredAt: string
}

interface KnowledgeEntry {
  id: string
  title: string
  content: string
  sourceType: 'manual' | 'faq' | 'doc' | 'url'
  keywords: string[]
  enabled: boolean
  updatedAt: string
  lastHitScore?: number
}

const BUILTIN_PROVIDER_CATALOG: ProviderCatalogItem[] = [
  {
    id: 'doubao',
    name: '豆包 Seed',
    description: '本地内置聊天 Provider，使用基础配置中的火山方舟密钥。',
    version: '1.0.0',
    manifestUrl: 'builtin://doubao',
    capabilities: ['chat'],
    configSchema: {
      fields: [
        {
          key: 'apiKey',
          label: 'API Key',
          type: 'password',
          required: true,
          placeholder: '输入火山方舟 API Key'
        },
        {
          key: 'model',
          label: '模型',
          type: 'text',
          required: true,
          readonly: true,
          defaultValue: 'doubao-seed-2-0-lite-260428'
        },
        {
          key: 'baseURL',
          label: 'Base URL',
          type: 'url',
          placeholder: 'https://ark.cn-beijing.volces.com/api/v3'
        },
        {
          key: 'systemPrompt',
          label: '系统提示词',
          type: 'textarea',
          placeholder: '你是一个微信自动回复助手。根据截图中的聊天内容，生成合适的回复...'
        }
      ]
    }
  }
]

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5.14v14l11-7-11-7z" />
  </svg>
)

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
)

const GearIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const RefreshIcon = (): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 0 1-15.1 6.6" />
    <path d="M3 12A9 9 0 0 1 18.1 5.4" />
    <path d="M18 2v4h-4" />
    <path d="M6 22v-4h4" />
  </svg>
)

function App() {
  const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings'
  const [status, setStatus] = useState<EngineStatus>('idle')

  // Sync UI status with engine state changes triggered out-of-band
  // (e.g. remote OpenClaw start/pause via the local skill HTTP server).
  useEffect(() => {
    const cleanup = window.electron?.on('engine:state', (data: { status: 'running' | 'idle' }) => {
      setStatus(data.status === 'running' ? 'running' : 'idle')
    })
    return cleanup
  }, [])

  if (isSettingsWindow) {
    return (
      <div className="app settings-window">
        <SettingsWindow />
        <Toast />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <img src={logoUrl} alt="SightFlow" className="app-logo" />
      </header>

      <div className="app-content">
        <ControlPanel status={status} setStatus={setStatus} />
      </div>

      <BottomBar status={status} setStatus={setStatus} />

      <Toast />
    </div>
  )
}

function ControlPanel({
  status,
  setStatus
}: {
  status: EngineStatus
  setStatus: (s: EngineStatus) => void
}) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  // 首屏目标应用 + 框选状态：直接读 / 写 settings，让用户上手第一步就能完成。
  const [appType, setAppType] = useState<AppType>('wechat')
  const [regions, setRegions] = useState<BoxRegions | null>(null)
  const [openingWizard, setOpeningWizard] = useState(false)

  const reloadRegionsForApp = useCallback(async (type: AppType) => {
    const r = (await window.electron?.invoke('capture:getRegions', type)) as BoxRegions | null
    setRegions(r ?? null)
  }, [])

  // 初次加载：读出当前 appType + 对应的框选区域
  useEffect(() => {
    void (async () => {
      const settings = (await window.electron?.invoke('settings:getAll')) as
        | AppSettings
        | undefined
      const initial = settings?.appType || 'wechat'
      setAppType(initial)
      await reloadRegionsForApp(initial)
    })()
  }, [reloadRegionsForApp])

  // 监听 main 进程的"区域已更新"事件——比如向导刚跑完
  useEffect(() => {
    const cleanup = window.electron?.on(
      'capture:regions-updated',
      (data: { appType: AppType; regions: BoxRegions | null }) => {
        if (data.appType === appType) setRegions(data.regions)
      }
    )
    return cleanup
  }, [appType])

  const handleAppTypeChange = useCallback(
    async (next: AppType) => {
      if (status === 'running') return
      setAppType(next)
      await window.electron?.invoke('settings:set', { appType: next })
      await window.electron?.invoke('engine:updateConfig', {
        ...((await window.electron?.invoke('settings:getAll')) as AppSettings),
        appType: next
      })
      await reloadRegionsForApp(next)
    },
    [reloadRegionsForApp, status]
  )

  const handleOpenWizard = useCallback(async () => {
    if (status === 'running') return
    setOpeningWizard(true)
    try {
      const result = (await window.electron?.invoke('capture:openSetupWizard', {
        appType
      })) as { success: boolean; reason?: string; regions?: BoxRegions } | undefined
      if (result?.success && result.regions) {
        setRegions(result.regions)
        showToast('已保存框选区域', 'success')
      } else if (result?.reason === 'cancelled' || result?.reason === 'closed') {
        showToast('框选已取消', 'error')
      } else {
        showToast('框选失败', 'error')
      }
    } finally {
      setOpeningWizard(false)
    }
  }, [appType, status])

  const addLog = useCallback((type: LogEntry['type'], content: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    setLogs((prev) => [...prev.slice(-99), { time, type, content }])
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  useEffect(() => {
    const cleanup = window.electron?.on('engine:log', (data: { type: string; content: string }) => {
      addLog(data.type as LogEntry['type'], data.content)

      if (data.type === 'error' && data.content.includes('引擎无法启动')) {
        setStatus('error')
      }
    })
    return cleanup
  }, [addLog, setStatus])

  const statusLabel =
    status === 'running'
      ? t('status.running')
      : status === 'error'
        ? t('status.error')
        : t('status.idle')

  const isVlm = isVlmSupported(appType)
  const captureReady = isVlm || regions !== null

  return (
    <div className="fade-in">
      <div className={`status-indicator ${status}`}>
        <div className={`status-dot ${status}`} />
        <span className="status-text">{statusLabel}</span>
      </div>

      <TargetAppQuickCard
        appType={appType}
        regions={regions}
        captureReady={captureReady}
        isVlm={isVlm}
        openingWizard={openingWizard}
        running={status === 'running'}
        onAppTypeChange={handleAppTypeChange}
        onOpenWizard={handleOpenWizard}
      />

      <div className="card">
        <div className="card-title">{t('control.log')}</div>
        <div className="message-log" ref={logRef}>
          {logs.length === 0 ? (
            <div className="message-log-empty">{t('control.log.empty')}</div>
          ) : (
            logs.map((entry, i) => (
              <div className="log-entry" key={i}>
                <span className="log-time">{entry.time}</span>
                <span className={`log-type ${entry.type}`}>
                  {t(`control.log.${entry.type}` as never)}
                </span>
                <span>{entry.content}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

interface TargetAppQuickCardProps {
  appType: AppType
  regions: BoxRegions | null
  captureReady: boolean
  isVlm: boolean
  openingWizard: boolean
  running: boolean
  onAppTypeChange: (t: AppType) => void
  onOpenWizard: () => void
}

// 首屏的"目标应用 + 框选"快捷卡片：让新用户开箱即用，不用先翻设置。
function TargetAppQuickCard({
  appType,
  regions,
  captureReady,
  isVlm,
  openingWizard,
  running,
  onAppTypeChange,
  onOpenWizard
}: TargetAppQuickCardProps): React.JSX.Element {
  const statusText = isVlm
    ? '自动识别（VLM）'
    : regions
      ? '已框选 3 / 3 个区域'
      : '尚未框选'

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-title">目标应用</div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <select
          className="form-input"
          value={appType}
          onChange={(e) => onAppTypeChange(e.target.value as AppType)}
          disabled={running || openingWizard}
          style={{ flex: 1 }}
        >
          {(Object.keys(APP_TYPE_LABELS) as AppType[]).map((type) => (
            <option key={type} value={type}>
              {APP_TYPE_LABELS[type]}
              {!isVlmSupported(type) ? '（框选）' : ''}
            </option>
          ))}
        </select>

        {!isVlm && (
          <button
            className="btn btn-primary"
            onClick={onOpenWizard}
            disabled={running || openingWizard}
            style={{
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {regions ? (
                // 重新框选 — 旋转刷新图标
                <>
                  <path d="M21 12a9 9 0 1 1-3-6.7" />
                  <path d="M21 4v5h-5" />
                </>
              ) : (
                // 开始框选 — 矩形 + 十字
                <>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </>
              )}
            </svg>
            {openingWizard ? '打开中...' : regions ? '重新框选' : '开始框选'}
          </button>
        )}
      </div>

      <div
        className="form-hint"
        style={{
          marginTop: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: captureReady ? '#94a3b8' : '#fbbf24'
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: 999,
            background: captureReady ? '#34d399' : '#fbbf24'
          }}
        />
        {statusText}
        {!isVlm && !regions ? '：点右侧按钮先把 3 个关键区域圈出来' : ''}
      </div>
    </div>
  )
}

function BottomBar({
  status,
  setStatus
}: {
  status: EngineStatus
  setStatus: (s: EngineStatus) => void
}) {
  const handleStart = useCallback(async () => {
    const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings | undefined
    if (!settings?.vision?.apiKey) {
      showToast(t('control.start.novisionkey'), 'error')
      return
    }
    // 没装自定义 provider → 走内置 doubao（getInstalled 会返回 isBuiltinDefault: true）
    const providerInfo = (await window.electron?.invoke('provider:getInstalled')) as {
      manifest: ProviderManifest | null
      isBuiltinDefault?: boolean
    }
    // doubao 默认共享视觉密钥，required 已剥离 apiKey
    const required = providerInfo?.manifest?.configSchema?.required || []
    const missing = required.find((key) => {
      const value = settings.chatProvider.config?.[key]
      return value === undefined || value === null || value === ''
    })
    if (missing) {
      showToast(`${t('control.start.missingProviderField')}: ${missing}`, 'error')
      return
    }

    const result = await window.electron?.invoke('engine:start', settings)
    if (result?.success) {
      setStatus('running')
      showToast(t('toast.engineStarted'), 'success')
    } else {
      setStatus('error')
      showToast(result?.error || t('toast.startFailed'), 'error')
    }
  }, [setStatus])

  const handleStop = useCallback(async () => {
    await window.electron?.invoke('engine:stop')
    setStatus('idle')
    showToast(t('toast.engineStopped'), 'success')
  }, [setStatus])

  const running = status === 'running'

  return (
    <div className="bottom-bar">
      {running ? (
        <button className="bottom-btn bottom-btn-stop" onClick={handleStop}>
          <StopIcon />
          {t('control.stop')}
        </button>
      ) : (
        <button className="bottom-btn bottom-btn-play" onClick={handleStart}>
          <PlayIcon />
          {t('control.start')}
        </button>
      )}
      <button
        className="bottom-btn bottom-btn-settings"
        onClick={() => window.electron?.invoke('settings:open')}
        title="设置"
      >
        <GearIcon />
      </button>
    </div>
  )
}

function SettingsWindow(): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>('base')

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-brand">
          <img src={logoUrl} alt="SightFlow" className="app-logo" />
          <span>设置</span>
        </div>
        <button
          className={`settings-nav-item ${section === 'base' ? 'active' : ''}`}
          onClick={() => setSection('base')}
        >
          基础配置
        </button>
        <button
          className={`settings-nav-item ${section === 'agent' ? 'active' : ''}`}
          onClick={() => setSection('agent')}
        >
          智能体
        </button>
        <button
          className={`settings-nav-item ${section === 'review' ? 'active' : ''}`}
          onClick={() => setSection('review')}
        >
          草稿审核
        </button>
        <button
          className={`settings-nav-item ${section === 'knowledge' ? 'active' : ''}`}
          onClick={() => setSection('knowledge')}
        >
          知识库
        </button>
        <button
          className={`settings-nav-item ${section === 'intent' ? 'active' : ''}`}
          onClick={() => setSection('intent')}
        >
          意图路由
        </button>
        <button
          className={`settings-nav-item ${section === 'channel' ? 'active' : ''}`}
          onClick={() => setSection('channel')}
        >
          渠道适配
        </button>
      </aside>

      <main className="settings-main">
        {section === 'base' ? (
          <SettingsPanel />
        ) : section === 'agent' ? (
          <AgentPanel />
        ) : section === 'review' ? (
          <DraftAuditDashboard />
        ) : section === 'knowledge' ? (
          <KnowledgeSettingsPage />
        ) : section === 'intent' ? (
          <IntentRoutingSettingsPage />
        ) : (
          <ChannelAdapterSettingsPage />
        )}
      </main>
    </div>
  )
}

const SAMPLE_DRAFTS: ReplyDraft[] = [
  {
    id: 'A129',
    content:
      '您好！请先检查一下垃圾邮件箱，重置邮件可能被误判为垃圾邮件。如果仍未收到，可以等待 5 分钟后重试。',
    appType: 'generic',
    screenshot: '',
    status: 'pending',
    riskLabels: ['敏感度 低', '命中知识 3 条'],
    policyReasons: ['账号相关问题需要人工审核'],
    createdAt: Date.now() - 1000 * 60 * 12
  },
  {
    id: 'A130',
    content: '我可以帮您核对订单状态，请提供订单号。',
    appType: 'generic',
    screenshot: '',
    status: 'pending',
    riskLabels: ['置信度 0.65'],
    createdAt: Date.now() - 1000 * 60 * 22
  }
]

function DraftAuditDashboard(): React.JSX.Element {
  const [drafts, setDrafts] = useState<ReplyDraft[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([])
  const [draftText, setDraftText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const selectedDraft = drafts.find((draft) => draft.id === selectedId) || drafts[0] || null

  const loadReviewData = useCallback(async () => {
    const [runtimeDrafts, records] = await Promise.all([
      window.electron?.invoke('review:listDrafts') as Promise<ReplyDraft[] | undefined>,
      window.electron?.invoke('audit:list', 50) as Promise<AuditRecord[] | undefined>
    ])
    const nextDrafts = runtimeDrafts?.length ? runtimeDrafts : SAMPLE_DRAFTS
    setDrafts(nextDrafts)
    setAuditRecords(records || [])
    setSelectedId((current) => current || nextDrafts[0]?.id || '')
  }, [])

  useEffect(() => {
    void loadReviewData()
  }, [loadReviewData])

  useEffect(() => {
    setDraftText(selectedDraft?.content || '')
    setError('')
  }, [selectedDraft])

  const completeDraft = useCallback(
    async (action: 'approve' | 'skip' | 'takeover', content?: string) => {
      if (!selectedDraft) return
      setSending(true)
      setError('')
      try {
        const channel =
          action === 'approve'
            ? 'review:approveDraft'
            : action === 'skip'
              ? 'review:skipDraft'
              : 'review:takeoverDraft'
        const payload = action === 'approve' ? { draftId: selectedDraft.id, content } : selectedDraft.id
        const result = await window.electron?.invoke(channel, payload)
        if (result?.success === false) {
          setError(result.error || '发送失败：网络超时，可重试或接管')
          return
        }
        setDrafts((items) =>
          items.map((item) =>
            item.id === selectedDraft.id
              ? {
                  ...item,
                  content: content || item.content,
                  status:
                    action === 'approve' ? 'approved' : action === 'skip' ? 'skipped' : 'takeover',
                  resolvedAt: Date.now()
                }
              : item
          )
        )
        await loadReviewData()
      } catch (err: any) {
        setError(`发送失败：${err?.message || '网络超时'}，可重试或接管`)
      } finally {
        setSending(false)
      }
    },
    [loadReviewData, selectedDraft]
  )

  return (
    <div className="draft-dashboard">
      <header className="draft-header">
        <div>
          <h1>草稿审核与审计</h1>
          <p>人工审核 Provider 生成的回复草稿，跟踪策略、发送和错误审计。</p>
        </div>
        <div className="draft-header-actions">
          <StatusChip label="生产环境" tone="info" />
          <StatusChip label={`错误队列 ${auditRecords.filter((r) => r.severity === 'error').length}`} tone="danger" />
        </div>
      </header>

      <div className="draft-grid">
        <DraftQueue drafts={drafts} selectedId={selectedDraft?.id || ''} onSelect={setSelectedId} />
        <DraftReviewPanel
          draft={selectedDraft}
          value={draftText}
          error={error}
          sending={sending}
          onChange={setDraftText}
          onApprove={() => completeDraft('approve')}
          onEditSend={() => completeDraft('approve', draftText)}
          onSkip={() => completeDraft('skip')}
          onTakeover={() => completeDraft('takeover')}
        />
        <SessionStatusPanel draft={selectedDraft} auditRecords={auditRecords} />
      </div>

      <AuditTable records={auditRecords} />
    </div>
  )
}

function DraftQueue({
  drafts,
  selectedId,
  onSelect
}: {
  drafts: ReplyDraft[]
  selectedId: string
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <section className="draft-panel draft-queue">
      <div className="panel-title-row">
        <h2>待审核草稿 ({drafts.filter((draft) => draft.status === 'pending').length})</h2>
        <button className="icon-action" title="刷新">↻</button>
      </div>
      {drafts.length ? (
        drafts.map((draft) => (
          <button
            key={draft.id}
            className={`draft-item ${draft.id === selectedId ? 'active' : ''}`}
            onClick={() => onSelect(draft.id)}
          >
            <span className="draft-item-title">会话 #{draft.id}</span>
            <StatusChip label={statusLabel(draft.status)} tone={statusTone(draft.status)} />
            <span className="draft-meta">来源：{APP_TYPE_LABELS[draft.appType] || 'Web 客服'}</span>
            <span className="draft-preview">{draft.content}</span>
          </button>
        ))
      ) : (
        <EmptyState label="暂无待审核草稿" />
      )}
    </section>
  )
}

function DraftReviewPanel({
  draft,
  value,
  error,
  sending,
  onChange,
  onApprove,
  onEditSend,
  onSkip,
  onTakeover
}: {
  draft: ReplyDraft | null
  value: string
  error: string
  sending: boolean
  onChange: (value: string) => void
  onApprove: () => void
  onEditSend: () => void
  onSkip: () => void
  onTakeover: () => void
}): React.JSX.Element {
  if (!draft) return <EmptyState label="暂无待审核草稿" />
  return (
    <section className="draft-panel review-panel">
      <div className="review-heading">
        <div>
          <h2>会话 #{draft.id}</h2>
          <p>创建时间：{formatTime(draft.createdAt)} · 来源：{APP_TYPE_LABELS[draft.appType]}</p>
        </div>
        <StatusChip label={statusLabel(draft.status)} tone={statusTone(draft.status)} />
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      <div className="user-message">如何重置我的账户密码？我收不到重置邮件。</div>
      <label className="draft-editor-label">AI 回复草稿（预览）</label>
      <textarea className="draft-editor" value={value} onChange={(event) => onChange(event.target.value)} />
      <div className="risk-row">
        {(draft.riskLabels?.length ? draft.riskLabels : ['置信度 0.78']).map((label) => (
          <StatusChip key={label} label={label} tone="info" />
        ))}
      </div>
      <div className="review-actions">
        <button className="review-btn primary" disabled={sending} onClick={onApprove}>批准发送</button>
        <button className="review-btn secondary" disabled={sending} onClick={onEditSend}>编辑后发送</button>
        <button className="review-btn neutral" disabled={sending} onClick={onSkip}>跳过</button>
        <button className="review-btn danger" disabled={sending} onClick={onTakeover}>接管会话</button>
      </div>
    </section>
  )
}

function SessionStatusPanel({
  draft,
  auditRecords
}: {
  draft: ReplyDraft | null
  auditRecords: AuditRecord[]
}): React.JSX.Element {
  return (
    <section className="draft-panel status-panel">
      <h2>审核与状态</h2>
      <dl className="status-list">
        <dt>当前状态</dt>
        <dd>{draft ? <StatusChip label={statusLabel(draft.status)} tone={statusTone(draft.status)} /> : '-'}</dd>
        <dt>会话 ID</dt>
        <dd>{draft?.id || '-'}</dd>
        <dt>优先级</dt>
        <dd>中</dd>
        <dt>SLA 剩余</dt>
        <dd className="danger-text">2 小时 15 分钟</dd>
      </dl>
      <h3>最近审计</h3>
      <div className="audit-mini-list">
        {auditRecords.slice(0, 5).map((record) => (
          <div key={record.id} className="audit-mini-item">
            <StatusChip label={record.category} tone={record.severity === 'error' ? 'danger' : 'info'} />
            <span>{record.message || record.action}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function AuditTable({ records }: { records: AuditRecord[] }): React.JSX.Element {
  const rows = records.length ? records : []
  return (
    <section className="draft-panel audit-table-panel">
      <div className="audit-filter-bar">
        <h2>审计记录</h2>
        <input className="audit-search" placeholder="搜索会话或操作者" />
        <button className="review-btn secondary">查询</button>
      </div>
      {rows.length ? (
        <table className="audit-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作者</th>
              <th>会话</th>
              <th>操作</th>
              <th>结果</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map((record) => (
              <tr key={record.id}>
                <td>{formatTime(record.occurredAt)}</td>
                <td>系统</td>
                <td>{String(record.metadata?.draftId || record.metadata?.appType || '-')}</td>
                <td>{record.action}</td>
                <td><StatusChip label={record.severity === 'error' ? '发送失败' : '已记录'} tone={record.severity === 'error' ? 'danger' : 'success'} /></td>
                <td>{record.message || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState label="暂无审计记录" />
      )}
    </section>
  )
}

function ErrorBanner({ message }: { message: string }): React.JSX.Element {
  return <div className="error-banner">发送失败：{message.replace(/^发送失败：/, '')}</div>
}

function EmptyState({ label }: { label: string }): React.JSX.Element {
  return <div className="empty-state"><span>▱</span>{label}</div>
}

function StatusChip({ label, tone }: { label: string; tone: 'info' | 'success' | 'warning' | 'danger' }): React.JSX.Element {
  return <span className={`status-chip ${tone}`}>{label}</span>
}

function statusLabel(status: ReplyDraft['status']): string {
  return status === 'approved' ? '已批准' : status === 'skipped' ? '已跳过' : status === 'takeover' ? '已接管' : '待人工审核'
}

function statusTone(status: ReplyDraft['status']): 'info' | 'success' | 'warning' | 'danger' {
  return status === 'approved' ? 'success' : status === 'takeover' ? 'danger' : status === 'skipped' ? 'warning' : 'info'
}

function formatTime(value: string | number): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

const EMPTY_KNOWLEDGE: KnowledgeEntry = {
  id: '',
  title: '',
  content: '',
  sourceType: 'manual',
  keywords: [],
  enabled: true,
  updatedAt: ''
}

function KnowledgeSettingsPage(): React.JSX.Element {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<KnowledgeEntry>(EMPTY_KNOWLEDGE)
  const [query, setQuery] = useState('')
  const [sourceType, setSourceType] = useState<'all' | KnowledgeEntry['sourceType']>('all')
  const [enabledOnly, setEnabledOnly] = useState(false)
  const [preview, setPreview] = useState<any>({ hits: [], providerFragmentCount: 0, providerFragmentLimit: 10 })
  const [error, setError] = useState('')
  const selected = entries.find((entry) => entry.id === selectedId) || null
  const visibleEntries = entries.filter(
    (entry) =>
      (!enabledOnly || entry.enabled) &&
      (sourceType === 'all' || entry.sourceType === sourceType) &&
      (!query ||
        `${entry.title} ${entry.content} ${entry.keywords.join(' ')}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()))
  )
  const enabledCount = entries.filter((entry) => entry.enabled).length

  const loadKnowledge = useCallback(async () => {
    const list = ((await window.electron?.invoke('knowledge:list')) || []) as KnowledgeEntry[]
    setEntries(list)
    const first = list[0]
    setSelectedId((current) => current || first?.id || '')
    setDraft(first || EMPTY_KNOWLEDGE)
  }, [])

  useEffect(() => {
    void loadKnowledge()
  }, [loadKnowledge])

  useEffect(() => {
    if (selected) setDraft(selected)
  }, [selected])

  useEffect(() => {
    void (async () => {
      const result = await window.electron?.invoke('knowledge:preview', query || draft.keywords.join(' '))
      setPreview(result || { hits: [], providerFragmentCount: 0, providerFragmentLimit: 10 })
    })()
  }, [draft.keywords, query])

  const startCreate = useCallback(() => {
    setSelectedId('')
    setDraft({ ...EMPTY_KNOWLEDGE, id: '' })
    setError('')
  }, [])

  const saveKnowledge = useCallback(async () => {
    if (preview.blocked) {
      setError('已超过片段上限，请减少启用条目或关键词范围')
      return
    }
    const result = await window.electron?.invoke('knowledge:save', draft)
    if (!result?.success) {
      setError(`错误：${result?.error || '保存失败，请重试'}`)
      return
    }
    setError('')
    await loadKnowledge()
    setSelectedId(result.entry.id)
  }, [draft, loadKnowledge, preview.blocked])

  const toggleKnowledge = useCallback(
    async (entry: KnowledgeEntry) => {
      const previous = entries
      setEntries((items) =>
        items.map((item) => (item.id === entry.id ? { ...item, enabled: !item.enabled } : item))
      )
      const result = await window.electron?.invoke('knowledge:toggle', {
        id: entry.id,
        enabled: !entry.enabled
      })
      if (!result?.success) {
        setEntries(previous)
        setError('错误：保存失败，请重试')
      }
    },
    [entries]
  )

  const keywordText = draft.keywords.join(', ')

  return (
    <div className="draft-dashboard knowledge-page">
      <header className="draft-header">
        <div>
          <h1>知识库设置</h1>
          <p>维护轻量知识条目，预览 ProviderInput 检索命中与片段预算。</p>
        </div>
        <div className="draft-header-actions">
          <StatusChip label={`已启用条目 ${enabledCount}`} tone="success" />
          <StatusChip label={`ProviderInput 当前 ${preview.providerFragmentCount || 0}/${preview.providerFragmentLimit || 10}`} tone={preview.blocked ? 'danger' : 'info'} />
          <button className="review-btn primary" onClick={startCreate}>新增知识</button>
        </div>
      </header>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="knowledge-grid">
        <section className="draft-panel knowledge-list">
          <div className="knowledge-toolbar">
            <select value={sourceType} onChange={(event) => setSourceType(event.target.value as any)}>
              <option value="all">全部状态</option>
              <option value="manual">manual</option>
              <option value="faq">faq</option>
              <option value="doc">doc</option>
              <option value="url">url</option>
            </select>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题/关键词" />
            <label><input type="checkbox" checked={enabledOnly} onChange={(event) => setEnabledOnly(event.target.checked)} /> 启用</label>
          </div>
          {visibleEntries.length ? (
            visibleEntries.map((entry) => (
              <button key={entry.id} className={`knowledge-row ${entry.id === selectedId ? 'active' : ''} ${entry.enabled ? '' : 'muted'}`} onClick={() => setSelectedId(entry.id)}>
                <strong>{entry.title}</strong>
                <StatusChip label={entry.sourceType.toUpperCase()} tone="info" />
                <span>{entry.keywords.slice(0, 3).join('、') || '无关键词'}</span>
                <button type="button" className="switch-btn" onClick={(event) => { event.stopPropagation(); void toggleKnowledge(entry) }}>{entry.enabled ? '启用' : '停用'}</button>
              </button>
            ))
          ) : (
            <EmptyState label="暂无知识条目" />
          )}
        </section>

        <section className="draft-panel knowledge-editor">
          <h2>{draft.id ? '编辑知识' : '新增知识'}</h2>
          <label>标题 *</label>
          <input value={draft.title} maxLength={100} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          <label>内容 *</label>
          <textarea value={draft.content} maxLength={5000} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
          <label>sourceType *</label>
          <select value={draft.sourceType} onChange={(event) => setDraft({ ...draft, sourceType: event.target.value as KnowledgeEntry['sourceType'] })}>
            <option value="manual">manual</option>
            <option value="faq">faq</option>
            <option value="doc">doc</option>
            <option value="url">url</option>
          </select>
          <label>关键词 *</label>
          <input value={keywordText} onChange={(event) => setDraft({ ...draft, keywords: event.target.value.split(/[,，\\n]/).map((item) => item.trim()).filter(Boolean) })} placeholder="Enter 或逗号分隔" />
          <label className="knowledge-enabled"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> 启用知识条目</label>
          <div className="review-actions">
            <button className="review-btn neutral" onClick={() => setDraft(selected || EMPTY_KNOWLEDGE)}>取消</button>
            <button className="review-btn primary" disabled={!draft.title.trim() || !draft.content.trim() || preview.blocked} onClick={saveKnowledge}>保存</button>
          </div>
        </section>

        <section className="draft-panel knowledge-preview">
          <h2>检索命中预览</h2>
          {preview.hits?.length ? (
            preview.hits.map((hit: any) => (
              <div key={hit.id} className="hit-card">
                <StatusChip label={String(hit.score.toFixed(2))} tone={hit.score >= 0.8 ? 'success' : 'warning'} />
                <strong>{hit.title}</strong>
                <p>{hit.content}</p>
                <span>匹配关键词：{hit.keywordHits?.join('、') || '-'}</span>
              </div>
            ))
          ) : (
            <EmptyState label="暂无检索命中" />
          )}
          <div className={`budget-box ${preview.blocked ? 'blocked' : preview.providerFragmentCount / preview.providerFragmentLimit >= 0.8 ? 'warning' : ''}`}>
            <h3>ProviderInput 片段上限</h3>
            <strong>当前 {preview.providerFragmentCount || 0}/{preview.providerFragmentLimit || 10}</strong>
            <p>{preview.blocked ? '已超过片段上限，请减少启用条目或关键词范围' : '当前检索片段接近上限时，建议优化关键词。'}</p>
          </div>
        </section>
      </div>
    </div>
  )
}

function IntentRoutingSettingsPage(): React.JSX.Element {
  const [settings, setSettings] = useState<any | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [sample, setSample] = useState('请问价格是多少？')
  const [preview, setPreview] = useState<any | null>(null)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const rules = settings?.rules || []
  const selectedRule = rules.find((rule: any) => rule.id === selectedId) || rules[0]

  const loadIntentSettings = useCallback(async () => {
    const next = await window.electron?.invoke('intentRouting:get')
    const withSample =
      next?.rules?.length
        ? next
        : {
            ...next,
            enabled: true,
            rules: [
              {
                id: 'pricing_rule',
                enabled: true,
                priority: 1,
                intentId: 'pricing_inquiry',
                label: '咨询',
                score: 0.72,
                conditions: [{ type: 'keyword', keywords: ['价格', '费用'], match: 'any' }]
              },
              {
                id: 'complaint_rule',
                enabled: true,
                priority: 2,
                intentId: 'complaint',
                label: '投诉',
                score: 0.78,
                conditions: [{ type: 'keyword', keywords: ['投诉', '不满'], match: 'any' }]
              },
              {
                id: 'risk_rule',
                enabled: true,
                priority: 0,
                intentId: 'sensitive_action',
                label: '高风险',
                score: 0.9,
                conditions: [{ type: 'keyword', keywords: ['密码', '转账'], match: 'any' }]
              }
            ],
            routes: [
              { id: 'pricing_route', enabled: true, priority: 1, intentIds: ['pricing_inquiry'], label: '咨询回复', action: 'run_provider', promptPresetId: 'sales' },
              { id: 'risk_blocked', enabled: true, priority: 0, intentIds: ['sensitive_action'], label: '高风险阻断', action: 'blocked' },
              { id: 'fallback_review', enabled: true, priority: 999, intentIds: ['unknown'], label: '低置信人工确认', action: 'run_provider_requires_review', forcedReplyMode: 'draft_review' }
            ],
            promptPresets: [{ id: 'sales', label: '销售模板', systemHint: '优先使用价格知识', enabled: true }]
          }
    setSettings(withSample)
    setSelectedId(withSample.rules?.[0]?.id || '')
  }, [])

  useEffect(() => {
    void loadIntentSettings()
  }, [loadIntentSettings])

  useEffect(() => {
    if (!settings) return
    void (async () => {
      const result = await window.electron?.invoke('intentRouting:preview', {
        settings,
        context: {
          appType: 'wechat',
          routeTestText: sample,
          ocrText: sample,
          knowledgeSnippets: [],
          replyMode: 'auto_send',
          now: Date.now()
        }
      })
      setPreview(result?.result || null)
    })()
  }, [sample, settings])

  const updateRule = useCallback(
    (patch: Record<string, unknown>) => {
      setDirty(true)
      setSettings((current: any) => ({
        ...current,
        rules: current.rules.map((rule: any) => (rule.id === selectedRule.id ? { ...rule, ...patch } : rule))
      }))
    },
    [selectedRule]
  )

  const saveIntentSettings = useCallback(async () => {
    const result = await window.electron?.invoke('intentRouting:save', settings)
    if (!result?.success) {
      setError(`保存失败，请重试：${result?.error || ''}`)
      return
    }
    setError('')
    setDirty(false)
    setSettings(result.settings)
  }, [settings])

  if (!settings) return <EmptyState label="意图路由加载中" />

  return (
    <div className="draft-dashboard intent-page">
      <header className="draft-header">
        <div>
          <h1>意图路由与安全策略</h1>
          <p>配置意图标签、置信度阈值、Prompt 模板、知识范围与强制审核策略。</p>
        </div>
        <div className="draft-header-actions">
          <StatusChip label={settings.enabled ? '运行中' : '已停用'} tone={settings.enabled ? 'success' : 'warning'} />
          <StatusChip label={dirty ? '未保存' : '已保存'} tone={dirty ? 'warning' : 'success'} />
          <button className="review-btn primary" onClick={saveIntentSettings}>保存</button>
        </div>
      </header>
      {error ? <ErrorBanner message={error} /> : null}
      <div className="intent-grid">
        <section className="draft-panel intent-list">
          <h2>意图标签</h2>
          <label className="knowledge-enabled"><input type="checkbox" checked={settings.enabled} onChange={(event) => { setDirty(true); setSettings({ ...settings, enabled: event.target.checked }) }} /> 启用路由</label>
          {rules.map((rule: any) => (
            <button key={rule.id} className={`knowledge-row ${rule.id === selectedRule?.id ? 'active' : ''} ${rule.enabled ? '' : 'muted'}`} onClick={() => setSelectedId(rule.id)}>
              <strong>{rule.label}</strong>
              <StatusChip label={`置信度 ${Math.round(rule.score * 100)}%`} tone={rule.score < settings.minConfidenceForAutoRoute ? 'warning' : 'info'} />
              <span>{rule.intentId}</span>
            </button>
          ))}
        </section>
        <section className="draft-panel knowledge-editor">
          <h2>策略编辑</h2>
          <label>意图标签</label>
          <input value={selectedRule?.label || ''} onChange={(event) => updateRule({ label: event.target.value })} />
          <label>置信度阈值</label>
          <input type="range" min="0" max="1" step="0.01" value={selectedRule?.score || 0} onChange={(event) => updateRule({ score: Number(event.target.value) })} />
          <label>Prompt 模板</label>
          <select value={settings.routes?.[0]?.promptPresetId || ''} onChange={() => setDirty(true)}>
            <option value="sales">销售模板</option>
            <option value="">默认模板</option>
          </select>
          <label>知识范围</label>
          <select onChange={() => setDirty(true)}>
            <option>全部知识</option>
            <option>FAQ</option>
            <option>文档</option>
          </select>
          <label className="knowledge-enabled"><input type="checkbox" checked={selectedRule?.intentId === 'sensitive_action'} onChange={() => setDirty(true)} /> 强制审核</label>
          <div className="error-banner">低置信：需人工确认</div>
        </section>
        <section className="draft-panel intent-preview">
          <h2>路由预览</h2>
          <textarea className="draft-editor" value={sample} onChange={(event) => setSample(event.target.value)} />
          <div className="preview-result">
            <StatusChip label={preview?.intent?.primaryIntentId || 'unknown'} tone={preview?.intent?.fallbackUsed ? 'warning' : 'info'} />
            <strong>置信度 {Math.round((preview?.intent?.confidence || 0) * 100)}%</strong>
            <p>Route: {preview?.route?.label || '-'}</p>
            <p>Action: {preview?.route?.action || '-'}</p>
          </div>
          {preview?.intent?.fallbackUsed ? <div className="error-banner">低置信：需人工确认</div> : null}
          {preview?.route?.action === 'blocked' ? <div className="error-banner">审核必需：高风险路由已阻断</div> : null}
        </section>
      </div>
      <section className="draft-panel audit-table-panel">
        <div className="audit-filter-bar">
          <h2>审计记录</h2>
          <input className="audit-search" placeholder="过滤 intent/route/matchedKnowledge" />
          <button className="review-btn secondary">查询</button>
        </div>
        <EmptyState label="暂无审计记录" />
      </section>
    </div>
  )
}

function ChannelAdapterSettingsPage(): React.JSX.Element {
  const [appType, setAppType] = useState<AppType>('lark')
  const [settings, setSettings] = useState<any | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      const next = await window.electron?.invoke('channelAdapter:get', appType)
      setSettings(next)
    })()
  }, [appType])

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      const result = await window.electron?.invoke('channelAdapter:save', {
        ...settings,
        ...patch,
        appType
      })
      if (!result?.success) {
        setError(result?.error || 'invalid adapter')
        return
      }
      setError('')
      setSettings(result.settings)
    },
    [appType, settings]
  )

  const openAdapterWizard = useCallback(async () => {
    const result = (await window.electron?.invoke('capture:openSetupWizard', {
      appType,
      steps: ['header', 'unreadIndicator']
    })) as { success?: boolean; regions?: BoxRegions; reason?: string } | undefined
    if (!result?.success) {
      setError(result?.reason || '框选向导已取消')
      return
    }
    setError('')
    await save({
      headerConfigured: Boolean(result.regions?.header),
      unreadIndicatorConfigured: Boolean(result.regions?.unreadIndicator)
    })
  }, [appType, save])

  if (!settings) return <EmptyState label="渠道适配加载中" />

  return (
    <div className="draft-dashboard channel-page">
      <header className="draft-header">
        <div>
          <h1>多会话适配包</h1>
          <p>默认单会话，不改变默认三框模式；多会话必须显式确认启用。</p>
        </div>
        <div className="draft-header-actions">
          <StatusChip label={APP_TYPE_LABELS[appType]} tone="info" />
          <StatusChip label={settings.safetyMode === 'draft_review_only' ? '仅允许草稿审核' : settings.runtimeMode === 'multi_session' ? '完整多会话' : '默认单会话'} tone={settings.runtimeMode === 'multi_session' ? 'success' : 'warning'} />
        </div>
      </header>
      {error ? <ErrorBanner message={error} /> : null}
      <div className="channel-grid">
        <section className="draft-panel">
          <h2>应用 / 渠道</h2>
          <select className="audit-search" value={appType} onChange={(event) => setAppType(event.target.value as AppType)}>
            {(['dingtalk', 'lark', 'slack', 'telegram', 'generic'] as AppType[]).map((item) => (
              <option key={item} value={item}>{APP_TYPE_LABELS[item]}</option>
            ))}
          </select>
          <div className="adapter-card">
            <strong>{settings.manifestId || '未安装适配包'}</strong>
            <p>capabilities: {(settings.capabilities || ['single_session']).join(', ')}</p>
            <button className="review-btn secondary" onClick={() => save({ enabled: true, manifestId: `${appType}-adapter`, version: '1.0.0', capabilities: ['single_session', 'multi_session_unread_scan'] })}>安装示例适配包</button>
          </div>
        </section>
        <section className="draft-panel">
          <h2>渠道适配设置</h2>
          <div className="state-card"><strong>默认单会话</strong><p>仅监听当前打开会话；不改变默认三框模式。</p></div>
          <div className="state-card"><strong>已安装未启用</strong><p>启用前不会自动点击联系人列表。</p></div>
          <div className="state-card warning"><strong>缺少 header</strong><p>仅允许草稿审核，不允许自动发送。</p></div>
          <div className="state-card success"><strong>完整多会话</strong><p>header 与 unreadIndicator 配置完整后允许安全切换。</p></div>
          <label className="knowledge-enabled">
            <input
              type="checkbox"
              checked={settings.multiSessionEnabled}
              onChange={(event) => {
                if (event.target.checked && !confirming) {
                  setConfirming(true)
                  return
                }
                void save({ enabled: true, multiSessionEnabled: event.target.checked })
              }}
            />
            启用多会话
          </label>
          {confirming ? (
            <div className="error-banner">
              启用多会话需显式确认。缺 header 时仅允许草稿审核。
              <button className="review-btn primary" onClick={() => { setConfirming(false); void save({ enabled: true, multiSessionEnabled: true }) }}>确认启用</button>
            </div>
          ) : null}
        </section>
        <section className="draft-panel">
          <h2>框选向导</h2>
          <div className="region-preview">
            {['contactList', 'chatMain', 'inputBox'].map((item) => <span key={item}>{item}</span>)}
            {settings.multiSessionEnabled ? <span className={settings.headerConfigured ? 'success' : 'warning'}>header</span> : null}
            {settings.multiSessionEnabled ? <span className={settings.unreadIndicatorConfigured ? 'success' : 'danger'}>unreadIndicator</span> : null}
          </div>
          <button className="review-btn secondary" onClick={openAdapterWizard}>追加框选 header / unreadIndicator</button>
          <div className="review-actions">
            <button className="review-btn secondary" onClick={() => save({ headerConfigured: true })}>标记 header 已配置</button>
            <button className="review-btn secondary" onClick={() => save({ unreadIndicatorConfigured: true })}>标记 unreadIndicator 已配置</button>
          </div>
        </section>
      </div>
      <section className="draft-panel audit-table-panel">
        <h2>切换审计</h2>
        <table className="audit-table">
          <tbody>
            <tr><td>低置信未读候选</td><td>已降级为单会话</td><td>chatMain_diff_only</td></tr>
            <tr><td>点击验证失败</td><td>已降级为单会话</td><td>不盲点上一会话</td></tr>
          </tbody>
        </table>
      </section>
    </div>
  )
}

function SettingsPanel() {
  const [visionApiKey, setVisionApiKey] = useState('')
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    const load = async () => {
      const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings | undefined
      if (settings) {
        setVisionApiKey(settings.vision?.apiKey || '')
      }
    }

    void load()
  }, [])

  const handleSaveVision = useCallback(async () => {
    const payload: Partial<AppSettings> = {
      vision: { apiKey: visionApiKey }
    }
    await window.electron?.invoke('settings:set', payload)
    await window.electron?.invoke('engine:updateConfig', {
      ...((await window.electron?.invoke('settings:getAll')) as AppSettings),
      ...payload,
      vision: { apiKey: visionApiKey }
    })
    showToast(t('settings.saved'), 'success')
  }, [visionApiKey])

  const handleTestConnection = useCallback(async () => {
    if (!visionApiKey) return
    setTesting(true)
    try {
      const result = await window.electron?.invoke('engine:testConnection', {
        apiKey: visionApiKey
      })
      if (result?.success) {
        showToast(t('settings.testConnection.success'), 'success')
      } else {
        showToast(`${t('settings.testConnection.fail')}: ${result?.error || ''}`, 'error')
      }
    } catch (e: any) {
      showToast(`${t('settings.testConnection.fail')}: ${e.message}`, 'error')
    } finally {
      setTesting(false)
    }
  }, [visionApiKey])

  return (
    <div className="settings-page slide-up">
      <div className="settings-page-header">
        <div>
          <h1>基础配置</h1>
          <p>维护桌面端运行所需的基础参数。</p>
        </div>
      </div>

      <div className="card base-settings-card">
        <div className="card-title">{t('settings.vision')}</div>

        <div className="form-group">
          <label className="form-label">{t('settings.visionApiKey')}</label>
          <input
            className="form-input"
            type="password"
            value={visionApiKey}
            onChange={(e) => setVisionApiKey(e.target.value)}
            placeholder={t('settings.visionApiKey.placeholder')}
            autoComplete="off"
          />
          <div className="form-hint">{t('settings.visionApiKey.hint')}</div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.visionModel')}</label>
          <input className="form-input" value="doubao-seed-2-0-lite-260428" disabled />
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.visionBaseUrl')}</label>
          <input className="form-input" value="https://ark.cn-beijing.volces.com/api/v3" disabled />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={handleTestConnection}
            disabled={!visionApiKey || testing}
          >
            {testing ? t('settings.testConnection.testing') : t('settings.testConnection')}
          </button>
          <button className="btn btn-primary" onClick={handleSaveVision} style={{ flex: 1 }}>
            {t('settings.saveVision')}
          </button>
        </div>
      </div>
    </div>
  )
}

function AgentPanel(): React.JSX.Element {
  const [catalog, setCatalog] = useState<ProviderCatalogItem[]>(BUILTIN_PROVIDER_CATALOG)
  const [selectedId, setSelectedId] = useState(BUILTIN_PROVIDER_CATALOG[0]?.id || '')
  const [activeId, setActiveId] = useState('doubao')
  const [providerDrafts, setProviderDrafts] = useState<Record<string, Record<string, string>>>({})
  const [currentSettings, setCurrentSettings] = useState<AppSettings | null>(null)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [updatingCatalog, setUpdatingCatalog] = useState(false)
  const selectedProvider = catalog.find((provider) => provider.id === selectedId) || catalog[0]

  const loadSettingsAndCatalog = useCallback(async (forceUpdate: boolean) => {
    setLoadingCatalog(!forceUpdate)
    setUpdatingCatalog(forceUpdate)
    try {
      const [settings, result] = await Promise.all([
        window.electron?.invoke('settings:getAll') as Promise<AppSettings | undefined>,
        window.electron?.invoke(forceUpdate ? 'providerHub:update' : 'providerHub:getCatalog') as Promise<ProviderHubResult>
      ])

      const nextCatalog = mergeProviderCatalog(result?.catalog?.providers || [])
      const nextActiveId = settings?.chatProvider?.installed?.id || 'doubao'
      setCatalog(nextCatalog)
      setCurrentSettings(settings || null)
      setActiveId(nextActiveId)
      setSelectedId((current) => current || nextActiveId || BUILTIN_PROVIDER_CATALOG[0]?.id || nextCatalog[0]?.id || '')
      setProviderDrafts((prev) => ({
        ...prev,
        doubao: {
          ...getProviderDefaults(BUILTIN_PROVIDER_CATALOG[0]),
          ...(prev.doubao || {}),
          ...(!settings?.chatProvider?.installed ? settings?.chatProvider?.config || {} : {}),
          apiKey: prev.doubao?.apiKey || settings?.vision?.apiKey || ''
        },
        [nextActiveId]: {
          ...getProviderDefaults(nextCatalog.find((provider) => provider.id === nextActiveId)),
          ...(prev[nextActiveId] || {}),
          ...(settings?.chatProvider?.config || {})
        }
      }))

      if (result && !result.success) {
        showToast(`智能体列表加载失败: ${result.error || ''}`, 'error')
      } else if (forceUpdate) {
        showToast('智能体列表已更新', 'success')
      }
    } finally {
      setLoadingCatalog(false)
      setUpdatingCatalog(false)
    }
  }, [])

  useEffect(() => {
    void loadSettingsAndCatalog(false)
  }, [loadSettingsAndCatalog])

  const selectedValues = useMemo(
    () => getProviderValues(providerDrafts, selectedProvider, currentSettings),
    [currentSettings, providerDrafts, selectedProvider]
  )

  const setProviderValue = useCallback(
    (fieldKey: string, value: string) => {
      if (!selectedProvider) return
      setProviderDrafts((prev) => ({
        ...prev,
        [selectedProvider.id]: {
          ...getProviderValues(prev, selectedProvider, currentSettings),
          [fieldKey]: value
        }
      }))
    },
    [currentSettings, selectedProvider]
  )

  const persistProvider = useCallback(
    async (provider: ProviderCatalogItem, values: Record<string, string>) => {
      const missing = getMissingRequiredFields(provider, values)
      if (missing.length > 0) {
        showToast(`缺少必填项: ${missing.join('、')}`, 'error')
        return false
      }

      if (provider.id === 'doubao') {
        const { apiKey, ...providerConfig } = values
        await window.electron?.invoke('settings:set', {
          vision: { apiKey },
          chatProvider: {
            manifestUrl: '',
            installed: null,
            config: providerConfig
          }
        })
        const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings
        await window.electron?.invoke('engine:updateConfig', settings)
        setCurrentSettings(settings)
        setActiveId('doubao')
        return true
      }

      const installResult = await window.electron?.invoke('provider:installFromUrl', provider.manifestUrl)
      if (!installResult?.success) {
        showToast(installResult?.error || '智能体安装失败', 'error')
        return false
      }

      await window.electron?.invoke('settings:set', {
        chatProvider: {
          manifestUrl: provider.manifestUrl,
          installed: installResult.installed,
          config: values
        }
      })
      const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings
      await window.electron?.invoke('engine:updateConfig', settings)
      setCurrentSettings(settings)
      setActiveId(provider.id)
      return true
    },
    []
  )

  const handleSaveConfig = useCallback(async () => {
    if (!selectedProvider) return
    const ok = await persistProvider(selectedProvider, selectedValues)
    if (ok) showToast('智能体配置已保存', 'success')
  }, [persistProvider, selectedProvider, selectedValues])

  const handleActivate = useCallback(async () => {
    if (!selectedProvider) return
    const ok = await persistProvider(selectedProvider, selectedValues)
    if (ok) showToast('已切换当前智能体', 'success')
  }, [persistProvider, selectedProvider, selectedValues])

  return (
    <div className="settings-page slide-up">
      <div className="settings-page-header">
        <div>
          <div className="settings-title-row">
            <h1>智能体</h1>
            <button
              className="icon-action refresh-action"
              onClick={() => loadSettingsAndCatalog(true)}
              disabled={updatingCatalog}
              title={updatingCatalog ? '更新中...' : '更新列表'}
              aria-label={updatingCatalog ? '更新中' : '更新智能体列表'}
            >
              <span className={updatingCatalog ? 'refresh-icon spinning' : 'refresh-icon'}>
                <RefreshIcon />
              </span>
            </button>
            {updatingCatalog ? <span className="inline-status">更新中...</span> : null}
          </div>
          <p>选择负责聊天分析和内容生成的智能体，并维护各自配置。</p>
        </div>
      </div>

      {loadingCatalog ? (
        <div className="provider-hub-meta">
          <span className="spinner" />
          正在加载远端智能体列表
        </div>
      ) : null}

      <div className="provider-layout">
        <div className="provider-list">
          {!loadingCatalog && catalog.length === 0 ? (
            <div className="provider-empty">暂无可用智能体，请点击更新列表。</div>
          ) : null}
          {catalog.map((provider) => {
            const description = provider.description || provider.name
            const active = activeId === provider.id

            return (
              <button
                key={provider.id}
                className={`provider-card ${selectedId === provider.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(provider.id)}
              >
                <div className="provider-card-top">
                  <span className="provider-name">{provider.name}</span>
                  {active ? (
                    <span className="provider-status" title="当前启用" aria-label="当前启用">
                      <span className="provider-status-dot" />
                      启用中
                    </span>
                  ) : null}
                </div>
                <div className="provider-desc" title={description}>
                  {description}
                </div>
                <div className="provider-version">v{provider.version}</div>
              </button>
            )
          })}
        </div>

        <div className="card provider-config-card">
          {selectedProvider ? (
            <>
              <div className="provider-config-header">
                <div>
                  <div className="card-title">智能体配置</div>
                  <h2>{selectedProvider.name}</h2>
                </div>
                <span className="provider-version">v{selectedProvider.version}</span>
              </div>

              {selectedProvider.configSchema.fields.map((field) => (
                <ProviderFieldInput
                  key={field.key}
                  field={field}
                  value={selectedValues[field.key] || ''}
                  onChange={(value) => setProviderValue(field.key, value)}
                />
              ))}

              <div className="provider-actions">
                <button className="btn btn-secondary" onClick={handleSaveConfig}>
                  保存配置
                </button>
                <button className="btn btn-primary" onClick={handleActivate}>
                  启用此智能体
                </button>
              </div>
            </>
          ) : (
            <div className="provider-empty">没有选中的智能体。</div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProviderFieldInput({
  field,
  value,
  onChange
}: {
  field: ProviderConfigField
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div className="form-group">
      <label className="form-label">
        {field.label}
        {field.required ? <span className="required-mark"> *</span> : null}
      </label>
      {field.type === 'textarea' ? (
        <textarea
          className="form-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          rows={4}
          readOnly={field.readonly}
        />
      ) : field.type === 'select' ? (
        <select
          className="form-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={field.readonly}
        >
          {(field.options || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="form-input"
          type={field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          autoComplete="off"
          readOnly={field.readonly}
        />
      )}
      {field.hint ? <div className="form-hint">{field.hint}</div> : null}
    </div>
  )
}

function mergeProviderCatalog(remoteProviders: ProviderCatalogItem[]): ProviderCatalogItem[] {
  const remoteOnly = remoteProviders.filter(
    (provider) => !BUILTIN_PROVIDER_CATALOG.some((builtin) => builtin.id === provider.id)
  )
  return [...BUILTIN_PROVIDER_CATALOG, ...remoteOnly]
}

function getProviderDefaults(provider: ProviderCatalogItem | undefined): Record<string, string> {
  if (!provider) return {}
  return provider.configSchema.fields.reduce<Record<string, string>>((acc, field) => {
    acc[field.key] = field.defaultValue || ''
    return acc
  }, {})
}

function getProviderValues(
  drafts: Record<string, Record<string, string>>,
  provider: ProviderCatalogItem | undefined,
  settings: AppSettings | null
): Record<string, string> {
  if (!provider) return {}
  const defaults = getProviderDefaults(provider)
  if (provider.id === 'doubao') {
    return {
      ...defaults,
      ...(settings?.chatProvider.installed ? {} : settings?.chatProvider.config || {}),
      apiKey: drafts.doubao?.apiKey || settings?.vision.apiKey || '',
      ...(drafts.doubao || {})
    }
  }
  return {
    ...defaults,
    ...(settings?.chatProvider.installed?.id === provider.id ? settings.chatProvider.config : {}),
    ...(drafts[provider.id] || {})
  }
}

function getMissingRequiredFields(
  provider: ProviderCatalogItem,
  values: Record<string, string>
): string[] {
  return provider.configSchema.fields
    .filter((field) => field.required && !values[field.key]?.trim())
    .map((field) => field.label)
}

let _showToast: ((msg: string, type: 'success' | 'error') => void) | null = null

function showToast(msg: string, type: 'success' | 'error') {
  _showToast?.(msg, type)
}

function Toast() {
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [type, setType] = useState<'success' | 'error'>('success')
  const timerRef = useRef<number | undefined>(undefined)

  _showToast = useCallback((msg: string, t: 'success' | 'error') => {
    setMessage(msg)
    setType(t)
    setVisible(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setVisible(false), 2500)
  }, [])

  return <div className={`toast ${type} ${visible ? 'show' : ''}`}>{message}</div>
}

export default App
