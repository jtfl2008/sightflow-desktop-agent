import type { IpcMain } from 'electron'
import type {
  DiagnosticsExportResponse,
  DiagnosticsGetRecordResponse,
  DiagnosticsQuery,
  DiagnosticsQueryResponse
} from '../core/diagnostics/diagnostics-types'
import { DiagnosticsStore } from './diagnostics-store'

export function registerDiagnosticsIpc(ipcMain: IpcMain, store: DiagnosticsStore): void {
  ipcMain.handle(
    'diagnostics:query',
    async (_event, request: DiagnosticsQuery): Promise<DiagnosticsQueryResponse> => {
      return store.query(request)
    }
  )

  ipcMain.handle(
    'diagnostics:getRecord',
    async (
      _event,
      request: { source: DiagnosticsQuery['source']; recordId: string; includeRelatedSources?: boolean }
    ): Promise<DiagnosticsGetRecordResponse> => {
      return store.getRecord(request)
    }
  )

  ipcMain.handle(
    'diagnostics:exportRedacted',
    async (
      _event,
      request: { source: DiagnosticsQuery['source']; recordId: string; format: 'markdown' | 'json' }
    ): Promise<DiagnosticsExportResponse> => {
      return store.exportRedacted(request)
    }
  )
}
