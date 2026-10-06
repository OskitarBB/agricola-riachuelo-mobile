// tools/verificacion/simulado.ts — El motor de sincronización con el BACKEND SIMULADO de la app (modo demostración).
//
// QUÉ HACE: corre en Node el código real de src/ con EXPO_PUBLIC_USE_MOCK_API=1 (Django y Cloudinary simulados en
// memoria, src/api/mock) e inyecta fallos: ticket vencido, firma rechazada, Cloudinary caído, foto demasiado grande,
// errores 5xx al azar, sincronización automática solo con Wi-Fi, dos rondas a la vez y «Detener». No necesita
// servidor. Ver tools/verificacion/README.md.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

process.env.EXPO_PUBLIC_API_URL = '';
process.env.EXPO_PUBLIC_USE_MOCK_API = '1';
const WORK = path.join(os.tmpdir(), 'riachuelo-verificacion', 'simulado');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
process.env.RIACHUELO_SQLITE = path.join(WORK, 'app.sqlite');
process.env.RIACHUELO_ARCHIVOS = path.join(WORK, 'archivos');
(globalThis as Record<string, unknown>).__DEV__ = false;
const M = path.resolve(process.cwd(), 'src');

let passed = 0;
const failures: string[] = [];
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${err instanceof Error ? (err.stack ?? err.message).split('\n').slice(0, 4).join('\n      ') : String(err)}`);
  }
}

async function main() {
  const { openAppDb } = await import(`${M}/storage/db`);
  const { setIdProvider, newId } = await import(`${M}/domain/ids`);
  const Crypto = await import('expo-crypto');
  const { loadDeviceIdentity } = await import(`${M}/device/deviceIdentity`);
  const { useAppSession } = await import(`${M}/auth/authStore`);
  const auth = await import(`${M}/auth/authService`);
  const { updateCatalogs, catalogs } = await import(`${M}/controller/catalogService`);
  const sessionRepo = await import(`${M}/storage/repositories/sessionRepo`);
  const passRepo = await import(`${M}/storage/repositories/passRepo`);
  const seqRepo = await import(`${M}/storage/repositories/sequenceRepo`);
  const captureRepo = await import(`${M}/storage/repositories/captureRepo`);
  const queueRepo = await import(`${M}/storage/repositories/syncQueueRepo`);
  const { finalizeClose } = await import(`${M}/controller/sessionService`);
  const sync = await import(`${M}/sync/syncService`);
  const { capturePath } = await import(`${M}/storage/files`);
  const { ENV } = await import(`${M}/config`);
  const { setMockFailureRate } = await import(`${M}/api/mock/mockBackend`);
  const { setMockCloudinaryFailure } = await import(`${M}/api/mock/mockCloudinary`);
  const net = (await import('expo-network')) as unknown as { __state: { type: string } };

  console.log(`\nBackend simulado: useMockApi = ${ENV.useMockApi}\n`);
  assert.equal(ENV.useMockApi, true);
  await openAppDb();
  setIdProvider(() => Crypto.randomUUID());
  const identity = await loadDeviceIdentity();
  useAppSession.getState().set({ identity, deviceRole: 'CONTROLADOR', booted: true });

  let operatorId = '';
  let lotId = '', rowId = '', markerId = '';
  await step('login con la cuenta de prueba y catálogos simulados', async () => {
    const r = await auth.login('operador@demo.pe', 'Demo2026');
    assert.ok(r.ok, JSON.stringify(r));
    operatorId = useAppSession.getState().user!.id;
    const c = await updateCatalogs();
    assert.ok(c.ok, JSON.stringify(c));
    lotId = (await catalogs.lots())[0].id;
    rowId = (await catalogs.rows(lotId))[0].id;
    markerId = (await catalogs.markers(rowId))[0]?.id ?? null;
  });

  const now = () => new Date().toISOString();
  async function miniSession(photos = 1): Promise<{ sid: string; caps: string[] }> {
    const sid = newId();
    const t = now();
    await sessionRepo.insertSession({
      sessionId: sid, operatorUserId: operatorId, controllerDeviceId: identity.deviceId, status: 'CLOSING', mode: 'MANUAL',
      intervalMs: 4000, startedAt: t, endedAt: null, appVersion: '0.4.0', configVersion: 'CFG-4', qualityProfileVersion: 'Q0',
      pairingTokenHash: null, shortTestPassedAt: t, createdAt: t, updatedAt: t, remoteSyncStatus: 'PENDIENTE_NUBE',
    });
    const dev = newId();
    await sessionRepo.upsertSessionDevice({
      sessionId: sid, role: 'CAMERA_1', deviceId: dev, userId: operatorId, platform: 'android', model: 'Moto', osVersion: '14',
      appVersion: '0.4.0', pairedAt: t, lastSeenAt: t, linkStatus: 'DESCONECTADA', released: false, batteryLevel: 50,
      freeSpaceBytes: 1e9, pendingTransfers: 0, clockOffsetMs: null,
    });
    const passId = newId();
    await passRepo.insertPass({
      passId, sessionId: sid, lotId, rowId, lateralCode: 'LATERAL_A', passOrder: 1, direction: 'ASCENDENTE',
      startMarkerId: markerId, endMarkerId: null, currentSegmentId: null, currentMarkerId: null, status: 'COMPLETED',
      startedAt: t, endedAt: t, sequencesTotal: photos, sequencesComplete: photos, sequencesIncomplete: 0, remoteSyncStatus: 'PENDIENTE_NUBE',
    });
    const caps: string[] = [];
    for (let n = 1; n <= photos; n++) {
      const sequenceId = newId();
      const capId = newId();
      caps.push(capId);
      await seqRepo.insertSequence({
        sequenceId, passId, sessionId: sid, sequenceNumber: n, mode: 'MANUAL', status: 'PARTIAL', lotId, rowId, segmentId: null,
        markerId: null, gps: null, gpsAgeMs: null, issuedAt: t, expiresAt: t, completedAt: null,
        slots: {
          CAMERA_1: { role: 'CAMERA_1', captureId: capId, outcome: 'OK_RECIBIDA' },
          CAMERA_2: { role: 'CAMERA_2', captureId: newId(), outcome: 'SIN_RESPUESTA' },
        },
        remoteSyncStatus: 'PENDIENTE_NUBE',
      });
      const bytes = Buffer.from(`foto-${capId}-`.repeat(200));
      const file = capturePath(sid, passId, capId);
      file.write(bytes);
      await captureRepo.upsertCapture({
        captureId: capId, sequenceId, sessionId: sid, passId, lateralCode: 'LATERAL_A', isTest: false, deviceId: dev,
        cameraRole: 'CAMERA_1', userId: operatorId, capturedAt: t, filePath: file.uri, sizeBytes: bytes.length, width: 4000,
        height: 3000, md5: createHash('md5').update(bytes).digest('hex'), qualityStatus: 'UTILIZABLE', qualityProfileVersion: 'Q0',
        replacesCaptureId: null, localTransferStatus: 'RECIBIDA_CONTROLADOR', remoteSyncStatus: 'PENDIENTE_NUBE',
        transferAttempts: 1, syncAttempts: 0, lastError: null, fileDeletedAt: null,
      });
      await captureRepo.upsertQualityResult(capId, { status: 'UTILIZABLE', reasons: [], metrics: null, profileVersion: 'Q0' });
    }
    await finalizeClose((await sessionRepo.getSession(sid))!);
    return { sid, caps };
  }

  await step('sesión con 3 fotos: SINCRONIZADO y SYNCED con el backend simulado', async () => {
    const { sid } = await miniSession(3);
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'SINCRONIZADO', JSON.stringify(r));
    assert.equal(r.uploaded, 3);
    assert.equal((await sessionRepo.getSession(sid))?.status, 'SYNCED');
  });

  await step('Cloudinary: ticket vencido y firma rechazada se resuelven con un ticket nuevo en el mismo intento', async () => {
    const { sid } = await miniSession(2);
    setMockCloudinaryFailure('STALE', 1);
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'SINCRONIZADO', JSON.stringify(r));
    setMockCloudinaryFailure('INVALID_SIGNATURE', 1);
    const { sid: sid2 } = await miniSession(1);
    const r2 = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r2.code, 'SINCRONIZADO', JSON.stringify(r2));
    assert.equal((await sessionRepo.getSession(sid))?.status, 'SYNCED');
    assert.equal((await sessionRepo.getSession(sid2))?.status, 'SYNCED');
  });

  await step('Cloudinary no disponible 3 veces seguidas: la ronda se corta (SUBIDA_NUBE_FALLIDA) y queda en cola', async () => {
    const { sid } = await miniSession(4);
    setMockCloudinaryFailure('UNAVAILABLE', 3);
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'SUBIDA_NUBE_FALLIDA', JSON.stringify(r));
    assert.equal(r.retried, 3);
    assert.ok(r.remaining > 0);
    // La automática respeta la espera (1 min): no reintenta las 3 que fallaron; solo sube la que no se intentó.
    const auto = await sync.runSync({ trigger: 'AUTO' });
    assert.equal(auto.uploaded, 1, JSON.stringify(auto));
    assert.equal(auto.retried, 0, JSON.stringify(auto));
    assert.equal(auto.code, 'SINCRONIZACION_PARCIAL');
    // La manual no espera: termina.
    const r2 = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r2.code, 'SINCRONIZADO', JSON.stringify(r2));
    assert.equal((await sessionRepo.getSession(sid))?.status, 'SYNCED');
  });

  await step('foto demasiado grande para la nube: ERROR_DEFINITIVO FOTO_DEMASIADO_GRANDE (no se reintenta solo)', async () => {
    const { caps } = await miniSession(1);
    setMockCloudinaryFailure('TOO_LARGE', 1);
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'SINCRONIZACION_CON_ERRORES', JSON.stringify(r));
    const c = await captureRepo.getCapture(caps[0]);
    assert.equal(c?.remoteSyncStatus, 'ERROR_SINCRONIZACION');
    assert.equal(c?.lastError, 'FOTO_DEMASIADO_GRANDE');
    // «Reintentar errores» (ya sin el fallo inyectado): se sube.
    const r2 = await sync.retrySyncErrors();
    assert.equal(r2.code, 'SINCRONIZADO', JSON.stringify(r2));
  });

  await step('servidor con errores 5xx al azar: todo termina llegando en varias rondas', async () => {
    const { sid } = await miniSession(5);
    setMockFailureRate(0.4);
    let last = '';
    for (let i = 0; i < 25 && last !== 'SINCRONIZADO'; i++) last = (await sync.runSync({ trigger: 'MANUAL' })).code;
    setMockFailureRate(0);
    if (last !== 'SINCRONIZADO') last = (await sync.runSync({ trigger: 'MANUAL' })).code;
    assert.equal(last, 'SINCRONIZADO');
    assert.equal((await sessionRepo.getSession(sid))?.status, 'SYNCED');
  });

  await step('sincronización automática: solo con Wi-Fi y sin sesión de monitoreo abierta', async () => {
    useAppSession.getState().set({ roleChoicePending: false }); // ya pasó por PANT-08
    const { sid } = await miniSession(1);
    net.__state.type = 'CELLULAR';
    await sync.maybeAutoSync('RED');
    assert.equal((await sessionRepo.getSession(sid))?.status, 'CLOSED', 'con datos móviles no sincroniza solo');
    net.__state.type = 'WIFI';
    await sync.maybeAutoSync('RED');
    assert.equal((await sessionRepo.getSession(sid))?.status, 'SYNCED');
    assert.equal(await queueRepo.countPendingSync(), 0);
  });

  await step('dos rondas a la vez: la segunda responde SINCRONIZACION_EN_CURSO', async () => {
    await miniSession(2);
    const [a, b] = await Promise.all([sync.runSync({ trigger: 'MANUAL' }), sync.runSync({ trigger: 'MANUAL' })]);
    assert.deepEqual([a.code, b.code].sort(), ['SINCRONIZACION_EN_CURSO', 'SINCRONIZADO']);
  });

  await step('«Detener»: termina después del elemento en curso y lo demás queda en la cola', async () => {
    await miniSession(4);
    const p = sync.runSync({ trigger: 'MANUAL' });
    await new Promise((r) => setTimeout(r, 30));
    sync.stopSync();
    const r = await p;
    assert.equal(r.code, 'SINCRONIZACION_DETENIDA', JSON.stringify(r));
    assert.ok(r.remaining > 0);
    const r2 = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r2.code, 'SINCRONIZADO');
  });

  console.log(`\n${failures.length === 0 ? '✓' : '✗'} Backend simulado: ${passed} pasos OK, ${failures.length} con falla`);
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
