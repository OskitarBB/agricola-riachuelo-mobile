// src/sync/syncPlanner.ts — Qué elementos de sync_queue se pueden enviar ahora (funciones puras, maestro §15.5).
//
// QUÉ HACE: recibe los elementos de la cola (con su estado) y decide, sin tocar SQLite ni la red:
//  1) pickReadyItems(): los elementos LISTOS, en orden:
//     - estado PENDIENTE y, si se respeta la espera, next_attempt_at ya vencido (la sincronización automática respeta
//       las esperas; "Sincronizar ahora" las ignora porque el operador lo pidió);
//     - padres ya confirmados por el servidor (§15.5 paso 8: un CAPTURE nunca antes que su SESSION, PASS y
//       SEQUENCE_BATCH):
//         SESSION          siempre
//         PASS             SESSION hecha
//         SEQUENCE_BATCH   SESSION y su PASS hechos
//         CAPTURE          SESSION, su PASS y su SEQUENCE_BATCH hechos
//         INCIDENT_BATCH   SESSION hecha y ninguna PASS/SEQUENCE_BATCH de la sesión pendiente (las incidencias las citan)
//         SESSION_CLOSE    nada más de la sesión pendiente (un error definitivo no impide avisar el cierre al servidor)
//     - orden: sesión más antigua primero, luego order_key (10 → 60) e id.
//     Un padre "ausente" (sin elemento en la cola) no bloquea.
//  2) blockedItems(): los PENDIENTE que nunca podrán enviarse porque su padre quedó en ERROR_DEFINITIVO (o la captura
//     no tiene pasada). syncService los pasa a ERROR_DEFINITIVO con un código visible: si se quedaran PENDIENTE,
//     bloquearían para siempre el cierre (60) y el cambio de función del celular (RN-15).
//  3) parentsToRequeue(): qué padres reenviar ante SESSION_NOT_FOUND / PASS_NOT_FOUND / SEQUENCE_NOT_FOUND.
// Se prueba en __tests__/syncPlanner.test.ts.

import type { SyncEntityType, SyncItemStatus } from '../domain/syncQueue';

export interface PlannerItem {
  id: number;
  entityType: SyncEntityType;
  entityId: string;
  sessionId: string;
  orderKey: number;
  status: SyncItemStatus;
  nextAttemptAt: string;
  /** Pasada de la captura, o la propia pasada en PASS / SEQUENCE_BATCH. */
  passId: string | null;
}

const OPEN: readonly SyncItemStatus[] = ['PENDIENTE', 'EN_CURSO'];

interface SessionIndex {
  firstId: number;
  session: PlannerItem | null;
  pass: Map<string, PlannerItem>;
  seqBatch: Map<string, PlannerItem>;
  openStructural: boolean; // alguna PASS / SEQUENCE_BATCH pendiente
  openNonClose: boolean; // algo pendiente que no sea el cierre
}

function indexBySession(items: readonly PlannerItem[]): Map<string, SessionIndex> {
  const map = new Map<string, SessionIndex>();
  for (const it of items) {
    let s = map.get(it.sessionId);
    if (!s) {
      s = { firstId: it.id, session: null, pass: new Map(), seqBatch: new Map(), openStructural: false, openNonClose: false };
      map.set(it.sessionId, s);
    }
    s.firstId = Math.min(s.firstId, it.id);
    const open = OPEN.includes(it.status);
    if (it.entityType === 'SESSION') s.session = it;
    if (it.entityType === 'PASS') s.pass.set(it.entityId, it);
    if (it.entityType === 'SEQUENCE_BATCH') s.seqBatch.set(it.entityId, it);
    if (open && (it.entityType === 'PASS' || it.entityType === 'SEQUENCE_BATCH')) s.openStructural = true;
    if (open && it.entityType !== 'SESSION_CLOSE') s.openNonClose = true;
  }
  return map;
}

const done = (it: PlannerItem | null | undefined): boolean => !it || it.status === 'HECHO';
const failed = (it: PlannerItem | null | undefined): boolean => !!it && it.status === 'ERROR_DEFINITIVO';

/** ¿Los padres de este elemento ya están en el servidor? */
function parentsReady(it: PlannerItem, idx: SessionIndex): boolean {
  switch (it.entityType) {
    case 'SESSION':
      return true;
    case 'PASS':
      return done(idx.session);
    case 'SEQUENCE_BATCH':
      return done(idx.session) && done(idx.pass.get(it.entityId));
    case 'CAPTURE':
      return done(idx.session) && !!it.passId && done(idx.pass.get(it.passId)) && done(idx.seqBatch.get(it.passId));
    case 'INCIDENT_BATCH':
      return done(idx.session) && !idx.openStructural;
    case 'SESSION_CLOSE':
      // Se evalúa sin contarse a sí mismo: solo cuenta lo demás de la sesión.
      return done(idx.session) && !idx.openNonClose;
    default:
      return false;
  }
}

export function pickReadyItems<T extends PlannerItem>(items: readonly T[], opts: { nowIso: string; respectSchedule: boolean }): T[] {
  const idx = indexBySession(items);
  const ready = items.filter((it) => {
    if (it.status !== 'PENDIENTE') return false;
    if (opts.respectSchedule && it.nextAttemptAt > opts.nowIso) return false;
    const s = idx.get(it.sessionId);
    return !!s && parentsReady(it, s);
  });
  return ready.sort((a, b) => {
    const sa = idx.get(a.sessionId)?.firstId ?? 0;
    const sb = idx.get(b.sessionId)?.firstId ?? 0;
    return sa - sb || a.orderKey - b.orderKey || a.id - b.id;
  });
}

/** Código visible en PANT-20 de un elemento que no puede enviarse por culpa de su padre. */
export type BlockedCode = 'SESION_CON_ERROR' | 'PASADA_CON_ERROR' | 'SECUENCIAS_CON_ERROR' | 'CAPTURA_SIN_PASADA';

export function blockedItems<T extends PlannerItem>(items: readonly T[]): { item: T; code: BlockedCode }[] {
  const idx = indexBySession(items);
  const out: { item: T; code: BlockedCode }[] = [];
  for (const it of items) {
    if (it.status !== 'PENDIENTE' || it.entityType === 'SESSION') continue;
    const s = idx.get(it.sessionId);
    if (!s) continue;
    if (failed(s.session)) {
      out.push({ item: it, code: 'SESION_CON_ERROR' });
      continue;
    }
    if (it.entityType === 'SEQUENCE_BATCH' && failed(s.pass.get(it.entityId))) {
      out.push({ item: it, code: 'PASADA_CON_ERROR' });
    } else if (it.entityType === 'CAPTURE') {
      if (!it.passId) out.push({ item: it, code: 'CAPTURA_SIN_PASADA' });
      else if (failed(s.pass.get(it.passId))) out.push({ item: it, code: 'PASADA_CON_ERROR' });
      else if (failed(s.seqBatch.get(it.passId))) out.push({ item: it, code: 'SECUENCIAS_CON_ERROR' });
    }
  }
  return out;
}

/**
 * Padres que hay que reenviar cuando el servidor responde SESSION_NOT_FOUND / PASS_NOT_FOUND / SEQUENCE_NOT_FOUND.
 * Django revisa en ese orden (sesión → pasada → secuencia), así que PASS_NOT_FOUND implica que también faltan las
 * secuencias de esa pasada y SEQUENCE_NOT_FOUND implica que la pasada sí existe. Lista vacía = no se sabe cuál
 * (p. ej. el lote de incidencias): syncService reenvía todas las pasadas y secuencias de la sesión.
 */
export function parentsToRequeue(
  it: Pick<PlannerItem, 'entityType' | 'sessionId' | 'passId' | 'entityId'>,
  code: string | null,
): { type: SyncEntityType; entityId: string }[] {
  if (code === 'SESSION_NOT_FOUND') {
    // La sesión se reenvía (CLOSING) y, al final, también su cierre (CLOSED). Las pasadas y secuencias que falten se
    // reenvían cuando sus hijos reciban PASS_NOT_FOUND / SEQUENCE_NOT_FOUND (se resuelve en rondas).
    return [
      { type: 'SESSION', entityId: it.sessionId },
      { type: 'SESSION_CLOSE', entityId: it.sessionId },
    ];
  }
  const passId = it.entityType === 'PASS' || it.entityType === 'SEQUENCE_BATCH' ? it.entityId : it.passId;
  if (!passId) return [];
  const out: { type: SyncEntityType; entityId: string }[] = [];
  if (code === 'PASS_NOT_FOUND') {
    if (it.entityType !== 'PASS') out.push({ type: 'PASS', entityId: passId });
    if (it.entityType !== 'SEQUENCE_BATCH') out.push({ type: 'SEQUENCE_BATCH', entityId: passId });
  } else if (code === 'SEQUENCE_NOT_FOUND' && it.entityType !== 'SEQUENCE_BATCH') {
    out.push({ type: 'SEQUENCE_BATCH', entityId: passId });
  }
  return out;
}
