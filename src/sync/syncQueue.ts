// src/sync/syncQueue.ts — Lectura de la cola de sincronización para PANT-20 (Fase 4).
//
// ESTADO ACTUAL: la cola YA se llena al cerrar cada sesión (sessionService.finalizeClose) y con las fotos
// tardías (consolidationService). Esta capa solo resume su contenido para la pantalla de sincronización.
// INTEGRACIÓN FUTURA (Fase 4, T-20): agregar aquí la selección de elementos listos (PENDIENTE con
// next_attempt_at vencido, por sesión y order_key) que consumirá syncService.

import { countPendingSync, summarizeBySession, type SyncSessionSummary } from '../storage/repositories/syncQueueRepo';

export type { SyncSessionSummary };

export async function syncSummary(): Promise<SyncSessionSummary[]> {
  return summarizeBySession();
}

export async function pendingSyncCount(): Promise<number> {
  return countPendingSync();
}
