/** @jest-environment node */
// __tests__/auth.test.ts — Login sin internet (maestro Anexo C.1) y validación de formularios (Anexo C.2).

import { randomBytes } from 'node:crypto';

import {
  base64ToBytes,
  bytesToBase64,
  canAttemptOfflineLogin,
  createVerifier,
  type OfflineAuthRecord,
  registerFailedOfflineAttempt,
  registerSuccessfulOfflineLogin,
  verifyPassword,
} from '../src/auth/offlineAuth';
import {
  errorsByField,
  isValidEmail,
  validateChangePassword,
  validateLogin,
  validatePassword,
  validateRegistration,
} from '../src/auth/validation';

const rnd = (n: number) => new Uint8Array(randomBytes(n));
const CFG = { offlineLoginMaxDays: 7, offlineMaxFailedAttempts: 5, offlineLockoutMinutes: 15 };
const now = new Date('2026-10-02T12:00:00.000Z');
const record: OfflineAuthRecord = {
  userId: 'u1',
  email: 'operador@demo.pe',
  roles: ['OPERADOR_CAMPO'],
  accountStatus: 'ACTIVO',
  mustChangePassword: false,
  lastOnlineAuthAt: '2026-10-01T12:00:00.000Z',
  failedAttempts: 0,
  lockedUntil: null,
};

test('base64 ida y vuelta', () => {
  for (const len of [0, 1, 2, 3, 16, 32]) {
    const b = rnd(len);
    expect(Array.from(base64ToBytes(bytesToBase64(b)))).toEqual(Array.from(b));
  }
  expect(bytesToBase64(new TextEncoder().encode('Man'))).toBe('TWFu');
});

test('verificador PBKDF2: acepta la correcta y rechaza la incorrecta (correo normalizado)', async () => {
  const v = await createVerifier('Demo2026', { userId: 'u1', email: '  Operador@Demo.pe ' }, 1000, rnd);
  expect(v.email).toBe('operador@demo.pe');
  expect(JSON.stringify(v)).not.toContain('Demo2026');
  expect(await verifyPassword('Demo2026', v)).toBe(true);
  expect(await verifyPassword('demo2026', v)).toBe(false);
});

test('reglas previas: usuario, vencimiento, bloqueo, estado y cambio de contraseña', async () => {
  const v = await createVerifier('Demo2026', record, 1000, rnd);
  expect(canAttemptOfflineLogin(record, v, 'OPERADOR@demo.pe', now, CFG)).toEqual({ allowed: true });
  expect(canAttemptOfflineLogin(null, null, 'x@y.pe', now, CFG)).toEqual({ allowed: false, reason: 'SIN_VERIFICADOR' });
  expect(canAttemptOfflineLogin(record, v, 'otro@demo.pe', now, CFG).allowed).toBe(false);
  const old = { ...record, lastOnlineAuthAt: '2026-09-01T00:00:00.000Z' };
  expect(canAttemptOfflineLogin(old, v, record.email, now, CFG)).toMatchObject({ allowed: false, reason: 'VENCIDO' });
  expect(canAttemptOfflineLogin({ ...record, accountStatus: 'BLOQUEADO' }, v, record.email, now, CFG)).toMatchObject({
    reason: 'CUENTA_NO_ACTIVA',
  });
  expect(canAttemptOfflineLogin({ ...record, mustChangePassword: true }, v, record.email, now, CFG)).toMatchObject({
    reason: 'CAMBIO_CONTRASENA_PENDIENTE',
  });
});

test('5 intentos fallidos bloquean 15 minutos; un acierto limpia el contador', () => {
  let r = record;
  for (let i = 0; i < 4; i++) r = registerFailedOfflineAttempt(r, now, CFG);
  expect(r.failedAttempts).toBe(4);
  expect(r.lockedUntil).toBeNull();
  r = registerFailedOfflineAttempt(r, now, CFG);
  expect(r.lockedUntil).toBe('2026-10-02T12:15:00.000Z');
  expect(
    canAttemptOfflineLogin(
      r,
      { v: 1, userId: 'u1', email: record.email, saltB64: '', iterations: 1, hashB64: '' },
      record.email,
      now,
      CFG,
    ),
  ).toMatchObject({
    reason: 'BLOQUEADO_TEMPORAL',
  });
  expect(registerSuccessfulOfflineLogin(r)).toMatchObject({ failedAttempts: 0, lockedUntil: null });
});

test('validación de formularios', () => {
  expect(isValidEmail('operador@demo.pe')).toBe(true);
  expect(isValidEmail('operador@demo')).toBe(false);
  expect(validateLogin({ email: 'mal', password: '' }).map((e) => e.field)).toEqual(['email', 'password']);
  expect(validatePassword('corta1', 8)).not.toBeNull();
  expect(validatePassword('soloLetras', 8)).not.toBeNull();
  expect(validatePassword('Riachuelo2026', 8)).toBeNull();
  const reg = validateRegistration({ fullName: 'Ana', email: 'x', phone: '12', password: 'a', confirm: 'b', accepted: false }, 8);
  expect(Object.keys(errorsByField(reg)).sort()).toEqual(['accepted', 'confirm', 'email', 'fullName', 'password', 'phone']);
  expect(validateChangePassword({ current: 'Demo2026', next: 'Demo2026', confirm: 'Demo2026' }, 8)).toEqual([
    { field: 'next', message: 'Debe ser distinta de la actual.' },
  ]);
});
