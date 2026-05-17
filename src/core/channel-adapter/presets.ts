import type { ChannelAdapterPreset } from './types'

export const CHANNEL_ADAPTER_PRESETS: ChannelAdapterPreset[] = [
  {
    presetId: 'generic-basic',
    displayName: 'Generic Basic',
    appType: 'generic',
    source: 'local_preset',
    officialSupport: false,
    description: '本地预设示例；默认单会话，不承诺第三方官方稳定支持。',
    defaultSettings: { enabled: false, multiSessionEnabled: false },
    capabilities: ['single_session'],
    status: 'default'
  },
  {
    presetId: 'slack-local-basic',
    displayName: 'Slack Local Basic',
    appType: 'slack',
    source: 'local_preset',
    officialSupport: false,
    description: 'Slack 本地预设示例；非官方稳定承诺。',
    defaultSettings: { enabled: false, multiSessionEnabled: false },
    capabilities: [
      'single_session',
      'multi_session_unread_scan',
      'header_contact_identity',
      'unread_badge_detection'
    ],
    status: 'default'
  },
  {
    presetId: 'lark-local-basic',
    displayName: 'Lark / 飞书 Local Basic',
    appType: 'lark',
    source: 'local_preset',
    officialSupport: false,
    description: '飞书本地预设示例；非官方稳定承诺。',
    defaultSettings: { enabled: false, multiSessionEnabled: false },
    capabilities: [
      'single_session',
      'multi_session_unread_scan',
      'header_contact_identity',
      'unread_badge_detection'
    ],
    status: 'default'
  },
  {
    presetId: 'dingtalk-local-basic',
    displayName: 'DingTalk / 钉钉 Local Basic',
    appType: 'dingtalk',
    source: 'local_preset',
    officialSupport: false,
    description: '钉钉本地预设示例；非官方稳定承诺。',
    defaultSettings: { enabled: false, multiSessionEnabled: false },
    capabilities: [
      'single_session',
      'multi_session_unread_scan',
      'header_contact_identity',
      'unread_badge_detection'
    ],
    status: 'default'
  }
]

export function listChannelAdapterPresets(): ChannelAdapterPreset[] {
  return CHANNEL_ADAPTER_PRESETS.map((preset) => ({ ...preset }))
}
