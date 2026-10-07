// __tests__/config.test.ts — Coherencia de la configuración CFG-5 (maestro §17: un cambio que rompa una regla no se acepta).

import { checkConfigCoherence, CONFIG_VERSION, DEFAULT_CONFIG } from '../src/config/defaults';

test('la configuración por defecto cumple todas las reglas de coherencia', () => {
  expect(checkConfigCoherence(DEFAULT_CONFIG)).toEqual([]);
  expect(CONFIG_VERSION).toBe('CFG-5');
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

test('Fase 4 (v2.0): subida directa a Cloudinary y cola coherentes (Anexo E.8)', () => {
  const s = DEFAULT_CONFIG.sync;
  expect(s.uploadRequestTimeoutMs).toBeLessThan(s.ticketMinRemainingMs); // la subida termina antes de que venza el ticket
  expect(s.ticketMinRemainingMs).toBeLessThan(3_600_000); // la firma de Cloudinary vale 1 hora
  expect(s.maxUploadBytes).toBeLessThanOrEqual(10 * 1024 * 1024); // límite por imagen del plan Free
  expect(s.maxTicketRequests).toBeGreaterThanOrEqual(2);
  expect(s.maxReuploads).toBeGreaterThanOrEqual(1);
  expect(s.batchSize).toBeLessThanOrEqual(200); // el servidor acepta hasta 200 secuencias o incidencias por petición
  expect(s.maxConcurrent).toBe(1); // una foto a la vez (RNF-19)
  expect(['TICKET', 'MULTIPART']).toContain(s.uploadMode);
  expect(s.uploadMode).toBe('TICKET'); // v2.0 por defecto (Supuesto S-07)
});

test('Fase 4: una regla de subida rota se detecta', () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  bad.sync.uploadRequestTimeoutMs = bad.sync.ticketMinRemainingMs;
  bad.sync.batchSize = 500;
  expect(checkConfigCoherence(bad).length).toBe(2);
});
