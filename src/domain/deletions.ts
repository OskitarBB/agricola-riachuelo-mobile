// src/domain/deletions.ts — Limpieza de fotos ordenada por el administrador (plataforma v1.3.1; lógica pura).
//
// QUÉ HACE:
//  - isDeletionCode(): 410 SESSION_DELETED / CAPTURE_DELETED: lo que el celular intentaba sincronizar ya no existe en
//    el servidor porque el ADMINISTRADOR lo borró; no es un error: se borra la copia local y el elemento se cierra.
//  - isValidDeletionResponse(): forma mínima de GET /mobile/deleted-captures (una versión distinta no rompe nada).
//  - planPurge(): qué fotos y qué sesiones borrar localmente a partir de las respuestas (sin repetir).
// Las filas locales se conservan (RN-09): solo se borra el archivo de la foto y se marca file_deleted_at, y lo que
// estaba en la cola de sincronización se cierra para no volver a enviarlo.

import type { DeletedCapturesResponse } from '../api/dto';

export const DELETION_CODES = ['SESSION_DELETED', 'CAPTURE_DELETED'] as const;
export type DeletionCode = (typeof DELETION_CODES)[number];

export function isDeletionCode(code: string | null | undefined): code is DeletionCode {
  return !!code && (DELETION_CODES as readonly string[]).includes(code);
}

export function isValidDeletionResponse(d: unknown): d is DeletedCapturesResponse {
  if (!d || typeof d !== 'object') return false;
  const r = d as Partial<DeletedCapturesResponse>;
  return (
    Array.isArray(r.captures) &&
    r.captures.every((c) => !!c && typeof c.captureId === 'string' && typeof c.sessionId === 'string') &&
    Array.isArray(r.sessionIds) &&
    r.sessionIds.every((s) => typeof s === 'string') &&
    (r.cursor === null || typeof r.cursor === 'string') &&
    typeof r.hasMore === 'boolean'
  );
}

export interface PurgePlan {
  /** Sesiones borradas completas: se cierran todos sus elementos y se borran todas sus fotos. */
  sessionIds: string[];
  /** Fotos sueltas (de sesiones que siguen existiendo). */
  captureIds: string[];
}

export function planPurge(pages: readonly DeletedCapturesResponse[]): PurgePlan {
  const sessions = new Set<string>();
  for (const p of pages) for (const s of p.sessionIds) sessions.add(s);
  const captures = new Set<string>();
  for (const p of pages) for (const c of p.captures) if (!sessions.has(c.sessionId)) captures.add(c.captureId);
  return { sessionIds: [...sessions], captureIds: [...captures] };
}
