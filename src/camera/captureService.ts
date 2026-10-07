// src/camera/captureService.ts — Ejecución de CAPTURE_COMMAND en la CÁMARA (maestro §14.7, pasos 4 a 6).
//
// QUÉ HACE:
//  1) Valida: sesión (UNKNOWN_SESSION), pasada (WRONG_PASS), vencimiento con el reloj ESTIMADO del
//     controlador (COMMAND_EXPIRED) y ocupación (BUSY). Un messageId repetido reenvía la respuesta guardada.
//  2) En modo AUTOMÁTICO espera a que el celular esté QUIETO (stabilityDetector); si no lo logra en
//     capture.stability.maxWaitMs responde QUALITY_ERROR con CAMARA_EN_MOVIMIENTO (sin foto).
//  3) Toma la foto (takePictureAsync), la mueve a captures/… o short-test/…, calcula md5 y tamaño,
//     inserta la captura (CAPTURED, PENDIENTE_LOCAL) y evalúa la CALIDAD con la configuración de PAIRED.
//  4) Responde CAPTURE_OK o QUALITY_ERROR y encola la transferencia (prueba corta primero; rechazadas al final).
//  - reevaluatePending(): capturas que quedaron en CAPTURED (la app se cerró durante la calidad, 8.10).

import { CONFIG } from '../config';
import { nowIso, nowMs } from '../domain/time';
import type { CameraRole, Capture, QualityResult } from '../domain/types';
import { isCameraReady, takeToFile } from '../device/cameraService';
import { evaluatePhoto, pipelineConfigFrom } from '../device/qualityPipeline';
import { stabilityDetector } from '../device/stabilityDetector';
import { logEvent } from '../diagnostics/eventLog';
import type { CaptureContextConfig, Envelope, PayloadMap } from '../protocol/messages';
import { inTransaction } from '../storage/db';
import { capturePath, shortTestPath } from '../storage/files';
import { getProcessed, saveProcessed } from '../storage/repositories/processedMessagesRepo';
import { listCapturedNotEvaluated, updateCapture, upsertCapture, upsertQualityResult } from '../storage/repositories/captureRepo';
import { enqueueTransfer } from '../storage/repositories/transferQueueRepo';
import { useCameraLive } from './cameraStore';

export interface CaptureContext {
  sessionId: string;
  role: CameraRole;
  deviceId: string;
  userId: string;
  config: CaptureContextConfig;
  activePassId: string | null;
  /** Desfase estimado reloj controlador − reloj cámara (ms). */
  controllerSkewMs: number;
}

export type ReplyFn = <T extends 'CAPTURE_OK' | 'QUALITY_ERROR' | 'ERROR'>(type: T, payload: PayloadMap[T]) => Envelope;

let busy = false;

function priorityFor(isTest: boolean, accepted: boolean): number {
  if (isTest) return -1;
  return accepted ? 0 : 1;
}

export async function executeCapture(
  env: Envelope<'CAPTURE_COMMAND'>,
  ctx: CaptureContext,
  reply: ReplyFn,
  resend: (saved: Envelope) => void,
): Promise<void> {
  const cmd = env.payload;
  // Duplicado: reenviar la respuesta guardada (14.3).
  const dup = await getProcessed(env.messageId);
  if (dup?.responseJson) {
    resend(JSON.parse(dup.responseJson) as Envelope);
    return;
  }
  const error = (code: PayloadMap['ERROR']['code']) => reply('ERROR', { code, detail: null, refMessageId: env.messageId });
  if (env.sessionId !== ctx.sessionId) return void error('UNKNOWN_SESSION');
  if (cmd.purpose === 'SECUENCIA' && cmd.passId !== ctx.activePassId) return void error('WRONG_PASS');
  if (cmd.purpose === 'PRUEBA_CORTA' && ctx.activePassId) return void error('WRONG_PASS');
  if (nowMs() + ctx.controllerSkewMs > new Date(cmd.expiresAt).getTime()) {
    logEvent('WARN', 'CAPTURE', 'COMMAND_EXPIRED', { skewMs: ctx.controllerSkewMs }, ctx.sessionId);
    return void error('COMMAND_EXPIRED');
  }
  if (busy) return void error('BUSY');
  busy = true;
  useCameraLive.setState({ capturing: true });
  const started = nowMs();
  const isTest = cmd.purpose === 'PRUEBA_CORTA';
  try {
    const save = async (resp: Envelope) => saveProcessed(env.messageId, env.type, JSON.stringify(resp));

    if (!isCameraReady()) {
      logEvent('ERROR', 'CAPTURE', 'CAMERA_NOT_READY', { purpose: cmd.purpose }, ctx.sessionId);
      const resp = reply('QUALITY_ERROR', {
        sequenceId: cmd.sequenceId,
        captureId: cmd.captureId,
        capturedAt: null,
        qualityStatus: 'ERROR_CAMARA',
        reasons: ['FALLO_CAMARA'],
        metrics: null,
        profileVersion: ctx.config.qualityProfileVersion,
        fileAvailable: false,
      });
      await save(resp);
      return;
    }

    // Modo automático: solo con la cámara quieta.
    if (cmd.mode === 'AUTOMATICO' && !isTest) {
      const stable = await stabilityDetector.waitForStable(CONFIG.capture.stability.maxWaitMs);
      if (!stable) {
        const resp = reply('QUALITY_ERROR', {
          sequenceId: cmd.sequenceId,
          captureId: cmd.captureId,
          capturedAt: null,
          qualityStatus: 'REPETIR_NITIDEZ',
          reasons: ['CAMARA_EN_MOVIMIENTO'],
          metrics: null,
          profileVersion: ctx.config.qualityProfileVersion,
          fileAvailable: false,
        });
        await save(resp);
        logEvent('INFO', 'CAPTURE', 'MOVEMENT', { sequenceId: cmd.sequenceId }, ctx.sessionId);
        return;
      }
    }

    const dest = isTest
      ? shortTestPath(ctx.sessionId, cmd.captureId)
      : capturePath(ctx.sessionId, cmd.passId as string, cmd.captureId);
    let photo;
    try {
      photo = await takeToFile(dest, { jpegQuality: ctx.config.jpegQuality, shutterSound: ctx.config.shutterSound });
    } catch (err) {
      logEvent('ERROR', 'CAPTURE', 'TAKE_PICTURE_FAILED', { message: err instanceof Error ? err.message : String(err) }, ctx.sessionId);
      const resp = reply('QUALITY_ERROR', {
        sequenceId: cmd.sequenceId,
        captureId: cmd.captureId,
        capturedAt: null,
        qualityStatus: 'ERROR_CAMARA',
        reasons: ['FALLO_CAMARA'],
        metrics: null,
        profileVersion: ctx.config.qualityProfileVersion,
        fileAvailable: false,
      });
      await save(resp);
      return;
    }
    useCameraLive.setState((s) => ({ flash: s.flash + 1 }));
    // RN-05: la captura se registra con todos sus identificadores ANTES de evaluar.
    const capture: Capture = {
      captureId: cmd.captureId,
      sequenceId: cmd.sequenceId,
      sessionId: ctx.sessionId,
      passId: cmd.passId,
      lateralCode: cmd.lateralCode,
      isTest,
      deviceId: ctx.deviceId,
      cameraRole: ctx.role,
      userId: ctx.userId,
      capturedAt: photo.capturedAt,
      filePath: photo.uri,
      sizeBytes: photo.sizeBytes,
      width: photo.width,
      height: photo.height,
      md5: photo.md5,
      qualityStatus: 'CAPTURED',
      qualityProfileVersion: ctx.config.qualityProfileVersion,
      replacesCaptureId: cmd.replacesCaptureId,
      localTransferStatus: 'PENDIENTE_LOCAL',
      remoteSyncStatus: null,
      transferAttempts: 0,
      syncAttempts: 0,
      lastError: null,
      fileDeletedAt: null,
    };
    await upsertCapture(capture);

    const quality = await evaluatePhoto(
      photo.uri,
      photo.width,
      photo.height,
      pipelineConfigFrom(ctx.config.quality),
      ctx.config.qualityProfileVersion,
    );
    const accepted = quality.status === 'UTILIZABLE' || quality.status === 'PENDIENTE_REVISION_TECNICA';
    await persistQuality(
      cmd.captureId,
      quality,
      isTest || accepted || ctx.config.transferIncludeRejected ? priorityFor(isTest, accepted) : null,
    );

    let resp: Envelope;
    if (accepted) {
      resp = reply('CAPTURE_OK', {
        sequenceId: cmd.sequenceId,
        captureId: cmd.captureId,
        capturedAt: photo.capturedAt,
        width: photo.width,
        height: photo.height,
        sizeBytes: photo.sizeBytes,
        md5: photo.md5,
        qualityStatus: quality.status as 'UTILIZABLE' | 'PENDIENTE_REVISION_TECNICA',
        reasons: quality.reasons,
        metrics: quality.metrics,
        profileVersion: quality.profileVersion,
        captureDurationMs: nowMs() - started,
      });
    } else {
      resp = reply('QUALITY_ERROR', {
        sequenceId: cmd.sequenceId,
        captureId: cmd.captureId,
        capturedAt: photo.capturedAt,
        qualityStatus: quality.status as 'REPETIR_NITIDEZ' | 'REPETIR_EXPOSICION' | 'ERROR_CAMARA',
        reasons: quality.reasons,
        metrics: quality.metrics,
        profileVersion: quality.profileVersion,
        fileAvailable: true,
      });
    }
    await save(resp);
    useCameraLive.setState({
      lastCapture: { quality: quality.status, at: nowIso(), durationMs: quality.metrics?.durationMs ?? null },
    });
  } catch (err) {
    logEvent('ERROR', 'CAPTURE', 'EXCEPTION', { message: err instanceof Error ? err.message : String(err) }, ctx.sessionId);
    error('INTERNAL');
  } finally {
    busy = false;
    useCameraLive.setState({ capturing: false });
  }
}

/** Guarda la calidad y (si corresponde) encola la transferencia en una sola transacción (R-14). */
async function persistQuality(captureId: string, quality: QualityResult, priority: number | null): Promise<void> {
  await inTransaction(async (txn) => {
    await updateCapture(captureId, { qualityStatus: quality.status }, txn);
    await upsertQualityResult(captureId, quality, txn);
    if (priority !== null) await enqueueTransfer(captureId, priority, txn);
  });
}

/** 8.10: capturas en CAPTURED se evalúan de nuevo y se encolan. */
export async function reevaluatePending(config: CaptureContextConfig): Promise<number> {
  const pending = await listCapturedNotEvaluated();
  for (const c of pending) {
    if (!c.filePath || !c.width || !c.height) continue;
    const q = await evaluatePhoto(
      c.filePath,
      c.width,
      c.height,
      pipelineConfigFrom(config.quality),
      config.qualityProfileVersion,
    );
    const accepted = q.status === 'UTILIZABLE' || q.status === 'PENDIENTE_REVISION_TECNICA';
    await persistQuality(
      c.captureId,
      q,
      c.isTest || accepted || config.transferIncludeRejected ? priorityFor(c.isTest, accepted) : null,
    );
  }
  return pending.length;
}
