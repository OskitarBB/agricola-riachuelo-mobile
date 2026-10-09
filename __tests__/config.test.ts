// __tests__/config.test.ts — Coherencia de la configuración CFG-8 (maestro §17: un cambio que rompa una regla no se acepta).

import { checkConfigCoherence, CONFIG_VERSION, DEFAULT_CONFIG } from '../src/config/defaults';

test('la configuración por defecto cumple todas las reglas de coherencia', () => {
  expect(checkConfigCoherence(DEFAULT_CONFIG)).toEqual([]);
  expect(CONFIG_VERSION).toBe('CFG-8');
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

test('CFG-6: JPEG con compresión (0,6–0,95) para que una foto de 12 MP no se acerque a los 10 MB', () => {
  expect(DEFAULT_CONFIG.capture.jpegQuality).toBeLessThan(1);
  const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  bad.capture.jpegQuality = 1;
  expect(checkConfigCoherence(bad).some((e) => e.includes('jpegQuality'))).toBe(true);
});

test('CFG-7: un solo umbral de batería (15 %) que solo avisa', () => {
  expect(DEFAULT_CONFIG.device.lowBatteryAlertPct).toBe(15);
  const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  bad.device.lowBatteryAlertPct = 0;
  expect(checkConfigCoherence(bad).some((e) => e.includes('lowBatteryAlertPct'))).toBe(true);
});

test('CFG-8: «Ubicar plaga» pide hasta 90 días y refresca sin pisar la espera de la petición', () => {
  const p = DEFAULT_CONFIG.pests;
  expect(p.windowDays).toBe(30);
  expect(p.requestTimeoutMs).toBeLessThan(p.autoRefreshMs);
  const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  bad.pests.windowDays = 120;
  expect(checkConfigCoherence(bad)).toContain('pests.windowDays fuera de 1–90 (límite del servidor)');
  bad.pests.windowDays = 30;
  bad.pests.autoRefreshMs = 10_000;
  expect(checkConfigCoherence(bad).length).toBeGreaterThan(0);
});
