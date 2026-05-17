import type { IpcMain } from 'electron'
import { VisionReplayStore } from './vision-replay-store'
import type {
  VisionReplayListReportsRequest,
  VisionReplayListReportsResponse,
  VisionReplayListSamplesRequest,
  VisionReplayListSamplesResponse,
  VisionReplayOpenReportRequest,
  VisionReplayOpenReportResponse,
  VisionReplayRunPrivacyGateRequest,
  VisionReplayRunPrivacyGateResponse
} from '../core/rpa/vision-replay-ui-types'

export function registerVisionReplayIpc(ipcMain: IpcMain, store: VisionReplayStore): void {
  ipcMain.handle(
    'visionEval:listReports',
    async (
      _event,
      request?: VisionReplayListReportsRequest
    ): Promise<VisionReplayListReportsResponse> => {
      const result = await store.listReports(request ?? {})
      return { success: true, reports: result.reports, total: result.total }
    }
  )

  ipcMain.handle(
    'visionEval:openReport',
    async (
      _event,
      request: VisionReplayOpenReportRequest
    ): Promise<VisionReplayOpenReportResponse> => {
      return { success: true, detail: await store.openReport(request.reportId, request.sampleId) }
    }
  )

  ipcMain.handle(
    'visionEval:listSamples',
    async (
      _event,
      request?: VisionReplayListSamplesRequest
    ): Promise<VisionReplayListSamplesResponse> => {
      return { success: true, samples: await store.listSamples(request ?? {}) }
    }
  )

  ipcMain.handle(
    'visionEval:runPrivacyGate',
    async (
      _event,
      request: VisionReplayRunPrivacyGateRequest
    ): Promise<VisionReplayRunPrivacyGateResponse> => {
      return { success: true, gate: await store.runPrivacyGate(request) }
    }
  )
}
