// src/sync/syncStore.ts — Estado en memoria de la sincronización para PANT-20 y el panel del controlador (Zustand).
//
// QUÉ HACE: syncService.ts escribe aquí el avance de la ronda en curso (elemento actual, paso de la foto, bytes
// enviados a Cloudinary, conteos) y el resultado de la última ronda. Las pantallas solo LEEN este estado y vuelven a
// consultar el resumen de SQLite cuando cambia `tick`. La fuente de verdad sigue siendo sync_queue (SQLite).

import { create } from 'zustand';

import type { SyncEntityType } from '../storage/repositories/syncQueueRepo';

export type SyncTrigger = 'MANUAL' | 'AUTO';
export type SyncStep = 'TICKET' | 'SUBIDA' | 'CONFIRMACION';

/** Resultado de una ronda: código para el mensaje (src/ui/messages.ts) y conteos de lo que pasó. */
export interface SyncRunResult {
  ok: boolean;
  code: string;
  trigger: SyncTrigger;
  startedAt: string;
  finishedAt: string;
  /** Elementos confirmados por el servidor en esta ronda. */
  done: number;
  /** Elementos que vuelven a la cola con espera (red, servidor ocupado). */
  retried: number;
  /** Elementos que quedaron con error definitivo (revisión). */
  errors: number;
  /** Fotos subidas a Cloudinary en esta ronda. */
  uploaded: number;
  sessionsSynced: number;
  /** Elementos que siguen pendientes al terminar. */
  remaining: number;
}

export interface SyncProgressState {
  running: boolean;
  trigger: SyncTrigger | null;
  startedAt: string | null;
  /** Se pidió detener: termina al finalizar el elemento en curso. */
  stopping: boolean;
  current: { entityType: SyncEntityType; sessionId: string; step: SyncStep | null } | null;
  upload: { bytesSent: number; totalBytes: number } | null;
  done: number;
  retried: number;
  errors: number;
  uploaded: number;
  /** Pendientes al empezar (para la barra de avance). */
  totalAtStart: number;
  lastResult: SyncRunResult | null;
  /** Cambia con cada elemento procesado: PANT-20 vuelve a leer el resumen de SQLite. */
  tick: number;
  set(patch: Partial<Omit<SyncProgressState, 'set' | 'bump'>>): void;
  bump(): void;
}

export const useSyncStore = create<SyncProgressState>((set) => ({
  running: false,
  trigger: null,
  startedAt: null,
  stopping: false,
  current: null,
  upload: null,
  done: 0,
  retried: 0,
  errors: 0,
  uploaded: 0,
  totalAtStart: 0,
  lastResult: null,
  tick: 0,
  set: (patch) => set(patch),
  bump: () => set((s) => ({ tick: s.tick + 1 })),
}));
