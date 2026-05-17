export type RedactionExportBlockedType =
  | 'raw_screenshot'
  | 'base64'
  | 'full_chat'
  | 'plaintext_contact'
  | 'full_profile'
  | 'provider_config_values'
  | 'webhook_body'
  | 'secrets'
  | 'unknown_nested_object'

export interface RedactionExportSummary {
  status: 'passed' | 'blocked'
  blockedTypes: RedactionExportBlockedType[]
  omittedFieldPaths: string[]
  unknownFieldCount: number
  checkedAt: string
}
