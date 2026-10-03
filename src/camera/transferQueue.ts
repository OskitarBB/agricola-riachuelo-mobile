// src/camera/transferQueue.ts — Cola de envío de fotos de la CÁMARA al controlador (maestro §14.8, RF-35, RF-37).
//
// QUÉ HACE: procesa transfer_queue de a UNA foto (transfer.maxConcurrentPerCamera = 1):
//  - Orden: prueba corta (-1) → útiles (0) → rechazadas (1); dentro, la más antigua primero.
//  - Envía SOLO al controlador de la sesión de cada foto (RN-22); si la cámara está vinculada a otro
//    controlador, esas fotos esperan y PANT-31 muestra FOTOS_DE_OTRO_CONTROLADOR.
//  - Tras cada intento decide con classifyLocalTransfer: RECIBIDA → RECIBIDA_CONTROLADOR;
//    REINTENTAR → espera transfer.retryDelaysMs (mismo captureId: idempotente); ERROR_LOCAL → solo reintento manual.
// La foto NUNCA se borra aquí (RN-09).

import { CONFIG } from '../config';
import { addMsIso, nowIso } from '../domain/time';
import { logEvent } from '../diagnostics/eventLog';
import { TransferNetworkError } from '../local-network/client/uploadFileSender';
import type { FileSender } from '../local-network/transport';
import type { LocalCaptureMeta, LocalCaptureResponse } from '../protocol/messages';
import { fileExists } from '../storage/files';
import { getCapture, getQualityResult, updateCapture } from '../storage/repositories/captureRepo';
import { listContexts } from '../storage/repositories/cameraContextRepo';
import { countQueue, nextTransfer, updateTransfer } from '../storage/repositories/transferQueueRepo';
import { getDb } from '../storage/db';
import { classifyLocalTransfer, nextDelayMs } from '../sync/retry';
import { useCameraLive } from './cameraStore';

export class TransferQueue {
  private target: { baseUrl: string; controllerDeviceId: string } | null = null;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly sender: FileSender) {}

  /** Se llama al recibir PAIRED: destino = controlador vinculado. */
  setTarget(host: string, filePort: number, controllerDeviceId: string): void {
    this.target = { baseUrl: `http://${host}:${filePort}`, controllerDeviceId };
    this.kick();
  }

  clearTarget(): void {
    this.target = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Despierta la cola (después de una captura o una reconexión). */
  kick(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.loop();
  }

  private async sessionsOfTarget(): Promise<{ mine: string[]; others: number }> {
    const contexts = await listContexts();
    const mine = contexts.filter((c) => c.controllerDeviceId === this.target?.controllerDeviceId).map((c) => c.sessionId);
    const othersIds = contexts.filter((c) => c.controllerDeviceId !== this.target?.controllerDeviceId).map((c) => c.sessionId);
    let others = 0;
    if (othersIds.length > 0) {
      const marks = othersIds.map(() => '?').join(',');
      const r = await getDb().getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM transfer_queue q JOIN captures c ON c.capture_id = q.capture_id
         WHERE q.status IN ('PENDIENTE','EN_CURSO') AND c.session_id IN (${marks})`,
        othersIds,
      );
      others = r?.n ?? 0;
    }
    return { mine, others };
  }

  private async buildMeta(captureId: string): Promise<{ meta: LocalCaptureMeta; uri: string } | null> {
    const c = await getCapture(captureId);
    if (!c || !c.filePath || !c.md5 || !c.sizeBytes || !fileExists(c.filePath)) return null;
    const q = await getQualityResult(captureId);
    return {
      uri: c.filePath,
      meta: {
        captureId: c.captureId,
        sequenceId: c.sequenceId,
        sessionId: c.sessionId,
        passId: c.passId,
        lateralCode: c.lateralCode,
        isTest: c.isTest,
        deviceId: c.deviceId,
        cameraRole: c.cameraRole,
        userId: c.userId,
        capturedAt: c.capturedAt,
        width: c.width ?? 0,
        height: c.height ?? 0,
        sizeBytes: c.sizeBytes,
        md5: c.md5,
        qualityStatus: c.qualityStatus,
        qualityReasons: q?.reasons ?? [],
        qualityMetrics: q?.metrics ?? null,
        profileVersion: q?.profileVersion ?? c.qualityProfileVersion,
        replacesCaptureId: c.replacesCaptureId,
      },
    };
  }

  async refreshCounts(): Promise<void> {
    const counts = await countQueue();
    const { others } = this.target ? await this.sessionsOfTarget() : { others: 0 };
    useCameraLive.setState({
      pendingTransfers: counts.pending,
      errorTransfers: counts.errors,
      otherControllerPhotos: others > 0,
    });
  }

  private async loop(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.target) {
        const { mine } = await this.sessionsOfTarget();
        const item = await nextTransfer(mine);
        if (!item) break;
        const built = await this.buildMeta(item.captureId);
        if (!built) {
          await updateTransfer(item.captureId, { status: 'ERROR', lastError: 'ARCHIVO_NO_DISPONIBLE' });
          await updateCapture(item.captureId, { localTransferStatus: 'ERROR_LOCAL', lastError: 'ARCHIVO_NO_DISPONIBLE' });
          continue;
        }
        await updateTransfer(item.captureId, { status: 'EN_CURSO' });
        await updateCapture(item.captureId, { localTransferStatus: 'TRANSFIRIENDO_LOCAL' });
        logEvent('DEBUG', 'TRANSFER', 'START', { captureId: item.captureId, attempt: item.attempts + 1 }, built.meta.sessionId);
        let response: LocalCaptureResponse | null = null;
        try {
          response = await this.sender.send(this.target.baseUrl, built.meta, built.uri, CONFIG.transfer.requestTimeoutMs);
        } catch (err) {
          if (!(err instanceof TransferNetworkError)) logEvent('WARN', 'TRANSFER', 'SEND_EXCEPTION', { message: String(err) });
          response = null;
        }
        const decision = classifyLocalTransfer(
          response ? { networkError: false, response } : { networkError: true },
          item.checksumFailures,
          CONFIG.transfer.maxChecksumRetries,
        );
        const attempts = item.attempts + 1;
        if (decision === 'RECIBIDA') {
          await updateTransfer(item.captureId, { status: 'HECHO', attempts, lastError: null });
          await updateCapture(item.captureId, {
            localTransferStatus: 'RECIBIDA_CONTROLADOR',
            transferAttempts: attempts,
            lastError: null,
          });
          logEvent('INFO', 'TRANSFER', 'OK', { captureId: item.captureId, attempts }, built.meta.sessionId);
        } else if (decision === 'REINTENTAR') {
          const isChecksum = response?.reason === 'MD5_MISMATCH' || response?.reason === 'SIZE_MISMATCH';
          const delay = nextDelayMs(attempts, CONFIG.transfer.retryDelaysMs, CONFIG.transfer.retryMaxDelayMs);
          await updateTransfer(item.captureId, {
            status: 'PENDIENTE',
            attempts,
            checksumFailures: item.checksumFailures + (isChecksum ? 1 : 0),
            nextAttemptAt: addMsIso(nowIso(), delay),
            lastError: response?.reason ?? 'RED',
          });
          await updateCapture(item.captureId, {
            localTransferStatus: 'PENDIENTE_LOCAL',
            transferAttempts: attempts,
            lastError: response?.reason ?? 'RED',
          });
          logEvent(
            'WARN',
            'TRANSFER',
            'RETRY',
            { captureId: item.captureId, reason: response?.reason ?? 'RED', delay },
            built.meta.sessionId,
          );
          if (!response) break; // sin red: se espera la próxima reconexión o el temporizador
        } else {
          await updateTransfer(item.captureId, { status: 'ERROR', attempts, lastError: response?.reason ?? 'RECHAZADA' });
          await updateCapture(item.captureId, {
            localTransferStatus: 'ERROR_LOCAL',
            transferAttempts: attempts,
            lastError: response?.reason ?? 'RECHAZADA',
          });
          logEvent(
            'ERROR',
            'TRANSFER',
            'ERROR',
            { captureId: item.captureId, reason: response?.reason, attempts },
            built.meta.sessionId,
          );
        }
        await this.refreshCounts();
      }
    } finally {
      this.running = false;
      await this.refreshCounts().catch(() => undefined);
      // Hay elementos con espera: revisar de nuevo más tarde.
      if (this.target && !this.timer) this.timer = setTimeout(() => this.kick(), CONFIG.transfer.retryDelaysMs[0]);
    }
  }
}
