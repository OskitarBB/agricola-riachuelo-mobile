// __tests__/domain.test.ts — Pruebas del dominio: transiciones, estado de secuencia, repetición y reglas.
// (Equivalente en Jest de las pruebas de referencia del maestro, Anexo E.1, más las reglas de CFG-2.)

import {
  AUTH_TRANSITIONS,
  canTransition,
  assertTransition,
  InvalidTransitionError,
  LOCAL_TRANSFER_TRANSITIONS,
  PASS_TRANSITIONS,
  REMOTE_SYNC_TRANSITIONS,
  SEQUENCE_TRANSITIONS,
  SESSION_TRANSITIONS,
  SLOT_TRANSITIONS,
} from '../src/domain/stateMachines';
import { applyRetake, deriveSequenceStatus, isRetakeable } from '../src/domain/sequence';
import {
  canChangeDeviceRole,
  canChangeMarker,
  canCreatePass,
  canIssueCommand,
  canLogout,
  canResumePass,
  canStartPass,
  isLateralRepeat,
  isRowCovered,
  median,
  nextPassOrder,
  validateSessionMode,
} from '../src/domain/rules';
import type { CameraRole, SequenceSlot, SlotOutcome } from '../src/domain/types';

const slots = (o1: SlotOutcome, o2: SlotOutcome): Record<CameraRole, SequenceSlot> => ({
  CAMERA_1: { role: 'CAMERA_1', captureId: 'c1', outcome: o1 },
  CAMERA_2: { role: 'CAMERA_2', captureId: 'c2', outcome: o2 },
});

describe('máquinas de estado', () => {
  test('transiciones válidas e inválidas de sesión', () => {
    expect(canTransition(SESSION_TRANSITIONS, 'DRAFT', 'PREPARING')).toBe(true);
    expect(canTransition(SESSION_TRANSITIONS, 'PREPARING', 'READY')).toBe(true);
    expect(canTransition(SESSION_TRANSITIONS, 'READY', 'ACTIVE')).toBe(true);
    expect(canTransition(SESSION_TRANSITIONS, 'CLOSED', 'SYNCED')).toBe(true);
    expect(canTransition(SESSION_TRANSITIONS, 'SYNCED', 'CLOSED')).toBe(true); // foto tardía (8.13)
    expect(canTransition(SESSION_TRANSITIONS, 'DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransition(SESSION_TRANSITIONS, 'CLOSED', 'ACTIVE')).toBe(false);
  });

  test('assertTransition lanza InvalidTransitionError', () => {
    expect(() => assertTransition('pasada', PASS_TRANSITIONS, 'COMPLETED', 'ACTIVE')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('pasada', PASS_TRANSITIONS, 'ACTIVE', 'PAUSED')).not.toThrow();
  });

  test('otras máquinas', () => {
    expect(canTransition(SEQUENCE_TRANSITIONS, 'INCOMPLETE', 'COMPLETE')).toBe(true);
    expect(canTransition(LOCAL_TRANSFER_TRANSITIONS, 'ERROR_LOCAL', 'PENDIENTE_LOCAL')).toBe(true);
    expect(canTransition(LOCAL_TRANSFER_TRANSITIONS, 'RECIBIDA_CONTROLADOR', 'PENDIENTE_LOCAL')).toBe(false);
    expect(canTransition(REMOTE_SYNC_TRANSITIONS, 'SINCRONIZADO', 'PENDIENTE_NUBE')).toBe(true);
    expect(canTransition(AUTH_TRANSITIONS, 'AUTENTICADO', 'SIN_SESION')).toBe(true);
  });

  test('todo cambio permitido de un resultado produce una transición de secuencia permitida', () => {
    const outcomes = Object.keys(SLOT_TRANSITIONS) as SlotOutcome[];
    for (const other of outcomes) {
      for (const from of outcomes) {
        for (const to of SLOT_TRANSITIONS[from]) {
          const before = deriveSequenceStatus(slots(from, other));
          const after = deriveSequenceStatus(slots(to, other));
          if (before !== after) expect(canTransition(SEQUENCE_TRANSITIONS, before, after)).toBe(true);
        }
      }
    }
  });
});

describe('estado de la secuencia (RN-06) y repetición (RN-07)', () => {
  test('deriveSequenceStatus', () => {
    expect(deriveSequenceStatus(slots('OK_RECIBIDA', 'OK_RECIBIDA'))).toBe('COMPLETE');
    expect(deriveSequenceStatus(slots('PENDIENTE', 'PENDIENTE'))).toBe('COMMAND_SENT');
    expect(deriveSequenceStatus(slots('OK_PENDIENTE_ARCHIVO', 'PENDIENTE'))).toBe('PARTIAL');
    expect(deriveSequenceStatus(slots('OK_RECIBIDA', 'RECHAZADA_CALIDAD'))).toBe('INCOMPLETE');
    expect(deriveSequenceStatus(slots('SIN_RESPUESTA', 'ERROR_CAMARA'))).toBe('INCOMPLETE');
    expect(deriveSequenceStatus(slots('OK_PENDIENTE_ARCHIVO', 'OK_RECIBIDA'))).toBe('PARTIAL');
  });

  test('applyRetake reemplaza solo el rol afectado y lo reabre', () => {
    const s = applyRetake(slots('OK_RECIBIDA', 'RECHAZADA_CALIDAD'), 'CAMERA_2', 'nuevo');
    expect(s.CAMERA_1).toEqual({ role: 'CAMERA_1', captureId: 'c1', outcome: 'OK_RECIBIDA' });
    expect(s.CAMERA_2).toEqual({ role: 'CAMERA_2', captureId: 'nuevo', outcome: 'PENDIENTE' });
    expect(deriveSequenceStatus(s)).toBe('PARTIAL');
  });

  test('isRetakeable', () => {
    expect(isRetakeable('RECHAZADA_CALIDAD')).toBe(true);
    expect(isRetakeable('SIN_RESPUESTA')).toBe(true);
    expect(isRetakeable('OK_RECIBIDA')).toBe(false);
  });
});

describe('reglas de negocio', () => {
  const links = { CAMERA_1: 'CONECTADA', CAMERA_2: 'CONECTADA' } as const;
  const healthy = [{ batteryPct: 90, freeSpaceBytes: 10e9 }];

  test('RN-10 inicio de pasada', () => {
    const base = {
      links,
      shortTestPassed: true,
      lotId: 'SWG1',
      rowId: 'SWG1-H01',
      lateral: 'LATERAL_A' as const,
      markerId: 'M1',
      devices: healthy,
      minBatteryPct: 30,
      minFreeSpaceBytes: 2e9,
    };
    expect(canStartPass(base)).toEqual({ ok: true });
    expect(canStartPass({ ...base, links: { CAMERA_1: 'CONECTADA', CAMERA_2: 'PERDIDA' } })).toEqual({
      ok: false,
      code: 'CAMARAS_NO_LISTAS',
    });
    expect(canStartPass({ ...base, shortTestPassed: false })).toEqual({ ok: false, code: 'PRUEBA_CORTA_PENDIENTE' });
    expect(canStartPass({ ...base, markerId: null })).toEqual({ ok: false, code: 'CONTEXTO_INCOMPLETO' });
    expect(canStartPass({ ...base, devices: [{ batteryPct: 10, freeSpaceBytes: null }] })).toEqual({
      ok: false,
      code: 'BATERIA_BAJA',
    });
  });

  test('RN-10 reanudación', () => {
    const base = { links, resyncInProgress: false, devices: healthy, pauseBatteryPct: 15, pauseFreeSpaceBytes: 1e9 };
    expect(canResumePass(base).ok).toBe(true);
    expect(canResumePass({ ...base, resyncInProgress: true })).toEqual({ ok: false, code: 'RESYNC_EN_CURSO' });
  });

  test('RN-11 nunca dos órdenes superpuestas', () => {
    expect(canIssueCommand(true)).toEqual({ ok: false, code: 'ORDEN_EN_CURSO' });
    expect(canIssueCommand(false)).toEqual({ ok: true });
  });

  test('RN-12 laterales, repetición y orden de pasadas', () => {
    const passes = [{ rowId: 'R1', lateralCode: 'LATERAL_A' as const, status: 'COMPLETED' as const, passOrder: 1 }];
    expect(canCreatePass([], 'R1', 'LATERAL_B')).toEqual({ ok: false, code: 'LATERAL_A_PENDIENTE' });
    expect(canCreatePass(passes, 'R1', 'LATERAL_B')).toEqual({ ok: true });
    expect(canCreatePass([{ ...passes[0], status: 'ACTIVE' }], 'R1', 'LATERAL_B')).toEqual({ ok: false, code: 'PASADA_ABIERTA' });
    expect(nextPassOrder(passes, 'R1')).toBe(2);
    expect(nextPassOrder(passes, 'R2')).toBe(1);
    expect(isLateralRepeat(passes, 'R1', 'LATERAL_A')).toBe(true);
    expect(isLateralRepeat(passes, 'R1', 'LATERAL_B')).toBe(false);
  });

  test('RN-13 hilera cubierta', () => {
    expect(
      isRowCovered([
        { lateralCode: 'LATERAL_A', status: 'COMPLETED' },
        { lateralCode: 'LATERAL_B', status: 'INCOMPLETE' },
      ]),
    ).toBe(true);
    expect(isRowCovered([{ lateralCode: 'LATERAL_A', status: 'COMPLETED' }])).toBe(false);
  });

  test('RN-15 y RN-19', () => {
    expect(canChangeDeviceRole(false, 0, 0).ok).toBe(true);
    expect(canChangeDeviceRole(true, 0, 0)).toEqual({ ok: false, code: 'CAMBIO_FUNCION_BLOQUEADO' });
    expect(canChangeDeviceRole(false, 2, 0).ok).toBe(false);
    expect(canLogout(true)).toEqual({ ok: false, code: 'SESION_ABIERTA_IMPIDE_SALIR' });
  });

  test('contexto §25.1: MANUAL ignora el intervalo; AUTOMÁTICO lo exige dentro de límites', () => {
    const lim = { minIntervalMs: 1000, maxIntervalMs: 10000 };
    expect(validateSessionMode('MANUAL', null, lim).ok).toBe(true);
    expect(validateSessionMode('AUTOMATICO', null, lim)).toEqual({ ok: false, code: 'INTERVALO_REQUERIDO' });
    expect(validateSessionMode('AUTOMATICO', 500, lim)).toEqual({ ok: false, code: 'INTERVALO_FUERA_DE_RANGO' });
    expect(validateSessionMode('AUTOMATICO', 2000, lim).ok).toBe(true);
  });

  test('contexto §25.2: cambio de marcador manual; en AUTOMÁTICO solo en pausa', () => {
    expect(canChangeMarker('MANUAL', 'ACTIVE', false).ok).toBe(true);
    expect(canChangeMarker('MANUAL', 'ACTIVE', true)).toEqual({ ok: false, code: 'ORDEN_EN_CURSO' });
    expect(canChangeMarker('AUTOMATICO', 'ACTIVE', false)).toEqual({ ok: false, code: 'PAUSA_REQUERIDA' });
    expect(canChangeMarker('AUTOMATICO', 'PAUSED', false).ok).toBe(true);
    expect(canChangeMarker('MANUAL', 'COMPLETED', false).ok).toBe(false);
  });

  test('mediana', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
