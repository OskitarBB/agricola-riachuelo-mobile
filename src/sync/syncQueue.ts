// src/sync/syncQueue.ts — Lectura de la cola de sincronización para PANT-20 y el panel del controlador (Fase 4).
//
// QUÉ HACE: resume sync_queue por sesión (total, enviados, pendientes, errores con su código, último intento) y, para
// las fotos, cuántas ya están en la nube, cuántas faltan confirmar en Django y cuántas tienen error (maestro PANT-20).
// La cola se llena al cerrar cada sesión (sessionService.finalizeClose), con las fotos tardías (consolidationService)
// y con incidencias nuevas en sesiones cerradas; la procesa src/sync/syncService.ts.

import type { SessionStatus } from '../domain/types';
import { getMetaJson } from '../storage/repositories/appMetaRepo';
import { countRemoteUploadsBySession, type RemoteUploadCounts } from '../storage/repositories/remoteUploadRepo';
import { getSession } from '../storage/repositories/sessionRepo';
import {
  countPendingSync,
  countSyncErrors,
  pendingCaptureBytes,
  summarizeBySession,
  type SyncSessionSummary,
} from '../storage/repositories/syncQueueRepo';
import type { SyncRunResult } from './syncStore';

export type { SyncSessionSummary };

export interface SyncSessionView extends SyncSessionSummary {
  sessionStatus: SessionStatus | null;
  startedAt: string | null;
  cloud: RemoteUploadCounts;
}

export interface SyncOverview {
  sessions: SyncSessionView[];
  pending: number;
  errors: number;
  pendingBytes: number;
  lastSync: SyncRunResult | null;
}

export async function syncSummary(): Promise<SyncSessionSummary[]> {
  return summarizeBySession();
}

export async function syncOverview(): Promise<SyncOverview> {
  const [summaries, cloud, pending, errors, pendingBytes, lastSync] = await Promise.all([
    summarizeBySession(),
    countRemoteUploadsBySession(),
    countPendingSync(),
    countSyncErrors(),
    pendingCaptureBytes(),
    getMetaJson<SyncRunResult>('last_sync'),
  ]);
  const sessions: SyncSessionView[] = [];
  for (const s of summaries) {
    const session = await getSession(s.sessionId);
    sessions.push({
      ...s,
      sessionStatus: session?.status ?? null,
      startedAt: session?.startedAt ?? session?.createdAt ?? null,
      cloud: cloud.get(s.sessionId) ?? { confirmed: 0, uploadedNotConfirmed: 0, discarded: 0 },
    });
  }
  return { sessions, pending, errors, pendingBytes, lastSync };
}

export async function pendingSyncCount(): Promise<number> {
  return countPendingSync();
}
