// src/sync/syncService.ts — Sincronización con Spring Boot (maestro §8.9 y §15.5). FASE 4 — PENDIENTE.
//
// PROPÓSITO FUTURO (T-20):
//  1. Comprobar GET /health; si falla, no hacer nada (la cola queda igual; la falta de red no cuenta como intento).
//  2. Exigir sesión de usuario ONLINE (si es OFFLINE, PANT-20 pide validar la contraseña con internet, 7.5)
//     y renovar el token si hace falta (authService.getAccessToken).
//  3. Procesar sync_queue por sesión y order_key: 10 SESSION → 20 PASS → 30 SEQUENCE_BATCH → 40 CAPTURE →
//     50 INCIDENT_BATCH → 60 SESSION_CLOSE, usando syncApi (idempotente por ID; lotes de sync.batchSize).
//  4. Fotos: File.upload multipart (una a la vez); en repeticiones, metadata.retakeContext sale de retake_requests.
//  5. Clasificar cada fallo con classifySyncError (src/sync/retry.ts): REINTENTAR con sync.retryDelaysMs,
//     RENOVAR_TOKEN, REQUIERE_LOGIN (pausar), SINCRONIZAR_PADRE (reencolar el padre), DEFINITIVO (visible en PANT-20).
//  6. Marcar SINCRONIZADO solo con confirmación del backend; la sesión pasa a SYNCED cuando todo está HECHO.
// La interfaz muestra "Pendiente" mientras esta función no esté implementada (contexto §25.5).

export type SyncRunResult = { ok: false; code: 'PENDIENTE' };

/** Punto de entrada que llamará PANT-20 ("Sincronizar ahora"). */
export async function runSync(): Promise<SyncRunResult> {
  return { ok: false, code: 'PENDIENTE' };
}

/** "Reintentar errores": ERROR_DEFINITIVO → PENDIENTE. Se implementa junto con runSync (Fase 4). */
export async function retrySyncErrors(): Promise<SyncRunResult> {
  return { ok: false, code: 'PENDIENTE' };
}
