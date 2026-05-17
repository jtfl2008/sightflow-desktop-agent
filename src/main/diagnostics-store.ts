import { queryDiagnostics } from '../core/diagnostics/diagnostics-aggregator'
import { exportDiagnosticsRecord } from '../core/diagnostics/diagnostics-export'
import type {
  DiagnosticsExportResponse,
  DiagnosticsGetRecordResponse,
  DiagnosticsQuery,
  DiagnosticsQueryResponse,
  DiagnosticsRecordView,
  DiagnosticsSource,
  DiagnosticsSourceAdapter
} from '../core/diagnostics/diagnostics-types'

export class DiagnosticsStore {
  private readonly adapters: DiagnosticsSourceAdapter[]
  private readonly cache = new Map<string, DiagnosticsRecordView>()

  constructor(adapters: DiagnosticsSourceAdapter[]) {
    this.adapters = adapters
  }

  async query(query: DiagnosticsQuery): Promise<DiagnosticsQueryResponse> {
    const response = await queryDiagnostics(this.adapters, query)
    if (response.ok) {
      for (const record of response.records) this.cache.set(record.recordId, record)
    }
    return response
  }

  getRecord(input: {
    source: DiagnosticsSource
    recordId: string
    includeRelatedSources?: boolean
  }): DiagnosticsGetRecordResponse {
    const record = this.cache.get(input.recordId)
    if (!record || record.source !== input.source) {
      return { ok: false, errorCode: 'not_found', message: 'Diagnostics record not found' }
    }
    return { ok: true, record }
  }

  exportRedacted(input: {
    source: DiagnosticsSource
    recordId: string
    format: 'markdown' | 'json'
  }): DiagnosticsExportResponse {
    const record = this.cache.get(input.recordId)
    if (!record || record.source !== input.source) {
      return {
        ok: false,
        errorCode: 'not_found',
        blockedTypes: [],
        omittedFieldPaths: []
      }
    }
    return exportDiagnosticsRecord(record, input.format)
  }
}
