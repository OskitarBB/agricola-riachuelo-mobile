// __tests__/config.test.ts — Coherencia de la configuración CFG-2 (maestro §17: un cambio que rompa una regla no se acepta).

import { checkConfigCoherence, CONFIG_VERSION, DEFAULT_CONFIG } from '../src/config/defaults';

test('la configuración por defecto cumple todas las reglas de coherencia', () => {
  expect(checkConfigCoherence(DEFAULT_CONFIG)).toEqual([]);
  expect(CONFIG_VERSION).toBe('CFG-2');
});

test('detecta una espera de respuesta demasiado corta', () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  bad.protocol.captureResponseTimeoutMs = 3000;
  expect(checkConfigCoherence(bad).length).toBeGreaterThan(0);
});

test('los intervalos ofrecidos están dentro de los límites y no hay modo MIXTO', () => {
  const c = DEFAULT_CONFIG.capture;
  for (const v of c.intervalOptionsMs) {
    expect(v).toBeGreaterThanOrEqual(c.minIntervalMs);
    expect(v).toBeLessThanOrEqual(c.maxIntervalMs);
  }
  expect(['MANUAL', 'AUTOMATICO']).toContain(c.defaultMode);
});
