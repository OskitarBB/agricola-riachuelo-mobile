// __tests__/roleChange.test.ts — Elección de la función del celular después del login (ADR 0005).
// Prueba la decisión pura decideRoleChange (RN-15 en PANT-08) y la bandera roleChoicePending del store.

import { useAppSession } from '../src/auth/authStore';
import { decideRoleChange, type RoleChangeInput } from '../src/domain/rules';

const base: RoleChangeInput = {
  current: 'CONTROLADOR',
  target: 'CAMERA_1',
  hasOpenSession: false,
  pendingTransfers: 0,
  pendingSync: 0,
  syncAvailable: false,
};

describe('decideRoleChange (RN-15 en PANT-08)', () => {
  test('la misma función siempre se puede confirmar, incluso con una sesión abierta', () => {
    const d = decideRoleChange({ ...base, target: 'CONTROLADOR', hasOpenSession: true, pendingSync: 4 });
    expect(d).toEqual({ kind: 'SAME' });
  });

  test('primer uso: cualquier función, sin avisos', () => {
    for (const target of ['CONTROLADOR', 'CAMERA_1', 'CAMERA_2'] as const) {
      expect(decideRoleChange({ ...base, current: null, target })).toEqual({ kind: 'ALLOWED', warnings: [] });
    }
  });

  test('sin sesión ni pendientes se cambia libremente', () => {
    expect(decideRoleChange(base)).toEqual({ kind: 'ALLOWED', warnings: [] });
    expect(decideRoleChange({ ...base, current: 'CAMERA_1', target: 'CAMERA_2' })).toEqual({ kind: 'ALLOWED', warnings: [] });
  });

  test('una sesión de monitoreo abierta bloquea el cambio', () => {
    expect(decideRoleChange({ ...base, hasOpenSession: true })).toEqual({ kind: 'BLOCKED', code: 'CAMBIO_FUNCION_SESION_ABIERTA' });
    expect(decideRoleChange({ ...base, current: 'CAMERA_2', target: 'CONTROLADOR', hasOpenSession: true })).toEqual({
      kind: 'BLOCKED',
      code: 'CAMBIO_FUNCION_SESION_ABIERTA',
    });
  });

  test('fotos por enviar al controlador bloquean el cambio de una cámara', () => {
    expect(decideRoleChange({ ...base, current: 'CAMERA_1', target: 'CONTROLADOR', pendingTransfers: 3 })).toEqual({
      kind: 'BLOCKED',
      code: 'CAMBIO_FUNCION_FOTOS_PENDIENTES',
    });
  });

  test('cola de sincronización: solo avisa mientras la sincronización no exista (Fase 4)', () => {
    expect(decideRoleChange({ ...base, pendingSync: 12 })).toEqual({ kind: 'ALLOWED', warnings: ['SINCRONIZACION_PENDIENTE'] });
    expect(decideRoleChange({ ...base, pendingSync: 12, syncAvailable: true })).toEqual({
      kind: 'BLOCKED',
      code: 'CAMBIO_FUNCION_BLOQUEADO',
    });
  });
});

describe('roleChoicePending (PANT-08 después del login)', () => {
  test('se limpia al cerrar la sesión de usuario', () => {
    useAppSession.getState().set({ status: 'AUTENTICADO', roleChoicePending: true });
    expect(useAppSession.getState().roleChoicePending).toBe(true);
    useAppSession.getState().reset();
    expect(useAppSession.getState().roleChoicePending).toBe(false);
    expect(useAppSession.getState().status).toBe('SIN_SESION');
  });
});
