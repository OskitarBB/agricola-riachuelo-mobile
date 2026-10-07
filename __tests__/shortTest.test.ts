// __tests__/shortTest.test.ts — Decisión de la prueba corta (§14.12) y motivo de la reprobación (PANT-14).
import { decideShortTest, shortTestFailReason, type ShortTestObservation } from '../src/controller/shortTest';

const cfg = { captureResponseTimeoutMs: 8_000, shortTestTimeoutMs: 20_000 };
const obs = (o: Partial<ShortTestObservation>): ShortTestObservation => ({
  response: 'CAPTURE_OK',
  quality: 'UTILIZABLE',
  transferred: true,
  responseMs: 2_500,
  totalMs: 6_000,
  ...o,
});

describe('prueba corta', () => {
  it('foto útil que llega a tiempo: APROBADA, sin motivo', () => {
    expect(decideShortTest(obs({}), cfg)).toBe('APROBADA');
    expect(shortTestFailReason(obs({}), cfg, false)).toBeNull();
  });

  it('foto rechazada por calidad que llega: APROBADA_CALIDAD (la calidad no reprueba)', () => {
    const o = obs({ response: 'QUALITY_ERROR', quality: 'REPETIR_NITIDEZ' });
    expect(decideShortTest(o, cfg)).toBe('APROBADA_CALIDAD');
    expect(shortTestFailReason(o, cfg, false)).toBeNull();
  });

  it('todo bien pero lenta (primera prueba de campo, 18,5 s con 15 s): DEMASIADO_LENTA', () => {
    const o = obs({ totalMs: 18_500 });
    expect(decideShortTest(o, { ...cfg, shortTestTimeoutMs: 15_000 })).toBe('REPROBADA');
    expect(shortTestFailReason(o, { ...cfg, shortTestTimeoutMs: 15_000 }, true)).toBe('DEMASIADO_LENTA');
    expect(decideShortTest(o, cfg)).toBe('APROBADA'); // con el límite CFG-5 (20 s)
  });

  it('motivos: sin respuesta, error de cámara, respuesta lenta y foto que no llegó', () => {
    expect(shortTestFailReason(obs({ response: null, quality: null, transferred: false, responseMs: null, totalMs: null }), cfg, true)).toBe('SIN_RESPUESTA');
    expect(shortTestFailReason(obs({ response: 'QUALITY_ERROR', quality: 'ERROR_CAMARA', transferred: false }), cfg, false)).toBe('ERROR_CAMARA');
    expect(shortTestFailReason(obs({ responseMs: 9_000 }), cfg, false)).toBe('RESPUESTA_LENTA');
    expect(shortTestFailReason(obs({ transferred: false, totalMs: null }), cfg, true)).toBe('FOTO_NO_LLEGO');
    expect(shortTestFailReason(obs({ transferred: false, totalMs: null }), cfg, false)).toBeNull(); // todavía en curso
  });
});
