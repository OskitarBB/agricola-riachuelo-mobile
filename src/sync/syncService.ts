// src/sync/syncService.ts — Sincronización del CONTROLADOR con la plataforma Django /api/v1 (maestro v2.0 §8.9, §15.5,
// §15.7; tarea T-20 de la Fase 4).
//
// QUÉ HACE runSync():
//  1. Una sola ronda a la vez (si ya hay una, responde SINCRONIZACION_EN_CURSO).
//  2. GET /health; si falla, no intenta nada (la cola queda igual: la falta de red no cuenta como intento).
//  3. Exige sesión de usuario ONLINE (OFFLINE → REAUTENTICACION_REQUERIDA, 7.5) y un token vigente (lo renueva).
//  4. Repite: lee la cola de las sesiones con trabajo, marca como error los elementos cuyo padre quedó con error
//     definitivo (syncPlanner.blockedItems) y envía los LISTOS en orden (syncPlanner.pickReadyItems):
//       10 SESSION (CLOSING) → 20 PASS → 30 SEQUENCE_BATCH (lotes de sync.batchSize) → 40 CAPTURE → 50 INCIDENT_BATCH →
//       60 SESSION_CLOSE (CLOSED con endedAt).
//     Cada CAPTURE se envía con syncCapture (captureUploader.ts): ticket a Django → subida directa a Cloudinary (sin
//     cabeceras de la API) → confirmación JSON. Con sync.uploadMode = 'MULTIPART' (Supuesto S-07) usa la forma v1.
//  5. Cada fallo se clasifica (retry.ts) y se aplica la regla de §15.5 paso 5:
//       REINTENTAR → espera sync.retryDelaysMs (la falta de red no cuenta como intento);
//       RENOVAR_TOKEN → se renueva y se repite una vez dentro de authed(); si vuelve a fallar, se pausa la cola;
//       REQUIERE_LOGIN → se pausa la cola (y si la cuenta o el celular fueron desactivados, se revoca el acceso, 7.8);
//       SINCRONIZAR_PADRE → el padre vuelve a PENDIENTE y se envía primero;
//       REPETIR_SUBIDA → la subida queda DESCARTADA y el mismo elemento se reintenta sin espera (hasta sync.maxReuploads);
//       DEFINITIVO → ERROR_DEFINITIVO (y la foto ERROR_SINCRONIZACION) con el código visible en PANT-20.
//  6. Una sesión pasa a SYNCED cuando todos sus elementos están HECHO (markSessionSynced, en una transacción).
//  7. Corta la ronda si se pierde la red (health falla) o tras sync.maxConsecutiveFailures fallos seguidos.
// También: retrySyncErrors() ("Reintentar errores"), stopSync() ("Detener") y la sincronización automática (S-08):
// con la app abierta, sesión ONLINE, función CONTROLADOR, sin sesión de monitoreo abierta y (por defecto) con Wi-Fi.
//
// La app NUNCA recibe URLs de fotos ni resultados de la IA (§28.10): su responsabilidad termina en SINCRONIZADO. Django
// crea la tarea de análisis (ai_tasks) en la misma transacción de la confirmación; el modelo YOLO trabaja en el servidor.

import { authApi, cloudUpload, syncApi, uploadApi } from '../api';
import type { CaptureUploadMetadata } from '../api/dto';
import { ApiError, toCallResult, type ApiCallResult } from '../api/httpClient';
import { getAccessToken, noteServerTime, refreshAccessToken, revoke, REVOKE_CODES } from '../auth/authService';
import { useAppSession } from '../auth/authStore';
import { CONFIG } from '../config';
import { addMsIso, nowIso, nowMs } from '../domain/time';
import { canDoFieldWork } from '../domain/types';
import { getDeviceIdentity } from '../device/deviceIdentity';
import { keepAwakeOff, keepAwakeOn } from '../device/keepAwake';
import { currentNetworkType } from '../device/networkMonitor';
import { logError, logEvent } from '../diagnostics/eventLog';
import { inTransaction } from '../storage/db';
import { fileExists } from '../storage/files';
import { setMetaJson } from '../storage/repositories/appMetaRepo';
import { getCapture, getQualityResult, resetCaptureSyncErrors, setRemoteSyncStatus } from '../storage/repositories/captureRepo';
import { listIncidentsForSync, setIncidentsRemoteStatus } from '../storage/repositories/incidentRepo';
import { getPass, getRetakeByCapture, listMarkerChanges } from '../storage/repositories/passRepo';
import {
  getRemoteUpload,
  markRemoteConfirmed,
  markRemoteDiscarded,
  resetExhaustedReuploads,
  saveUploaded,
} from '../storage/repositories/remoteUploadRepo';
import { listSequenceIdsOfPasses, listSequences } from '../storage/repositories/sequenceRepo';
import {
  getCurrentSession,
  getSession,
  listSessionDevices,
  markSessionSynced,
  setSessionRemoteStatus,
} from '../storage/repositories/sessionRepo';
import {
  claimItem,
  countPendingSync,
  countSyncErrors,
  hasDueItems,
  listOpenSessionItems,
  listSessionItems,
  markEntityDone,
  markItemBlocked,
  markItemDone,
  markItemError,
  markItemRetry,
  releaseStuckItems,
  requeueEntities,
  resetErrors,
  sessionQueueCounts,
  type SyncEntityType,
  type SyncQueueItem,
} from '../storage/repositories/syncQueueRepo';
import { syncCapture, type CaptureSyncOutcome, type CaptureUploaderDeps } from './captureUploader';
import { classifyCloudinaryError, classifySyncError, nextDelayMs } from './retry';
import {
  buildCaptureMetadata,
  buildIncidentDtos,
  buildPassRequest,
  buildSequenceDto,
  buildSessionRequest,
  chunk,
} from './syncPayloads';
import { blockedItems, parentsToRequeue, pickReadyItems } from './syncPlanner';
import { useSyncStore, type SyncRunResult, type SyncStep, type SyncTrigger } from './syncStore';

export type { SyncRunResult, SyncTrigger };

/**
 * ¿Existe la sincronización con el backend? true desde la Fase 4 (v0.4.0). La usa RN-15 en PANT-08
 * (src/device/deviceRole.ts): con elementos pendientes en la cola, el celular no puede cambiar de función.
 */
export const SYNC_IMPLEMENTED = true;

export function isSyncImplemented(): boolean {
  return SYNC_IMPLEMENTED;
}

// ------------------------------------------------------------------ resultado de un elemento

type ApiFailure = Extract<ApiCallResult<unknown>, { ok: false }>;

type ItemOutcome =
  | { kind: 'HECHO' }
  | { kind: 'REINTENTAR'; code: string; network: boolean; cloud?: boolean; detail?: string | null }
  | { kind: 'REQUIERE_LOGIN'; code: string }
  | { kind: 'SINCRONIZAR_PADRE'; code: string }
  | { kind: 'REPETIR_SUBIDA'; code: string }
  | { kind: 'DEFINITIVO'; code: string; detail?: string | null };

/** Códigos de cuenta que Django responde con 403 y que classifySyncError (Anexo C.3) no incluye: pausan la cola. */
const ACCOUNT_CODES: readonly string[] = ['ACCOUNT_PENDING', 'ACCOUNT_REJECTED'];

/** Reenvíos de un padre por SINCRONIZAR_PADRE antes de declarar el elemento con error (evita ciclos sin fin). */
const MAX_PARENT_RESYNCS = 4;

/** Intentos de un mismo elemento dentro de UNA ronda (padre reenviado o subida repetida). */
const MAX_TRIES_PER_RUN = 3;

/** Resumen corto de fieldErrors y traceId para last_error (sin datos sensibles: campos y mensajes del servidor). */
function failureDetail(r: ApiFailure): string | null {
  const parts = (r.fieldErrors ?? []).slice(0, 5).map((f) => `${f.field}: ${f.message}`);
  if (r.traceId) parts.push(`traceId ${r.traceId}`);
  return parts.length > 0 ? parts.join(' · ') : (r.message ?? null);
}

/** Traduce un fallo de la API de Django a la regla de §15.5 paso 5. */
export function outcomeFromApi(r: ApiFailure): ItemOutcome {
  if (r.networkError) return { kind: 'REINTENTAR', code: 'RED', network: true };
  // 2xx que no es JSON: un Wi-Fi con página de acceso o un proxy intermedio. No es culpa del dato.
  if (r.message === 'RESPUESTA_NO_JSON') return { kind: 'REINTENTAR', code: 'RESPUESTA_NO_JSON', network: true };
  const code = r.code ?? `HTTP_${r.status ?? 0}`;
  if (r.status === 403 && r.code && ACCOUNT_CODES.includes(r.code)) return { kind: 'REQUIERE_LOGIN', code };
  switch (classifySyncError({ networkError: false, status: r.status, code: r.code })) {
    case 'REINTENTAR':
    case 'NUEVO_TICKET':
      return { kind: 'REINTENTAR', code, network: false, detail: failureDetail(r) };
    case 'RENOVAR_TOKEN':
      // authed() ya renovó y repitió una vez: si el servidor sigue diciendo 401, se pausa la cola.
      return { kind: 'REQUIERE_LOGIN', code: r.code ?? 'TOKEN_EXPIRED' };
    case 'REQUIERE_LOGIN':
      return { kind: 'REQUIERE_LOGIN', code: r.code ?? 'ACCESO_DENEGADO' };
    case 'SINCRONIZAR_PADRE':
      return { kind: 'SINCRONIZAR_PADRE', code };
    case 'REPETIR_SUBIDA':
      return { kind: 'REPETIR_SUBIDA', code };
    default:
      return { kind: 'DEFINITIVO', code, detail: failureDetail(r) };
  }
}

// ------------------------------------------------------------------ contexto de una ronda

interface RunContext {
  trigger: SyncTrigger;
  deviceId: string;
  startedAt: string;
  stopRequested: boolean;
  /** Fallos seguidos (cualquier REINTENTAR); se reinicia con cada éxito. */
  consecutiveFailures: number;
  touchedSessions: Set<string>;
  /** Último fallo de la API dentro de syncCapture (para clasificarlo con las reglas de esta capa). */
  lastApiFailure: ApiFailure | null;
  counters: { done: number; retried: number; errors: number; uploaded: number; sessionsSynced: number };
}

let running: Promise<SyncRunResult> | null = null;
let currentCtx: RunContext | null = null;
/** «Detener» pedido para la ronda en curso (también si se pide antes de que empiece a enviar). */
let stopPending = false;

function store() {
  return useSyncStore.getState();
}

function setStep(step: SyncStep | null): void {
  const cur = store().current;
  if (cur) store().set({ current: { ...cur, step }, upload: step === 'SUBIDA' ? { bytesSent: 0, totalBytes: 0 } : null });
}

let lastProgressMs = 0;
function onUploadProgress(p: { bytesSent: number; totalBytes: number }): void {
  const now = nowMs();
  if (now - lastProgressMs < 250 && p.bytesSent < p.totalBytes) return; // como máximo 4 veces por segundo
  lastProgressMs = now;
  store().set({ upload: { bytesSent: p.bytesSent, totalBytes: p.totalBytes } });
}

/**
 * Llama a la API con un token vigente. Ante 401 (TOKEN_EXPIRED) renueva UNA vez y repite (RENOVAR_TOKEN). Sin tokens
 * o con el acceso revocado devuelve 401 REFRESH_INVALID (REQUIERE_LOGIN). Nunca lanza.
 */
async function authed<T>(fn: (token: string) => Promise<ApiCallResult<T>>): Promise<ApiCallResult<T>> {
  let token: string | null;
  try {
    token = await getAccessToken();
  } catch (err) {
    return toCallResult<T>(err);
  }
  if (!token) return { ok: false, networkError: false, status: 401, code: 'REFRESH_INVALID' };
  const first = await fn(token);
  if (first.ok || first.networkError || first.status !== 401 || first.code === 'REFRESH_INVALID') return first;
  let fresh: string | null;
  try {
    fresh = await refreshAccessToken();
  } catch (err) {
    return toCallResult<T>(err);
  }
  if (!fresh) return { ok: false, networkError: false, status: 401, code: 'REFRESH_INVALID' };
  return fn(fresh);
}

/** GET /health: 'OK', 'SIN_INTERNET' (sin red o una página que no es la API) o 'BACKEND_NO_DISPONIBLE'. */
async function backendStatus(): Promise<'OK' | 'SIN_INTERNET' | 'BACKEND_NO_DISPONIBLE'> {
  try {
    const h = await authApi.health();
    noteServerTime(h.serverTime);
    useAppSession.getState().set({ online: true });
    return 'OK';
  } catch (err) {
    useAppSession.getState().set({ online: false });
    if (err instanceof ApiError && !err.isNetwork && err.serverMessage !== 'RESPUESTA_NO_JSON') return 'BACKEND_NO_DISPONIBLE';
    return 'SIN_INTERNET';
  }
}

// ------------------------------------------------------------------ envío de cada tipo de elemento

/** Tiempo máximo de cada petición JSON a Django (la subida de la foto usa sync.uploadRequestTimeoutMs). */
const T = (): number => CONFIG.sync.requestTimeoutMs;

async function sendSession(it: SyncQueueItem, ctx: RunContext, phase: 'CLOSING' | 'CLOSED'): Promise<ItemOutcome> {
  const s = await getSession(it.sessionId);
  if (!s) return { kind: 'DEFINITIVO', code: 'DATOS_LOCALES_FALTANTES' };
  const req = buildSessionRequest(s, await listSessionDevices(s.sessionId), phase);
  const r = await authed((t) => syncApi.upsertSession(req, t, ctx.deviceId, T()));
  return r.ok ? { kind: 'HECHO' } : outcomeFromApi(r);
}

async function sendPass(it: SyncQueueItem, ctx: RunContext): Promise<ItemOutcome> {
  const p = await getPass(it.entityId);
  if (!p) return { kind: 'DEFINITIVO', code: 'DATOS_LOCALES_FALTANTES' };
  const req = buildPassRequest(p, await listMarkerChanges(p.passId));
  const r = await authed((t) => syncApi.upsertPass(p.sessionId, req, t, ctx.deviceId, T()));
  return r.ok ? { kind: 'HECHO' } : outcomeFromApi(r);
}

/** Un elemento enviado en varias peticiones se marca HECHO solo si todas responden bien (§15.5 paso 3). */
async function sendSequences(it: SyncQueueItem, ctx: RunContext): Promise<ItemOutcome> {
  const dtos = (await listSequences(it.entityId)).map(buildSequenceDto);
  for (const part of chunk(dtos, CONFIG.sync.batchSize)) {
    const r = await authed((t) => syncApi.sequenceBatch({ sessionId: it.sessionId, sequences: part }, t, ctx.deviceId, T()));
    if (!r.ok) return outcomeFromApi(r);
  }
  return { kind: 'HECHO' };
}

async function sendIncidents(it: SyncQueueItem, ctx: RunContext): Promise<ItemOutcome> {
  // Solo se citan pasadas y secuencias que el servidor ya tiene (Django rechaza TODO el lote si una no existe).
  const items = await listSessionItems(it.sessionId);
  const knownPassIds = new Set(items.filter((i) => i.entityType === 'PASS' && i.status === 'HECHO').map((i) => i.entityId));
  const seqPassIds = items.filter((i) => i.entityType === 'SEQUENCE_BATCH' && i.status === 'HECHO').map((i) => i.entityId);
  const knownSequenceIds = await listSequenceIdsOfPasses(seqPassIds);
  const dtos = buildIncidentDtos(await listIncidentsForSync(it.sessionId), knownPassIds, knownSequenceIds);
  for (const part of chunk(dtos, CONFIG.sync.batchSize)) {
    const r = await authed((t) => syncApi.incidentBatch({ sessionId: it.sessionId, incidents: part }, t, ctx.deviceId, T()));
    if (!r.ok) return outcomeFromApi(r);
  }
  await setIncidentsRemoteStatus(it.sessionId, 'SINCRONIZADO');
  return { kind: 'HECHO' };
}

/** Dependencias de syncCapture (15.7.3) con SQLite, la API y Cloudinary, más los eventos SYNC/* de 20.1. */
function captureDeps(ctx: RunContext, captureId: string, sessionId: string): CaptureUploaderDeps {
  let tickets = 0;
  return {
    getStoredUpload: (id) => getRemoteUpload(id),
    saveUploaded: async (id, result, reuploadCount) => {
      await saveUploaded(id, result, reuploadCount);
      if (reuploadCount > 0) logEvent('INFO', 'SYNC', 'REUPLOAD', { captureId: id, reuploadCount }, sessionId);
    },
    markConfirmed: async (id, duplicate) => {
      await inTransaction(async (txn) => {
        await markRemoteConfirmed(id, txn);
        await setRemoteSyncStatus(id, 'SINCRONIZADO', null, txn);
        await markEntityDone('CAPTURE', id, txn);
      });
      logEvent('INFO', 'SYNC', 'CONFIRM_OK', { captureId: id, duplicate }, sessionId);
    },
    markAlreadyConfirmed: async (id) => {
      await inTransaction(async (txn) => {
        await setRemoteSyncStatus(id, 'SINCRONIZADO', null, txn);
        await markEntityDone('CAPTURE', id, txn);
      });
      logEvent('INFO', 'SYNC', 'ALREADY_CONFIRMED', { captureId: id }, sessionId);
    },
    markDiscarded: async (id, code) => {
      await markRemoteDiscarded(id, code);
      logEvent('WARN', 'SYNC', 'UPLOAD_DISCARDED', { captureId: id, code }, sessionId);
    },
    requestTicket: async (req) => {
      tickets += 1;
      setStep('TICKET');
      const r = await authed((t) => uploadApi.requestTicket(req, t, ctx.deviceId, T()));
      if (!r.ok) {
        ctx.lastApiFailure = r;
        return r;
      }
      noteServerTime(r.data.serverTime);
      logEvent(
        'INFO',
        'SYNC',
        tickets > 1 ? 'TICKET_RENEWED' : 'TICKET_OK',
        { captureId, alreadyConfirmed: r.data.alreadyConfirmed },
        sessionId,
      );
      return r;
    },
    upload: async (ticket, fileUri) => {
      setStep('SUBIDA');
      const started = nowMs();
      const out = await cloudUpload(ticket, fileUri, CONFIG.sync.uploadRequestTimeoutMs, onUploadProgress);
      if (out.ok) {
        ctx.counters.uploaded += 1;
        logEvent(
          'INFO',
          'SYNC',
          'UPLOAD_OK',
          { captureId, bytes: out.result.bytes, ms: nowMs() - started, existing: out.result.existing },
          sessionId,
        );
      } else {
        const c = classifyCloudinaryError(out);
        const status = out.networkError ? null : out.status;
        if (c.cls === 'DEFINITIVO') logEvent('ERROR', 'SYNC', 'UPLOAD_ERROR', { captureId, code: c.code, status }, sessionId);
        else logEvent('WARN', 'SYNC', 'UPLOAD_RETRY', { captureId, code: c.code, status, ms: nowMs() - started }, sessionId);
      }
      return out;
    },
    confirm: async (req) => {
      setStep('CONFIRMACION');
      const r = await authed((t) => uploadApi.confirm(req, t, ctx.deviceId, T()));
      if (!r.ok) ctx.lastApiFailure = r;
      return r;
    },
  };
}

/** Resultado de syncCapture → regla de la cola. Los fallos de la API se reclasifican con outcomeFromApi. */
function outcomeFromCapture(out: CaptureSyncOutcome, ctx: RunContext): ItemOutcome {
  if (out.kind === 'HECHO') return { kind: 'HECHO' };
  if (out.step !== 'SUBIDA' && ctx.lastApiFailure) return outcomeFromApi(ctx.lastApiFailure);
  const code = out.code ?? 'ERROR_INESPERADO';
  if (out.kind === 'DEFINITIVO') return { kind: 'DEFINITIVO', code };
  // REINTENTAR de la subida (RED, LIMITE_DE_TASA, CLOUDINARY_NO_DISPONIBLE, RESPUESTA_INVALIDA) o TICKETS_AGOTADOS.
  return { kind: 'REINTENTAR', code, network: code === 'RED', cloud: out.step === 'SUBIDA' };
}

async function sendCapture(it: SyncQueueItem, ctx: RunContext): Promise<ItemOutcome> {
  const c = await getCapture(it.entityId);
  if (!c) return { kind: 'DEFINITIVO', code: 'CAPTURA_NO_ENCONTRADA' };
  if (c.isTest || !c.passId) return { kind: 'DEFINITIVO', code: 'CAPTURA_SIN_PASADA' };
  const [pass, session, quality, retake, devices] = await Promise.all([
    getPass(c.passId),
    getSession(c.sessionId),
    getQualityResult(c.captureId),
    getRetakeByCapture(c.captureId),
    listSessionDevices(c.sessionId),
  ]);
  if (!pass || !session) return { kind: 'DEFINITIVO', code: 'DATOS_LOCALES_FALTANTES' };
  const built = buildCaptureMetadata({ capture: c, quality, pass, session, retake, devices });
  if (!built.ok) return { kind: 'DEFINITIVO', code: built.code };

  // Ya confirmada en Django (p. ej. el elemento volvió a la cola después de confirmarse): solo se cierra el elemento.
  const stored = await getRemoteUpload(c.captureId);
  if (stored?.status === 'CONFIRMADA') {
    await inTransaction(async (txn) => {
      await setRemoteSyncStatus(c.captureId, 'SINCRONIZADO', null, txn);
      await markEntityDone('CAPTURE', c.captureId, txn);
    });
    return { kind: 'HECHO' };
  }
  // El archivo solo hace falta si todavía no está subido (una fila SUBIDA solo necesita la confirmación, RF-51).
  const needsFile = !stored || stored.status === 'DESCARTADA';
  if (needsFile && !fileExists(c.filePath)) return { kind: 'DEFINITIVO', code: 'ARCHIVO_NO_DISPONIBLE' };

  await setRemoteSyncStatus(c.captureId, 'SUBIENDO');
  if (CONFIG.sync.uploadMode === 'MULTIPART' && needsFile) return sendCaptureMultipart(c.captureId, c.filePath ?? '', built.meta, ctx);

  ctx.lastApiFailure = null;
  const out = await syncCapture(built.meta, c.filePath ?? '', captureDeps(ctx, c.captureId, c.sessionId), {
    maxUploadBytes: CONFIG.sync.maxUploadBytes,
    maxReuploads: CONFIG.sync.maxReuploads,
    ticketMinRemainingMs: CONFIG.sync.ticketMinRemainingMs,
    maxTicketRequests: CONFIG.sync.maxTicketRequests,
  });
  return outcomeFromCapture(out, ctx);
}

/** Forma v1 (Supuesto S-07): la foto va a Django en un multipart y Django la sube a Cloudinary. */
async function sendCaptureMultipart(
  captureId: string,
  fileUri: string,
  meta: CaptureUploadMetadata,
  ctx: RunContext,
): Promise<ItemOutcome> {
  setStep('SUBIDA');
  const started = nowMs();
  const r = await authed((t) =>
    uploadApi.uploadMultipart(fileUri, meta, t, ctx.deviceId, CONFIG.sync.uploadRequestTimeoutMs, onUploadProgress),
  );
  if (!r.ok) return outcomeFromApi(r);
  await inTransaction(async (txn) => {
    await setRemoteSyncStatus(captureId, 'SINCRONIZADO', null, txn);
    await markEntityDone('CAPTURE', captureId, txn);
  });
  ctx.counters.uploaded += 1;
  logEvent('INFO', 'SYNC', 'CONFIRM_OK', { captureId, duplicate: r.data.duplicate, multipart: true, ms: nowMs() - started }, meta.sessionId);
  return { kind: 'HECHO' };
}

async function sendItem(it: SyncQueueItem, ctx: RunContext): Promise<ItemOutcome> {
  switch (it.entityType) {
    case 'SESSION':
      return sendSession(it, ctx, 'CLOSING');
    case 'PASS':
      return sendPass(it, ctx);
    case 'SEQUENCE_BATCH':
      return sendSequences(it, ctx);
    case 'CAPTURE':
      return sendCapture(it, ctx);
    case 'INCIDENT_BATCH':
      return sendIncidents(it, ctx);
    case 'SESSION_CLOSE':
      return sendSession(it, ctx, 'CLOSED');
    default:
      return { kind: 'DEFINITIVO', code: 'TIPO_DESCONOCIDO' };
  }
}

// ------------------------------------------------------------------ aplicar el resultado a la cola

type StepResult = { stop?: string; recompute?: boolean; exhausted?: boolean };

async function maybeSessionSynced(sessionId: string, ctx: RunContext): Promise<void> {
  const c = await sessionQueueCounts(sessionId);
  if (c.total === 0 || c.done !== c.total) return;
  await inTransaction(async (txn) => markSessionSynced(sessionId, txn));
  ctx.counters.sessionsSynced += 1;
  logEvent('INFO', 'SYNC', 'SESSION_SYNCED', { items: c.total }, sessionId);
}

/** Pasadas y secuencias de la sesión que vuelven a PENDIENTE (incidencia que cita algo que el servidor no tiene). */
async function requeueStructure(sessionId: string): Promise<void> {
  const items = await listSessionItems(sessionId);
  await requeueEntities(
    items
      .filter((i) => i.entityType === 'PASS' || i.entityType === 'SEQUENCE_BATCH')
      .map((i) => ({ type: i.entityType, entityId: i.entityId })),
  );
}

async function applyOutcome(it: SyncQueueItem, outcome: ItemOutcome, ctx: RunContext, startedMs: number): Promise<StepResult> {
  const isCapture = it.entityType === 'CAPTURE';
  const ref = { type: it.entityType, ms: nowMs() - startedMs };
  switch (outcome.kind) {
    case 'HECHO': {
      ctx.consecutiveFailures = 0;
      ctx.counters.done += 1;
      if (!isCapture) {
        // false: una foto tardía lo reencoló mientras se enviaba (8.13); se reenviará con los datos nuevos.
        const marked = await markItemDone(it.id);
        if (!marked) logEvent('INFO', 'SYNC', 'ITEM_REQUEUED', ref, it.sessionId);
        logEvent('INFO', 'SYNC', 'ITEM_OK', ref, it.sessionId);
      }
      await maybeSessionSynced(it.sessionId, ctx);
      return {};
    }
    case 'REINTENTAR': {
      ctx.counters.retried += 1;
      ctx.consecutiveFailures += 1;
      const attempt = it.attempts + 1;
      const delay = nextDelayMs(attempt, CONFIG.sync.retryDelaysMs);
      await markItemRetry(it.id, addMsIso(nowIso(), delay), outcome.code, outcome.detail ?? null, !outcome.network);
      if (isCapture) await setRemoteSyncStatus(it.entityId, 'PENDIENTE_NUBE', outcome.code);
      logEvent('WARN', 'SYNC', 'ITEM_RETRY', { ...ref, code: outcome.code, attempt, delayMs: delay }, it.sessionId);
      if (outcome.network) {
        // ¿Se cayó la red o solo falló esta petición? Sin servidor no se insiste (la cola queda igual).
        const st = await backendStatus();
        if (st !== 'OK') return { stop: st, exhausted: true };
      }
      if (ctx.consecutiveFailures >= CONFIG.sync.maxConsecutiveFailures) {
        // Django responde pero Cloudinary no (o la subida se corta): no es el servidor del proyecto el que falla.
        const stop = outcome.cloud ? 'SUBIDA_NUBE_FALLIDA' : outcome.network ? 'SIN_INTERNET' : 'BACKEND_NO_DISPONIBLE';
        return { stop, exhausted: true };
      }
      return { exhausted: true };
    }
    case 'REQUIERE_LOGIN': {
      // El elemento vuelve a PENDIENTE sin espera ni intento: no es culpa del dato.
      await markItemRetry(it.id, nowIso(), outcome.code, null, false);
      if (isCapture) await setRemoteSyncStatus(it.entityId, 'PENDIENTE_NUBE', outcome.code);
      logEvent('WARN', 'SYNC', 'PAUSED', { ...ref, code: outcome.code }, it.sessionId);
      if (outcome.code !== 'REFRESH_INVALID' && (REVOKE_CODES as readonly string[]).includes(outcome.code)) {
        await revoke(outcome.code); // cuenta o celular desactivados (7.8): los datos de campo se conservan
      }
      return { stop: outcome.code };
    }
    case 'SINCRONIZAR_PADRE': {
      if (it.attempts + 1 >= MAX_PARENT_RESYNCS) {
        return applyOutcome(it, { kind: 'DEFINITIVO', code: 'PADRE_NO_SINCRONIZADO', detail: outcome.code }, ctx, startedMs);
      }
      const parents = parentsToRequeue(it, outcome.code);
      if (parents.length > 0) await requeueEntities(parents);
      else await requeueStructure(it.sessionId);
      await markItemRetry(it.id, nowIso(), outcome.code, null, true);
      if (isCapture) await setRemoteSyncStatus(it.entityId, 'PENDIENTE_NUBE', outcome.code);
      logEvent('WARN', 'SYNC', 'ITEM_RETRY', { ...ref, code: outcome.code, parents: parents.length }, it.sessionId);
      return { recompute: true };
    }
    case 'REPETIR_SUBIDA': {
      // La fila de remote_uploads ya quedó DESCARTADA: el siguiente intento pide un ticket nuevo y sube otra vez.
      await markItemRetry(it.id, nowIso(), outcome.code, null, true);
      await setRemoteSyncStatus(it.entityId, 'PENDIENTE_NUBE', outcome.code);
      logEvent('WARN', 'SYNC', 'ITEM_RETRY', { ...ref, code: outcome.code, reupload: true }, it.sessionId);
      return { recompute: true };
    }
    case 'DEFINITIVO': {
      ctx.consecutiveFailures = 0; // el servidor respondió: no es una caída
      ctx.counters.errors += 1;
      await markItemError(it.id, outcome.code, outcome.detail ?? null);
      if (isCapture) await setRemoteSyncStatus(it.entityId, 'ERROR_SINCRONIZACION', outcome.code);
      logEvent('ERROR', 'SYNC', 'ITEM_ERROR', { ...ref, code: outcome.code }, it.sessionId);
      return { recompute: true, exhausted: true };
    }
    default:
      return {};
  }
}

async function processOne(it: SyncQueueItem, ctx: RunContext): Promise<StepResult> {
  if (!(await claimItem(it.id))) return {}; // cambió mientras tanto (p. ej. otra ronda o una foto tardía)
  ctx.touchedSessions.add(it.sessionId);
  store().set({ current: { entityType: it.entityType, sessionId: it.sessionId, step: null }, upload: null });
  const started = nowMs();
  let outcome: ItemOutcome;
  try {
    outcome = await sendItem(it, ctx);
  } catch (err) {
    // Error de programación o de SQLite: se registra y el elemento vuelve con espera (no se pierde).
    logError('sync.item', err);
    outcome = { kind: 'REINTENTAR', code: 'ERROR_INESPERADO', network: false };
  }
  const res = await applyOutcome(it, outcome, ctx, started);
  const s = store();
  s.set({ done: ctx.counters.done, retried: ctx.counters.retried, errors: ctx.counters.errors, uploaded: ctx.counters.uploaded });
  s.bump();
  return res;
}

/** Elementos con un padre en error definitivo: pasan a error con un código visible (no bloquean el cierre ni RN-15). */
async function markBlocked(items: SyncQueueItem[], ctx: RunContext): Promise<number> {
  let n = 0;
  for (const b of blockedItems(items)) {
    if (await markItemBlocked(b.item.id, b.code)) {
      n += 1;
      ctx.counters.errors += 1;
      ctx.touchedSessions.add(b.item.sessionId);
      if (b.item.entityType === 'CAPTURE') await setRemoteSyncStatus(b.item.entityId, 'ERROR_SINCRONIZACION', b.code);
      logEvent('WARN', 'SYNC', 'ITEM_ERROR', { type: b.item.entityType, code: b.code }, b.item.sessionId);
    }
  }
  return n;
}

async function processQueue(ctx: RunContext): Promise<string | null> {
  const tries = new Map<number, number>();
  for (let round = 0; round < 100_000; round++) {
    if (ctx.stopRequested || stopPending) return 'SINCRONIZACION_DETENIDA';
    const all = await listOpenSessionItems();
    if (await markBlocked(all, ctx)) continue;
    const ready = pickReadyItems(all, { nowIso: nowIso(), respectSchedule: ctx.trigger === 'AUTO' }).filter(
      (it) => (tries.get(it.id) ?? 0) < MAX_TRIES_PER_RUN,
    );
    if (ready.length === 0) return null;
    for (const it of ready) {
      if (ctx.stopRequested || stopPending) return 'SINCRONIZACION_DETENIDA';
      tries.set(it.id, (tries.get(it.id) ?? 0) + 1);
      const res = await processOne(it, ctx);
      if (res.exhausted) tries.set(it.id, MAX_TRIES_PER_RUN); // no se repite en esta ronda (respeta su espera)
      if (res.stop) return res.stop;
      if (res.recompute) break; // padres reencolados o un error que bloquea a otros: se vuelve a planificar
    }
  }
  return null;
}

/** Estado remoto de las sesiones tocadas: SUBIENDO, ERROR_SINCRONIZACION o PENDIENTE_NUBE (SINCRONIZADO lo pone SYNCED). */
async function refreshSessionStatuses(ctx: RunContext): Promise<void> {
  for (const sessionId of ctx.touchedSessions) {
    const c = await sessionQueueCounts(sessionId);
    if (c.total === 0 || c.done === c.total) continue;
    await setSessionRemoteStatus(sessionId, c.errors > 0 ? 'ERROR_SINCRONIZACION' : c.done > 0 ? 'SUBIENDO' : 'PENDIENTE_NUBE');
  }
}

// ------------------------------------------------------------------ API pública

function emptyResult(trigger: SyncTrigger, code: string, startedAt: string, remaining = 0): SyncRunResult {
  return {
    ok: false,
    code,
    trigger,
    startedAt,
    finishedAt: nowIso(),
    done: 0,
    retried: 0,
    errors: 0,
    uploaded: 0,
    sessionsSynced: 0,
    remaining,
  };
}

async function doRun(trigger: SyncTrigger): Promise<SyncRunResult> {
  const startedAt = nowIso();
  const pendingAtStart = await countPendingSync();
  const auth = useAppSession.getState();
  if (auth.status !== 'AUTENTICADO') return emptyResult(trigger, 'REFRESH_INVALID', startedAt, pendingAtStart);
  if (auth.mode !== 'ONLINE') return emptyResult(trigger, 'REAUTENTICACION_REQUERIDA', startedAt, pendingAtStart);
  // Una sola ronda a la vez: lo que haya quedado EN_CURSO es de una ronda interrumpida y vuelve a PENDIENTE.
  await releaseStuckItems();
  if (pendingAtStart === 0) {
    const errors = await countSyncErrors();
    return { ...emptyResult(trigger, errors > 0 ? 'SINCRONIZACION_CON_ERRORES' : 'NADA_PENDIENTE', startedAt), ok: errors === 0 };
  }
  const health = await backendStatus();
  if (health !== 'OK') return emptyResult(trigger, health, startedAt, pendingAtStart);

  const ctx: RunContext = {
    trigger,
    deviceId: getDeviceIdentity().deviceId,
    startedAt,
    stopRequested: false,
    consecutiveFailures: 0,
    touchedSessions: new Set(),
    lastApiFailure: null,
    counters: { done: 0, retried: 0, errors: 0, uploaded: 0, sessionsSynced: 0 },
  };
  currentCtx = ctx;
  store().set({
    running: true,
    trigger,
    startedAt,
    stopping: false,
    current: null,
    upload: null,
    done: 0,
    retried: 0,
    errors: 0,
    uploaded: 0,
    totalAtStart: pendingAtStart,
  });
  logEvent('INFO', 'SYNC', 'START', { trigger, pending: pendingAtStart, mode: CONFIG.sync.uploadMode });
  if (trigger === 'MANUAL') await keepAwakeOn('sync');
  let stop: string | null = null;
  try {
    stop = await processQueue(ctx);
  } catch (err) {
    logError('sync.run', err);
    stop = 'ERROR_INESPERADO';
  } finally {
    if (trigger === 'MANUAL') await keepAwakeOff('sync');
    currentCtx = null;
  }
  await refreshSessionStatuses(ctx).catch((err: unknown) => logError('sync.status', err));

  const remaining = await countPendingSync();
  const errors = await countSyncErrors();
  const code = stop ?? (remaining > 0 ? 'SINCRONIZACION_PARCIAL' : errors > 0 ? 'SINCRONIZACION_CON_ERRORES' : 'SINCRONIZADO');
  const result: SyncRunResult = {
    ok: code === 'SINCRONIZADO',
    code,
    trigger,
    startedAt,
    finishedAt: nowIso(),
    ...ctx.counters,
    remaining,
  };
  logEvent(code === 'SINCRONIZADO' ? 'INFO' : 'WARN', 'SYNC', 'END', {
    trigger,
    code,
    ...ctx.counters,
    remaining,
    queueErrors: errors,
  });
  return result;
}

/** "Sincronizar ahora" (PANT-20) y la sincronización automática. Nunca lanza. */
export function runSync(opts: { trigger?: SyncTrigger } = {}): Promise<SyncRunResult> {
  const trigger = opts.trigger ?? 'MANUAL';
  if (running) return Promise.resolve(emptyResult(trigger, 'SINCRONIZACION_EN_CURSO', nowIso()));
  // ADR 0009: con el usuario del especialista no se sincroniza (la plataforma responde 403 ROLE_NOT_ALLOWED y la app
  // revocaría la sesión). Los datos del controlador quedan guardados hasta que entre el operador o el administrador.
  if (!canDoFieldWork(useAppSession.getState().user?.roles))
    return Promise.resolve(emptyResult(trigger, 'ACCESO_DENEGADO', nowIso()));
  stopPending = false;
  running = doRun(trigger)
    .catch((err: unknown) => {
      logError('sync.run', err);
      return emptyResult(trigger, 'ERROR_INESPERADO', nowIso());
    })
    .then(async (result) => {
      store().set({ running: false, stopping: false, current: null, upload: null, lastResult: result });
      store().bump();
      // Resultado guardado para PANT-20 y el diagnóstico (sin datos sensibles).
      await setMetaJson('last_sync', result).catch(() => undefined);
      return result;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

export function isSyncRunning(): boolean {
  return running !== null;
}

/** "Detener": termina al finalizar el elemento en curso; lo pendiente sigue en la cola. */
export function stopSync(): void {
  if (!running) return;
  stopPending = true;
  if (currentCtx) currentCtx.stopRequested = true;
  store().set({ stopping: true });
}

/** "Reintentar errores" (PANT-20): ERROR_DEFINITIVO → PENDIENTE de inmediato y nueva ronda. */
export async function retrySyncErrors(): Promise<SyncRunResult> {
  if (running) return emptyResult('MANUAL', 'SINCRONIZACION_EN_CURSO', nowIso());
  const reuploads = await resetExhaustedReuploads();
  const items = await resetErrors();
  const captures = await resetCaptureSyncErrors();
  logEvent('INFO', 'SYNC', 'MANUAL_RETRY', { items, captures, reuploads });
  return runSync({ trigger: 'MANUAL' });
}

// ------------------------------------------------------------------ sincronización automática (Supuesto S-08)

let autoTimer: ReturnType<typeof setInterval> | null = null;
let autoChecking = false;

/** ¿Se puede sincronizar solo ahora? (sin interrumpir el trabajo de campo ni gastar datos móviles) */
export type AutoSyncReason = 'RED' | 'INTERVALO' | 'ARRANQUE' | 'PRIMER_PLANO' | 'CIERRE';

export async function maybeAutoSync(reason: AutoSyncReason): Promise<void> {
  if (!CONFIG.sync.autoSync || running || autoChecking) return;
  autoChecking = true;
  try {
    const s = useAppSession.getState();
    if (!s.booted || s.deviceRole !== 'CONTROLADOR' || s.status !== 'AUTENTICADO' || s.mode !== 'ONLINE') return;
    if (s.roleChoicePending) return;
    if (!canDoFieldWork(s.user?.roles)) return; // ADR 0009: el especialista no sincroniza (la plataforma respondería 403)
    if (await getCurrentSession(false)) return; // sesión de monitoreo abierta: no se compite con el trabajo de campo
    if (!(await hasDueItems(nowIso()))) return;
    if (CONFIG.sync.autoSyncWifiOnly && (await currentNetworkType()) !== 'WIFI') return;
    logEvent('INFO', 'SYNC', 'AUTO', { reason });
    await runSync({ trigger: 'AUTO' });
  } catch (err) {
    logError('sync.auto', err);
  } finally {
    autoChecking = false;
  }
}

export function startAutoSync(): void {
  if (autoTimer || !CONFIG.sync.autoSync) return;
  autoTimer = setInterval(() => {
    void maybeAutoSync('INTERVALO');
  }, CONFIG.sync.autoSyncIntervalMs);
}

export function stopAutoSync(): void {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
}

/** Tipos que PANT-20 muestra con nombre (los demás códigos van a messages.ts). */
export const ENTITY_ORDER: readonly SyncEntityType[] = [
  'SESSION',
  'PASS',
  'SEQUENCE_BATCH',
  'CAPTURE',
  'INCIDENT_BATCH',
  'SESSION_CLOSE',
];
