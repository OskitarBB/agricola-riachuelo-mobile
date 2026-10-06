// src/domain/syncQueue.ts — Tipos y orden de la cola de sincronización con la plataforma (maestro v2.0 §15.5).
//
// QUÉ HACE: define los tipos de elemento de sync_queue, sus estados y el order_key de cada tipo. Es puro (sin SQLite)
// para que el planificador (src/sync/syncPlanner.ts) y sus pruebas no dependan de la base de datos.

export type SyncEntityType = 'SESSION' | 'PASS' | 'SEQUENCE_BATCH' | 'CAPTURE' | 'INCIDENT_BATCH' | 'SESSION_CLOSE';
export type SyncItemStatus = 'PENDIENTE' | 'EN_CURSO' | 'HECHO' | 'ERROR_DEFINITIVO';

/** Orden de envío dentro de una sesión: 10 sesión → 20 pasada → 30 secuencias → 40 fotos → 50 incidencias → 60 cierre. */
export const ORDER_KEY: Record<SyncEntityType, number> = {
  SESSION: 10,
  PASS: 20,
  SEQUENCE_BATCH: 30,
  CAPTURE: 40,
  INCIDENT_BATCH: 50,
  SESSION_CLOSE: 60,
};
