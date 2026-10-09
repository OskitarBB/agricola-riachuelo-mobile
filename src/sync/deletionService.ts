// src/sync/deletionService.ts — Borra en el celular lo que el administrador eliminó en la plataforma (v0.5.1).
//
// QUÉ HACE:
//  - checkServerDeletions(): con sesión ONLINE pide GET /api/v1/mobile/deleted-captures desde el último cursor
//    (app_meta deleted_cursor), hasta cleanup.maxPages páginas, y borra la copia local de esas fotos y sesiones.
//    Se llama al empezar cada sincronización; como mucho una vez cada cleanup.checkIntervalMs (salvo force).
//  - purgeCaptures() / purgeSession(): borran los archivos de las fotos, marcan file_deleted_at (la fila queda, RN-09)
//    y cierran la cola. Las usa también syncService cuando el servidor responde 410 SESSION_DELETED / CAPTURE_DELETED.
// Sin internet o con error no pasa nada: se reintenta en la próxima sincronización.

import { deletionApi } from '../api';
import { ApiError } from '../api/httpClient';
import { callWithToken } from '../auth/authService';
import { useAppSession } from '../auth/authStore';
import { CONFIG } from '../config';
import { isValidDeletionResponse, planPurge } from '../domain/deletions';
import { nowMs } from '../domain/time';
import type { DeletedCapturesResponse } from '../api/dto';
import { getDeviceIdentity } from '../device/deviceIdentity';
import { logError, logEvent } from '../diagnostics/eventLog';
import { inTransaction } from '../storage/db';
import { deleteFileIfExists } from '../storage/files';
import { getMeta, setMeta } from '../storage/repositories/appMetaRepo';
import {
  captureIdsOfSession,
  filesOfCaptures,
  markCapturesDeleted,
  markSessionDeleted,
} from '../storage/repositories/deletionRepo';

let lastCheckMs = 0;
let inFlight: Promise<number> | null = null;

function deleteFiles(paths: readonly string[]): number {
  let n = 0;
  for (const p of paths) {
    try {
      if (deleteFileIfExists(p)) n += 1;
    } catch (err) {
      logError('cleanup.file', err);
    }
  }
  return n;
}

/** Borra la copia local de esas fotos. Devuelve cuántos archivos se borraron. */
export async function purgeCaptures(captureIds: readonly string[], code = 'CAPTURE_DELETED'): Promise<number> {
  if (captureIds.length === 0) return 0;
  const files = await filesOfCaptures(captureIds);
  await inTransaction(async (txn) => {
    await markCapturesDeleted(captureIds, code, txn);
  });
  return deleteFiles(files);
}

/** Borra la copia local de una sesión completa (todas sus fotos) y cierra su cola. */
export async function purgeSession(sessionId: string, code = 'SESSION_DELETED'): Promise<number> {
  const ids = await captureIdsOfSession(sessionId);
  const files = await filesOfCaptures(ids);
  await inTransaction(async (txn) => {
    await markCapturesDeleted(ids, code, txn);
    await markSessionDeleted(sessionId, code, txn);
  });
  return deleteFiles(files);
}

/** Consulta al servidor y aplica los borrados. Devuelve cuántos archivos se borraron (0 si no hubo nada o falló). */
export function checkServerDeletions(force = false): Promise<number> {
  if (inFlight) return inFlight;
  if (!force && nowMs() - lastCheckMs < CONFIG.cleanup.checkIntervalMs) return Promise.resolve(0);
  inFlight = doCheck().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doCheck(): Promise<number> {
  if (useAppSession.getState().mode !== 'ONLINE') return 0;
  lastCheckMs = nowMs();
  let since = await getMeta('deleted_cursor');
  const pages: DeletedCapturesResponse[] = [];
  try {
    for (let i = 0; i < CONFIG.cleanup.maxPages; i += 1) {
      const page = await callWithToken((token) =>
        deletionApi.list(token, getDeviceIdentity().deviceId, since, CONFIG.cleanup.requestTimeoutMs),
      );
      if (!isValidDeletionResponse(page)) throw new ApiError('HTTP', 200, 'INTERNAL_ERROR');
      pages.push(page);
      since = page.cursor ?? since;
      if (!page.hasMore) break;
    }
  } catch (err) {
    const code = err instanceof ApiError ? (err.isNetwork ? 'SIN_INTERNET' : (err.code ?? 'HTTP')) : 'ERROR_INESPERADO';
    logEvent('WARN', 'SYNC', 'CLEANUP_CHECK_FAIL', { code, pages: pages.length });
    if (pages.length === 0) return 0; // se aplica lo que sí llegó; el cursor solo avanza hasta ahí
  }
  const plan = planPurge(pages);
  let files = 0;
  try {
    for (const s of plan.sessionIds) files += await purgeSession(s);
    files += await purgeCaptures(plan.captureIds);
  } catch (err) {
    logError('cleanup.apply', err);
    return files; // el cursor no avanza: se vuelve a intentar
  }
  await setMeta('deleted_cursor', since);
  if (plan.sessionIds.length + plan.captureIds.length > 0) {
    logEvent('INFO', 'SYNC', 'CLEANUP_APPLIED', {
      sessions: plan.sessionIds.length,
      captures: plan.captureIds.length,
      files,
    });
  }
  return files;
}
