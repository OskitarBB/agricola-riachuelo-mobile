// __tests__/syncPlanner.test.ts — Orden y padres de la cola de sincronización (maestro v2.0 §15.5, Fase 4).

import { ORDER_KEY, type SyncEntityType, type SyncItemStatus } from '../src/domain/syncQueue';
import { blockedItems, parentsToRequeue, pickReadyItems, type PlannerItem } from '../src/sync/syncPlanner';

let nextId = 1;
const NOW = '2026-10-05T12:00:00.000Z';
const PAST = '2026-10-05T11:00:00.000Z';
const FUTURE = '2026-10-05T13:00:00.000Z';

function item(
  entityType: SyncEntityType,
  entityId: string,
  status: SyncItemStatus = 'PENDIENTE',
  extra: Partial<PlannerItem> = {},
): PlannerItem {
  return {
    id: nextId++,
    entityType,
    entityId,
    sessionId: extra.sessionId ?? 'S1',
    orderKey: ORDER_KEY[entityType],
    status,
    nextAttemptAt: extra.nextAttemptAt ?? PAST,
    passId: extra.passId ?? (entityType === 'PASS' || entityType === 'SEQUENCE_BATCH' ? entityId : null),
  };
}

/** Cola de una sesión recién cerrada: una pasada con dos fotos. */
function freshSession(sessionId = 'S1'): PlannerItem[] {
  return [
    item('SESSION', sessionId, 'PENDIENTE', { sessionId }),
    item('PASS', `${sessionId}-P1`, 'PENDIENTE', { sessionId }),
    item('SEQUENCE_BATCH', `${sessionId}-P1`, 'PENDIENTE', { sessionId }),
    item('CAPTURE', `${sessionId}-C1`, 'PENDIENTE', { sessionId, passId: `${sessionId}-P1` }),
    item('CAPTURE', `${sessionId}-C2`, 'PENDIENTE', { sessionId, passId: `${sessionId}-P1` }),
    item('INCIDENT_BATCH', sessionId, 'PENDIENTE', { sessionId }),
    item('SESSION_CLOSE', sessionId, 'PENDIENTE', { sessionId }),
  ];
}

const types = (list: PlannerItem[]) => list.map((i) => i.entityType);
const ready = (list: PlannerItem[], respectSchedule = false) => pickReadyItems(list, { nowIso: NOW, respectSchedule });
const setStatus = (list: PlannerItem[], type: SyncEntityType, status: SyncItemStatus) =>
  list.map((i) => (i.entityType === type ? { ...i, status } : i));

describe('pickReadyItems: padres antes que hijos (§15.5 paso 8)', () => {
  test('al principio solo la sesión (10) está lista', () => {
    expect(types(ready(freshSession()))).toEqual(['SESSION']);
  });

  test('con la sesión hecha sale la pasada; con la pasada, las secuencias; con ambas, las fotos', () => {
    let q = setStatus(freshSession(), 'SESSION', 'HECHO');
    expect(types(ready(q))).toEqual(['PASS']);
    q = setStatus(q, 'PASS', 'HECHO');
    expect(types(ready(q))).toEqual(['SEQUENCE_BATCH']);
    q = setStatus(q, 'SEQUENCE_BATCH', 'HECHO');
    expect(types(ready(q))).toEqual(['CAPTURE', 'CAPTURE', 'INCIDENT_BATCH']);
  });

  test('el cierre (60) espera a que no quede nada pendiente; un error definitivo no lo bloquea', () => {
    let q = setStatus(setStatus(setStatus(freshSession(), 'SESSION', 'HECHO'), 'PASS', 'HECHO'), 'SEQUENCE_BATCH', 'HECHO');
    q = setStatus(q, 'INCIDENT_BATCH', 'HECHO');
    expect(types(ready(q))).not.toContain('SESSION_CLOSE');
    q = q.map((i) => (i.entityId === 'S1-C1' ? { ...i, status: 'HECHO' as const } : i));
    q = q.map((i) => (i.entityId === 'S1-C2' ? { ...i, status: 'ERROR_DEFINITIVO' as const } : i));
    expect(types(ready(q))).toEqual(['SESSION_CLOSE']);
  });

  test('una foto EN_CURSO también bloquea el cierre', () => {
    let q = setStatus(setStatus(setStatus(freshSession(), 'SESSION', 'HECHO'), 'PASS', 'HECHO'), 'SEQUENCE_BATCH', 'HECHO');
    q = setStatus(q, 'INCIDENT_BATCH', 'HECHO');
    q = q.map((i) => (i.entityType === 'CAPTURE' ? { ...i, status: i.entityId === 'S1-C1' ? 'EN_CURSO' : 'HECHO' } : i));
    expect(ready(q)).toEqual([]);
  });

  test('las incidencias esperan a todas las pasadas y secuencias de la sesión', () => {
    const q = [...setStatus(freshSession(), 'SESSION', 'HECHO'), item('PASS', 'S1-P2'), item('SEQUENCE_BATCH', 'S1-P2')];
    expect(types(ready(q))).not.toContain('INCIDENT_BATCH');
  });

  test('foto tardía (8.13): pasada y secuencias reencoladas vuelven a ir antes que la foto', () => {
    const q = [
      item('SESSION', 'S1', 'HECHO'),
      item('PASS', 'S1-P1', 'PENDIENTE'),
      item('SEQUENCE_BATCH', 'S1-P1', 'PENDIENTE'),
      item('CAPTURE', 'S1-C9', 'PENDIENTE', { passId: 'S1-P1' }),
      item('INCIDENT_BATCH', 'S1', 'HECHO'),
      item('SESSION_CLOSE', 'S1', 'HECHO'),
    ];
    expect(types(ready(q))).toEqual(['PASS']);
  });

  test('la sincronización automática respeta la espera; la manual no', () => {
    const q = [item('SESSION', 'S1', 'PENDIENTE', { nextAttemptAt: FUTURE })];
    expect(ready(q, true)).toEqual([]);
    expect(types(ready(q, false))).toEqual(['SESSION']);
  });

  test('varias sesiones: primero la más antigua y, dentro de ella, por order_key', () => {
    const older = freshSession('A');
    const newer = freshSession('B');
    const q = [...setStatus(newer, 'SESSION', 'PENDIENTE'), ...setStatus(older, 'SESSION', 'HECHO')];
    // Los ids de A son menores (se crearon antes): A va primero aunque esté al final de la lista.
    const r = ready(q);
    expect(r.map((i) => `${i.sessionId}:${i.entityType}`)).toEqual(['A:PASS', 'B:SESSION']);
  });

  test('un padre sin elemento en la cola no bloquea', () => {
    const q = [item('SESSION', 'S1', 'HECHO'), item('CAPTURE', 'S1-C1', 'PENDIENTE', { passId: 'S1-P7' })];
    expect(types(ready(q))).toEqual(['CAPTURE']);
  });
});

describe('blockedItems: hijos de un padre con error definitivo', () => {
  test('sesión con error: todo lo demás queda bloqueado', () => {
    const q = setStatus(freshSession(), 'SESSION', 'ERROR_DEFINITIVO');
    const b = blockedItems(q);
    expect(b.length).toBe(6);
    expect(new Set(b.map((x) => x.code))).toEqual(new Set(['SESION_CON_ERROR']));
  });

  test('pasada con error: sus secuencias y sus fotos; las incidencias y el cierre siguen', () => {
    const q = setStatus(setStatus(freshSession(), 'SESSION', 'HECHO'), 'PASS', 'ERROR_DEFINITIVO');
    const b = blockedItems(q);
    expect(b.map((x) => `${x.item.entityType}:${x.code}`)).toEqual([
      'SEQUENCE_BATCH:PASADA_CON_ERROR',
      'CAPTURE:PASADA_CON_ERROR',
      'CAPTURE:PASADA_CON_ERROR',
    ]);
    // syncService pasa los bloqueados a error; entonces las incidencias pueden salir (citan solo lo que el servidor tiene).
    const blocked = new Set(b.map((x) => x.item.id));
    const after = q.map((i) => (blocked.has(i.id) ? { ...i, status: 'ERROR_DEFINITIVO' as const } : i));
    expect(types(ready(after))).toEqual(['INCIDENT_BATCH']);
  });

  test('secuencias con error: sus fotos; foto sin pasada: CAPTURA_SIN_PASADA', () => {
    let q = setStatus(setStatus(freshSession(), 'SESSION', 'HECHO'), 'PASS', 'HECHO');
    q = setStatus(q, 'SEQUENCE_BATCH', 'ERROR_DEFINITIVO');
    q.push(item('CAPTURE', 'S1-C3', 'PENDIENTE', { passId: null }));
    expect(blockedItems(q).map((x) => x.code)).toEqual(['SECUENCIAS_CON_ERROR', 'SECUENCIAS_CON_ERROR', 'CAPTURA_SIN_PASADA']);
  });

  test('sin errores no hay bloqueados', () => {
    expect(blockedItems(freshSession())).toEqual([]);
  });
});

describe('parentsToRequeue: SINCRONIZAR_PADRE', () => {
  const capture = { entityType: 'CAPTURE' as const, sessionId: 'S1', passId: 'P1', entityId: 'C1' };
  test('SESSION_NOT_FOUND reenvía la sesión y su cierre', () => {
    expect(parentsToRequeue(capture, 'SESSION_NOT_FOUND')).toEqual([
      { type: 'SESSION', entityId: 'S1' },
      { type: 'SESSION_CLOSE', entityId: 'S1' },
    ]);
  });
  test('PASS_NOT_FOUND reenvía la pasada y sus secuencias', () => {
    expect(parentsToRequeue(capture, 'PASS_NOT_FOUND')).toEqual([
      { type: 'PASS', entityId: 'P1' },
      { type: 'SEQUENCE_BATCH', entityId: 'P1' },
    ]);
    expect(parentsToRequeue({ entityType: 'SEQUENCE_BATCH', sessionId: 'S1', passId: 'P1', entityId: 'P1' }, 'PASS_NOT_FOUND')).toEqual([
      { type: 'PASS', entityId: 'P1' },
    ]);
  });
  test('SEQUENCE_NOT_FOUND reenvía solo las secuencias (la pasada existe)', () => {
    expect(parentsToRequeue(capture, 'SEQUENCE_NOT_FOUND')).toEqual([{ type: 'SEQUENCE_BATCH', entityId: 'P1' }]);
  });
  test('lote de incidencias: no se sabe qué pasada falta (lista vacía)', () => {
    expect(parentsToRequeue({ entityType: 'INCIDENT_BATCH', sessionId: 'S1', passId: null, entityId: 'S1' }, 'PASS_NOT_FOUND')).toEqual(
      [],
    );
  });
});
