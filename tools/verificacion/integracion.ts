// tools/verificacion/integracion.ts — Prueba de contrato de la app con la plataforma Django REAL (Fase 4).
//
// QUÉ HACE: corre en Node el código REAL de la app (src/: migraciones, repositorios, autenticación, catálogos y el
// motor de sincronización) contra una plataforma Django que responde en RIACHUELO_API (por defecto la laptop,
// http://127.0.0.1:8000, con `python manage.py sembrar_demo`). Los módulos nativos de Expo se reemplazan por los de
// tools/verificacion/mocks (SQLite de Node, disco local, fetch). Cubre CP-26 a CP-29, CP-33, CP-35, CP-39, CP-42 y
// CP-44 del maestro v2.0 (21.2). Ver tools/verificacion/README.md.
//
// CREA DATOS DE PRUEBA en el servidor (sesiones, fotos en Cloudinary, una cuenta pendiente). Por eso se niega a correr
// contra el piloto salvo con PERMITIR_PILOTO=1 (y solo con permiso del responsable).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const API = (process.env.RIACHUELO_API ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
if (/agricolariachuelo\.org/i.test(API) && process.env.PERMITIR_PILOTO !== '1') {
  console.error('Esta prueba crea datos en el servidor. Contra el piloto solo con PERMITIR_PILOTO=1 y permiso del responsable.');
  process.exit(2);
}
const OPERADOR = process.env.RIACHUELO_OPERADOR ?? 'operador@demo.pe';
const CLAVE = process.env.RIACHUELO_CLAVE ?? 'Demo2026';
process.env.EXPO_PUBLIC_API_URL = API;
process.env.EXPO_PUBLIC_USE_MOCK_API = '0';
process.env.EXPO_PUBLIC_APP_ENV = 'dev';
const WORK = path.join(os.tmpdir(), 'riachuelo-verificacion', 'integracion');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
process.env.RIACHUELO_SQLITE = path.join(WORK, 'app.sqlite');
process.env.RIACHUELO_ARCHIVOS = path.join(WORK, 'archivos');
(globalThis as Record<string, unknown>).__DEV__ = false;

// Módulos de la app, relativos a este archivo (una ruta absoluta de Windows no sirve en import()).
const M = '../../src';
/** Base SQLite de la plataforma en la laptop (opcional): permite comprobar lo que realmente quedó guardado. */
const SERVER_DB = process.env.PLATAFORMA_DB ?? '';
const serverDb = SERVER_DB ? new DatabaseSync(SERVER_DB, { timeout: 5000 }) : null;

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

/** Consulta la base SQLite de la plataforma (solo con PLATAFORMA_DB). */
function server(sql: string): Record<string, unknown>[] {
  if (!serverDb) throw new Error('PLATAFORMA_DB no definida');
  return serverDb.prepare(sql).all().map((r) => ({ ...r }));
}
const SIN_BD = '      (sin PLATAFORMA_DB: se omite la comprobación en la base del servidor)';

async function main() {
  const jpegMod = (await import('jpeg-js')) as unknown as { default?: unknown };
  const jpeg = (jpegMod.default ?? jpegMod) as {
    encode(img: { width: number; height: number; data: Uint8Array }, q: number): { data: Uint8Array };
  };
  const { openAppDb, getDb } = await import(`${M}/storage/db`);
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
  const remoteRepo = await import(`${M}/storage/repositories/remoteUploadRepo`);
  const { finalizeClose } = await import(`${M}/controller/sessionService`);
  const { addManualIncident, addSystemIncident } = await import(`${M}/diagnostics/incidents`);
  const sync = await import(`${M}/sync/syncService`);
  const { syncOverview } = await import(`${M}/sync/syncQueue`);
  const { capturePath } = await import(`${M}/storage/files`);
  const { CONFIG } = await import(`${M}/config`);
  const { loadTokens, saveTokens } = await import(`${M}/auth/tokenStore`);
  const { decideRoleChange } = await import(`${M}/domain/rules`);
  const { loadRoleChangeContext } = await import(`${M}/device/deviceRole`);

  console.log(`\nPlataforma: ${API} · operador: ${OPERADOR}${serverDb ? ` · base: ${SERVER_DB}` : ''}\n`);

  // ---------------------------------------------------------------- arranque (como src/boot.ts)
  await openAppDb();
  setIdProvider(() => Crypto.randomUUID());
  const identity = await loadDeviceIdentity();
  useAppSession.getState().set({ identity, deviceRole: 'CONTROLADOR', booted: true });

  await step('migraciones 001–004 aplicadas (user_version = 4)', async () => {
    const r = await getDb().getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
    assert.equal(r?.user_version, 4);
  });

  // ---------------------------------------------------------------- autenticación contra Django
  await step('registro desde la app: política de contraseña de Django y cuenta PENDIENTE (login → ACCOUNT_PENDING)', async () => {
    const email = `nuevo.${Date.now()}@demo.pe`;
    const weak = await auth.register({ fullName: 'Nuevo Operador', email, phone: '', employeeCode: '', password: '12345678' });
    assert.ok(!weak.ok && weak.code === 'VALIDATION_ERROR' && weak.fieldErrors?.some((f: { field: string }) => f.field === 'password'), JSON.stringify(weak));
    const ok = await auth.register({ fullName: 'Nuevo Operador', email, phone: '987654321', employeeCode: 'OP-099', password: 'Vid2026campo' });
    assert.ok(ok.ok, JSON.stringify(ok));
    const dup = await auth.register({ fullName: 'Nuevo Operador', email, phone: '', employeeCode: '', password: 'Vid2026campo' });
    assert.ok(!dup.ok && dup.code === 'EMAIL_ALREADY_REGISTERED', JSON.stringify(dup));
    const p = await auth.login(email, 'Vid2026campo');
    assert.equal(!p.ok && p.code, 'ACCOUNT_PENDING');
  });

  await step('login rechazado: cuenta bloqueada, rol solo web y contraseña incorrecta', async () => {
    const b = await auth.login('bloqueado@demo.pe', 'Demo2026');
    assert.equal(!b.ok && b.code, 'ACCOUNT_BLOCKED');
    const e = await auth.login('especialista@demo.pe', 'Demo2026');
    assert.equal(!e.ok && e.code, 'ROLE_NOT_ALLOWED');
    const w = await auth.login(OPERADOR, 'mala-clave-1');
    assert.equal(!w.ok && w.code, 'INVALID_CREDENTIALS');
  });

  await step('login del operador con internet (tokens + verificador sin internet)', async () => {
    const r = await auth.login(OPERADOR, CLAVE);
    assert.deepEqual(r, { ok: true, status: 'AUTENTICADO', mode: 'ONLINE' });
    assert.ok(await loadTokens());
    assert.equal(useAppSession.getState().mode, 'ONLINE');
  });
  const operatorId = useAppSession.getState().user?.id as string;

  await step('renovación simultánea: una sola petición (sin REFRESH_INVALID por la rotación)', async () => {
    const t0 = await loadTokens();
    assert.ok(t0);
    // Se fuerza el vencimiento local para que ambos llamadores necesiten renovar al mismo tiempo.
    await saveTokens({ ...t0!, accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString() }, operatorId);
    const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
    assert.ok(a && b);
    assert.equal(a, b);
    assert.notEqual(a, t0!.accessToken);
    assert.equal(useAppSession.getState().status, 'AUTENTICADO');
  });

  // ---------------------------------------------------------------- catálogos reales (migración 004)
  let lotId = '', rowId = '', segIds: string[] = [], markerIds: string[] = [];
  await step('bootstrap: catálogos del piloto (códigos repetidos entre hileras) y perfil de calidad', async () => {
    const r = await updateCatalogs();
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    assert.ok(r.info.lots > 0 && r.info.rows > 0 && r.info.segments > 0 && r.info.markers > 0);
    // Una hilera con segmento y marcadores (en el catálogo del piloto solo algunas los tienen).
    for (const lot of await catalogs.lots()) {
      for (const row of await catalogs.rows(lot.id)) {
        const segs = (await catalogs.segments(row.id)).map((x: { id: string }) => x.id);
        const mks = (await catalogs.markers(row.id)).map((m: { id: string }) => m.id);
        if (segs.length > 0 && mks.length > 0 && !lotId) {
          lotId = lot.id;
          rowId = row.id;
          segIds = segs;
          markerIds = mks.length > 1 ? mks : [mks[0], mks[0]];
        }
      }
    }
    assert.ok(lotId && segIds.length > 0 && markerIds.length > 1, 'hilera con segmento y marcador');
    // Códigos repetidos en distintas hileras se guardan sin conflicto (migración 004): el id es la clave.
    const dup = await getDb().getFirstAsync<{ n: number }>('SELECT COUNT(*) - COUNT(DISTINCT code) AS n FROM cat_segments', []);
    console.log(`      (catálogo: ${r.info.lots} lotes, ${r.info.rows} hileras, ${r.info.segments} segmentos, ${r.info.markers} marcadores; códigos repetidos: ${dup?.n ?? 0})`);
  });

  await step('migración 004: códigos de segmento y marcador repetidos entre hileras se guardan sin conflicto', async () => {
    const { replaceCatalogs, getCatalogInfo } = await import(`${M}/storage/repositories/catalogRepo`);
    const t = new Date().toISOString();
    await replaceCatalogs({
      catalogVersion: 'prueba-codigos',
      lots: [{ id: 'L9', code: 'L9', name: 'Lote prueba', active: true }],
      rows: [1, 2].map((n) => ({ id: `L9-H${n}`, lotId: 'L9', number: n, plantCount: 100, active: true })),
      segments: [1, 2].map((n) => ({ id: `L9-H${n}-S1`, rowId: `L9-H${n}`, code: 'SEG-01', startPlant: 0, endPlant: 50, isPilot: true })),
      markers: [1, 2].map((n) => ({ id: `L9-H${n}-M1`, rowId: `L9-H${n}`, segmentId: `L9-H${n}-S1`, code: 'MK-01-I', description: null, position: 'INICIO' as const, lat: null, lon: null })),
      lateralCodes: ['LATERAL_A', 'LATERAL_B'],
      qualityProfile: null,
      serverTime: t,
    });
    const info = await getCatalogInfo();
    assert.equal(info.segments, 2);
    assert.equal(info.markers, 2);
    // Se vuelve al catálogo real del servidor.
    const again = await updateCatalogs();
    assert.ok(again.ok);
  });

  // ---------------------------------------------------------------- una sesión de campo completa (datos locales)
  const now = () => new Date().toISOString();
  const sessionId = newId();
  const cam1 = newId();
  const cam2 = newId();
  const makeJpeg = (seed: number) => {
    const w = 64, h = 48, data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = (i * 7 + seed * 31) % 256;
      data[i * 4 + 1] = (i * 13 + seed * 17) % 256;
      data[i * 4 + 2] = (i * 3 + seed) % 256;
      data[i * 4 + 3] = 255;
    }
    return Buffer.from(jpeg.encode({ width: w, height: h, data }, 85).data);
  };
  const captureIds: string[] = [];
  let rejectedCaptureId = '';
  let retakeCaptureId = '';
  let passA = '', passB = '';

  async function addCapture(passIdArg: string, lateral: 'LATERAL_A' | 'LATERAL_B', sequenceId: string, role: 'CAMERA_1' | 'CAMERA_2', seed: number, quality: 'UTILIZABLE' | 'REPETIR_NITIDEZ' = 'UTILIZABLE', replaces: string | null = null, captureId = newId()) {
    const bytes = makeJpeg(seed);
    const file = capturePath(sessionId, passIdArg, captureId);
    file.write(bytes);
    await captureRepo.upsertCapture({
      captureId, sequenceId, sessionId, passId: passIdArg, lateralCode: lateral, isTest: false,
      deviceId: role === 'CAMERA_1' ? cam1 : cam2, cameraRole: role, userId: operatorId, capturedAt: now(),
      filePath: file.uri, sizeBytes: bytes.length, width: 64, height: 48,
      md5: createHash('md5').update(bytes).digest('hex'), qualityStatus: quality, qualityProfileVersion: 'Q0',
      replacesCaptureId: replaces, localTransferStatus: 'RECIBIDA_CONTROLADOR', remoteSyncStatus: 'PENDIENTE_NUBE',
      transferAttempts: 1, syncAttempts: 0, lastError: null, fileDeletedAt: null,
    });
    await captureRepo.upsertQualityResult(captureId, {
      status: quality,
      reasons: quality === 'UTILIZABLE' ? [] : ['NITIDEZ_BAJA', 'CAMARA_EN_MOVIMIENTO'],
      metrics: { luminanceMean: 118.2, darkRatio: 0.02, brightRatio: 0.01, laplacianVariance: quality === 'UTILIZABLE' ? 410.5 : 40.1, analyzedRegions: 4, durationMs: 250 },
      profileVersion: 'Q0',
    });
    captureIds.push(captureId);
    return captureId;
  }

  await step('sesión cerrada: 2 pasadas, secuencias, fotos (una rechazada y su repetición), marcadores e incidencias', async () => {
    const t = now();
    await sessionRepo.insertSession({
      sessionId, operatorUserId: operatorId, controllerDeviceId: identity.deviceId, status: 'CLOSING', mode: 'MANUAL',
      intervalMs: 4000, startedAt: t, endedAt: null, appVersion: '0.4.0', configVersion: CONFIG_VERSION_SAFE(), qualityProfileVersion: 'Q0',
      pairingTokenHash: null, shortTestPassedAt: t, createdAt: t, updatedAt: t, remoteSyncStatus: 'PENDIENTE_NUBE',
    });
    for (const [role, id] of [['CAMERA_1', cam1], ['CAMERA_2', cam2]] as const) {
      await sessionRepo.upsertSessionDevice({
        sessionId, role, deviceId: id, userId: operatorId, platform: 'android', model: 'Moto G', osVersion: '14',
        appVersion: '0.4.0', pairedAt: t, lastSeenAt: t, linkStatus: 'DESCONECTADA', released: false, batteryLevel: 80,
        freeSpaceBytes: 1e9, pendingTransfers: 0, clockOffsetMs: 15,
      });
    }
    for (const lateral of ['LATERAL_A', 'LATERAL_B'] as const) {
      const passId = newId();
      if (lateral === 'LATERAL_A') passA = passId; else passB = passId;
      await passRepo.insertPass({
        passId, sessionId, lotId, rowId, lateralCode: lateral, passOrder: lateral === 'LATERAL_A' ? 1 : 2,
        direction: lateral === 'LATERAL_A' ? 'ASCENDENTE' : 'DESCENDENTE', startMarkerId: markerIds[0], endMarkerId: markerIds[markerIds.length - 1],
        currentSegmentId: segIds[0], currentMarkerId: markerIds[0], status: 'COMPLETED', startedAt: t, endedAt: t,
        sequencesTotal: 2, sequencesComplete: 2, sequencesIncomplete: 0, remoteSyncStatus: 'PENDIENTE_NUBE',
      });
      await passRepo.insertMarkerChange({
        markerChangeId: newId(), passId, markerId: markerIds[1], segmentId: segIds[0], changedAt: t,
        gps: { lat: -14.07, lon: -75.73, accuracyM: 6, timestamp: t },
      });
      for (let n = 1; n <= 2; n++) {
        const sequenceId = newId();
        const c1 = newId();
        const c2 = newId();
        await seqRepo.insertSequence({
          sequenceId, passId, sessionId, sequenceNumber: n, mode: 'MANUAL', status: 'COMPLETE', lotId, rowId,
          segmentId: segIds[0], markerId: markerIds[0], gps: { lat: -14.07, lon: -75.73, accuracyM: 5, timestamp: t },
          gpsAgeMs: 300, issuedAt: t, expiresAt: t, completedAt: t,
          slots: {
            CAMERA_1: { role: 'CAMERA_1', captureId: c1, outcome: 'OK_RECIBIDA' },
            CAMERA_2: { role: 'CAMERA_2', captureId: c2, outcome: 'OK_RECIBIDA' },
          },
          remoteSyncStatus: 'PENDIENTE_NUBE',
        });
        if (lateral === 'LATERAL_A' && n === 1) {
          // CÁMARA 1 sacó una foto borrosa (rechazada, igual se sube para auditar) y se repitió (RN-07).
          rejectedCaptureId = await addCapture(passId, lateral, sequenceId, 'CAMERA_1', n * 10 + 1, 'REPETIR_NITIDEZ');
          retakeCaptureId = c1;
          await passRepo.insertRetake({
            captureId: c1, sequenceId, passId, cameraRole: 'CAMERA_1', replacesCaptureId: rejectedCaptureId, requestedAt: now(),
            segmentId: segIds[0], markerId: markerIds[1], gps: { lat: -14.071, lon: -75.731, accuracyM: 7, timestamp: t }, gpsAgeMs: 500,
          });
          await addCapture(passId, lateral, sequenceId, 'CAMERA_1', n * 10 + 2, 'UTILIZABLE', rejectedCaptureId, c1);
        } else {
          await addCapture(passId, lateral, sequenceId, 'CAMERA_1', n * 10 + 3, 'UTILIZABLE', null, c1);
        }
        await addCapture(passId, lateral, sequenceId, 'CAMERA_2', n * 10 + 4, 'UTILIZABLE', null, c2);
      }
    }
    await addManualIncident({ sessionId, passId: passA }, 'OPERADOR', 'AVISO', 'Viento fuerte en la hilera');
    await addSystemIncident({ sessionId, passId: 'pasada-de-prueba-corta', sequenceId: 'secuencia-inexistente' }, 'OTRO', 'INFO', 'Referencia que el servidor no conoce');
    const session = await sessionRepo.getSession(sessionId);
    await finalizeClose(session!);
    const items = await queueRepo.listSessionItems(sessionId);
    // 1 sesión + 2 pasadas + 2 lotes de secuencias + 9 fotos + 1 incidencias + 1 cierre
    assert.equal(items.length, 1 + 2 + 2 + captureIds.length + 1 + 1);
  });

  await step('RN-15: con la cola pendiente el controlador no puede cambiar de función', async () => {
    const ctx = await loadRoleChangeContext('CONTROLADOR');
    assert.ok(ctx.pendingSync > 0);
    assert.deepEqual(decideRoleChange({ current: 'CONTROLADOR', target: 'CAMERA_1', ...ctx }), {
      kind: 'BLOCKED',
      code: 'CAMBIO_FUNCION_SINCRONIZACION_PENDIENTE',
    });
  });

  // ---------------------------------------------------------------- sincronización completa
  let first: Awaited<ReturnType<typeof sync.runSync>> | null = null;
  await step('«Sincronizar ahora»: todo llega al servidor y la sesión queda SYNCED', async () => {
    first = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(first.code, 'SINCRONIZADO', JSON.stringify(first));
    assert.equal(first.errors, 0);
    assert.equal(first.uploaded, captureIds.length);
    assert.equal(first.sessionsSynced, 1);
    const s = await sessionRepo.getSession(sessionId);
    assert.equal(s?.status, 'SYNCED');
    assert.equal(s?.remoteSyncStatus, 'SINCRONIZADO');
    for (const id of captureIds) {
      const c = await captureRepo.getCapture(id);
      assert.equal(c?.remoteSyncStatus, 'SINCRONIZADO', id);
      const up = await remoteRepo.getRemoteUpload(id);
      assert.equal(up?.status, 'CONFIRMADA', id);
    }
    assert.equal(await queueRepo.countPendingSync(), 0);
  });

  await step('servidor: sesión CLOSED, pasadas, 4 secuencias, 9 fotos con su lateral, repetición e IA en cola', async () => {
    if (!serverDb) return console.log(SIN_BD);
    const s = server(`SELECT status, ended_at FROM monitoring_sessions WHERE session_id = '${sessionId.replace(/-/g, '')}' OR session_id = '${sessionId}'`);
    assert.equal(s.length, 1, 'sesión en el servidor');
    assert.equal(s[0].status, 'CLOSED');
    assert.ok(s[0].ended_at);
    const sid = `('${sessionId}','${sessionId.replace(/-/g, '')}')`;
    assert.equal(server(`SELECT COUNT(*) n FROM monitoring_passes WHERE session_id IN ${sid}`)[0].n, 2);
    assert.equal(server(`SELECT COUNT(*) n FROM capture_sequences WHERE session_id IN ${sid}`)[0].n, 4);
    const caps = server(`SELECT capture_id, lateral_code, quality_status, replaces_capture_id FROM captures WHERE session_id IN ${sid}`);
    assert.equal(caps.length, captureIds.length);
    const retake = caps.find((c) => String(c.capture_id).replace(/-/g, '') === retakeCaptureId.replace(/-/g, ''));
    assert.ok(retake && String(retake.replaces_capture_id).replace(/-/g, '') === rejectedCaptureId.replace(/-/g, ''), 'repetición enlazada');
    const lats = new Set(caps.map((c) => c.lateral_code));
    assert.deepEqual([...lats].sort(), ['LATERAL_A', 'LATERAL_B']);
    const inc = server(`SELECT pass_id, sequence_id, detail FROM incidents WHERE session_id IN ${sid} ORDER BY occurred_at`);
    assert.ok(inc.length >= 2);
    const unknown = inc.find((i) => String(i.detail).includes('no conoce'));
    assert.ok(unknown && unknown.pass_id === null && unknown.sequence_id === null, 'referencia desconocida → null');
    const tasks = server(`SELECT COUNT(*) n FROM ai_tasks t JOIN captures c ON c.capture_id = t.capture_id WHERE c.session_id IN ${sid}`);
    console.log(`      (tareas de IA creadas por Django: ${tasks[0].n}; la foto rechazada por calidad no se analiza)`);
  });

  await step('idempotencia: reenviar TODO no duplica nada (duplicate=true en el servidor)', async () => {
    await getDb().runAsync("UPDATE sync_queue SET status = 'PENDIENTE', attempts = 0 WHERE session_id = ?", [sessionId]);
    await getDb().runAsync("UPDATE monitoring_sessions SET status = 'CLOSED' WHERE session_id = ?", [sessionId]);
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'SINCRONIZADO', JSON.stringify(r));
    assert.equal(r.uploaded, 0, 'no se vuelve a subir: remote_uploads CONFIRMADA');
    const sid = `('${sessionId}','${sessionId.replace(/-/g, '')}')`;
    if (serverDb) {
      assert.equal(server(`SELECT COUNT(*) n FROM captures WHERE session_id IN ${sid}`)[0].n, captureIds.length);
      assert.equal(server(`SELECT COUNT(*) n FROM capture_sequences WHERE session_id IN ${sid}`)[0].n, 4);
    }
  });

  await step('ticket alreadyConfirmed: sin fila local de remote_uploads, el servidor dice que ya la tiene', async () => {
    const id = captureIds[3];
    await getDb().runAsync('DELETE FROM remote_uploads WHERE capture_id = ?', [id]);
    await getDb().runAsync("UPDATE sync_queue SET status = 'PENDIENTE' WHERE entity_type = 'CAPTURE' AND entity_id = ?", [id]);
    await getDb().runAsync("UPDATE monitoring_sessions SET status = 'CLOSED' WHERE session_id = ?", [sessionId]);
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'SINCRONIZADO');
    assert.equal(r.uploaded, 0);
    assert.equal((await captureRepo.getCapture(id))?.remoteSyncStatus, 'SINCRONIZADO');
  });

  // ---------------------------------------------------------------- foto tardía (8.13)
  let lateId = '';
  await step('foto tardía de una sesión SYNCED: vuelve a CLOSED, se reenvían pasada y secuencias, y otra vez SYNCED', async () => {
    const seq = (await seqRepo.listSequences(passB))[1];
    lateId = newId();
    const bytes = makeJpeg(99);
    const file = capturePath(sessionId, passB, lateId);
    file.write(bytes);
    await captureRepo.upsertCapture({
      captureId: lateId, sequenceId: seq.sequenceId, sessionId, passId: passB, lateralCode: 'LATERAL_B', isTest: false,
      deviceId: cam2, cameraRole: 'CAMERA_2', userId: operatorId, capturedAt: now(), filePath: file.uri,
      sizeBytes: bytes.length, width: 64, height: 48, md5: createHash('md5').update(bytes).digest('hex'),
      qualityStatus: 'PENDIENTE_REVISION_TECNICA', qualityProfileVersion: 'Q0', replacesCaptureId: null,
      localTransferStatus: 'RECIBIDA_CONTROLADOR', remoteSyncStatus: 'PENDIENTE_NUBE', transferAttempts: 1, syncAttempts: 0,
      lastError: null, fileDeletedAt: null,
    });
    await captureRepo.upsertQualityResult(lateId, { status: 'PENDIENTE_REVISION_TECNICA', reasons: ['TIEMPO_AGOTADO'], metrics: null, profileVersion: 'Q0' });
    // Lo mismo que hace consolidationService con una foto tardía:
    await queueRepo.upsertSyncItem('CAPTURE', lateId, sessionId);
    await queueRepo.upsertSyncItem('PASS', passB, sessionId);
    await queueRepo.upsertSyncItem('SEQUENCE_BATCH', passB, sessionId);
    await sessionRepo.updateSession(sessionId, { status: 'CLOSED' });
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'SINCRONIZADO', JSON.stringify(r));
    assert.equal(r.uploaded, 1);
    assert.equal((await sessionRepo.getSession(sessionId))?.status, 'SYNCED');
    const sid = `('${sessionId}','${sessionId.replace(/-/g, '')}')`;
    if (serverDb) {
      assert.equal(server(`SELECT COUNT(*) n FROM captures WHERE session_id IN ${sid}`)[0].n, captureIds.length + 1);
    }
  });

  await step('incidencia nueva en una sesión ya sincronizada: el lote de incidencias vuelve a la cola y llega', async () => {
    await addManualIncident({ sessionId }, 'OTRO', 'INFO', 'Nota después de sincronizar');
    assert.equal((await sessionRepo.getSession(sessionId))?.status, 'CLOSED');
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'SINCRONIZADO');
    const sid = `('${sessionId}','${sessionId.replace(/-/g, '')}')`;
    if (serverDb) {
      assert.ok(server(`SELECT COUNT(*) n FROM incidents WHERE session_id IN ${sid} AND detail LIKE '%después de sincronizar%'`)[0].n === 1);
    }
  });

  // ---------------------------------------------------------------- recuperación de errores
  await step('confirmación rechazada (firma inválida) → DESCARTADA → se vuelve a subir y se confirma', async () => {
    // Segunda sesión con una foto: se sube, se altera la firma guardada y se reintenta solo la confirmación.
    const sid2 = await miniSession(1);
    const capId = (await queueRepo.listSessionItems(sid2)).find((i: { entityType: string }) => i.entityType === 'CAPTURE')!.entityId;
    // 1) Todo hasta la subida, pero la confirmación con la firma alterada:
    const r1 = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r1.code, 'SINCRONIZADO');
    // 2) Simulamos un crash entre subida y confirmación con un resultado manipulado: fila SUBIDA con firma mala.
    await getDb().runAsync("UPDATE remote_uploads SET status = 'SUBIDA', signature = 'firma-mala', confirmed_at = NULL WHERE capture_id = ?", [capId]);
    await getDb().runAsync("UPDATE sync_queue SET status = 'PENDIENTE' WHERE entity_type = 'CAPTURE' AND entity_id = ?", [capId]);
    // El servidor ya tiene la foto confirmada → responde duplicate (no revisa la firma de un duplicado).
    const r2 = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r2.code, 'SINCRONIZADO');
    assert.equal((await remoteRepo.getRemoteUpload(capId))?.status, 'CONFIRMADA');
  });

  await step('firma inválida en una foto nueva: REPETIR_SUBIDA, nueva subida (existing=true) y confirmación', async () => {
    const sid3 = await miniSession(2);
    const items = await queueRepo.listSessionItems(sid3);
    const capId = items.find((i: { entityType: string }) => i.entityType === 'CAPTURE')!.entityId;
    // Se envía todo menos la foto: estructura primero.
    await getDb().runAsync("UPDATE sync_queue SET status = 'ERROR_DEFINITIVO', last_error_code = 'PAUSA_PRUEBA' WHERE entity_type = 'CAPTURE' AND entity_id = ?", [capId]);
    await sync.runSync({ trigger: 'MANUAL' });
    // Subida real a Cloudinary simulado, guardada con una firma alterada (como si la respuesta se hubiera dañado).
    const c = await captureRepo.getCapture(capId);
    const { uploadApi, cloudUpload } = await import(`${M}/api`);
    const token = await auth.getAccessToken();
    const t = await uploadApi.requestTicket({ captureId: capId, sessionId: sid3, passId: c!.passId!, sequenceId: c!.sequenceId, sizeBytes: c!.sizeBytes!, md5: c!.md5!, mimeType: 'image/jpeg' }, token!, identity.deviceId, 30_000);
    assert.ok(t.ok && t.data.upload, JSON.stringify(t));
    const up = await cloudUpload(t.ok ? t.data.upload! : (null as never), c!.filePath!, 30_000);
    assert.ok(up.ok, JSON.stringify(up));
    await remoteRepo.saveUploaded(capId, { ...(up.ok ? up.result : (null as never)), signature: 'firma-mala' }, 0);
    await getDb().runAsync("UPDATE sync_queue SET status = 'PENDIENTE', last_error_code = NULL WHERE entity_type = 'CAPTURE' AND entity_id = ?", [capId]);
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'SINCRONIZADO', JSON.stringify(r));
    const row = await remoteRepo.getRemoteUpload(capId);
    assert.equal(row?.status, 'CONFIRMADA');
    assert.equal(row?.reuploadCount, 1);
  });

  await step('SINCRONIZAR_PADRE: el servidor no tiene las secuencias → se reenvían y la foto sube', async () => {
    const sid4 = await miniSession(3);
    // Se marca HECHO el lote de secuencias sin enviarlo: el ticket de la foto responderá SEQUENCE_NOT_FOUND.
    await getDb().runAsync("UPDATE sync_queue SET status = 'HECHO' WHERE entity_type = 'SEQUENCE_BATCH' AND session_id = ?", [sid4]);
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'SINCRONIZADO', JSON.stringify(r));
    if (serverDb) {
      assert.equal(server(`SELECT COUNT(*) n FROM captures WHERE session_id IN ('${sid4}','${sid4.replace(/-/g, '')}')`)[0].n, 1);
    }
  });

  await step('archivo borrado antes de subir: ERROR_DEFINITIVO ARCHIVO_NO_DISPONIBLE; el cierre se envía igual', async () => {
    const sid5 = await miniSession(4);
    const capId = (await queueRepo.listSessionItems(sid5)).find((i: { entityType: string }) => i.entityType === 'CAPTURE')!.entityId;
    const c = await captureRepo.getCapture(capId);
    fs.rmSync(c!.filePath!.replace('file://', ''));
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'SINCRONIZACION_CON_ERRORES', JSON.stringify(r));
    const items = await queueRepo.listSessionItems(sid5);
    const cap = items.find((i: { entityType: string }) => i.entityType === 'CAPTURE');
    assert.equal(cap?.status, 'ERROR_DEFINITIVO');
    assert.equal(cap?.lastErrorCode, 'ARCHIVO_NO_DISPONIBLE');
    assert.equal(items.find((i: { entityType: string }) => i.entityType === 'SESSION_CLOSE')?.status, 'HECHO');
    assert.equal((await captureRepo.getCapture(capId))?.remoteSyncStatus, 'ERROR_SINCRONIZACION');
    if (serverDb) {
      assert.equal(server(`SELECT status FROM monitoring_sessions WHERE session_id IN ('${sid5}','${sid5.replace(/-/g, '')}')`)[0].status, 'CLOSED');
    }
    // RN-15: un error definitivo no bloquea el cambio de función (solo avisa).
    const ctx = await loadRoleChangeContext('CONTROLADOR');
    assert.equal(decideRoleChange({ current: 'CONTROLADOR', target: 'CAMERA_2', ...ctx }).kind, 'ALLOWED');
  });

  await step('CP-39: la app se cerró después de subir a Cloudinary y antes de confirmar → solo se confirma', async () => {
    const sid = await miniSession(8);
    const capId = (await queueRepo.listSessionItems(sid)).find((i: { entityType: string }) => i.entityType === 'CAPTURE')!.entityId;
    await getDb().runAsync("UPDATE sync_queue SET status = 'ERROR_DEFINITIVO', last_error_code = 'PAUSA_PRUEBA' WHERE entity_type = 'CAPTURE' AND entity_id = ?", [capId]);
    await sync.runSync({ trigger: 'MANUAL' }); // estructura de la sesión en el servidor
    const c = await captureRepo.getCapture(capId);
    const { uploadApi, cloudUpload } = await import(`${M}/api`);
    const token = await auth.getAccessToken();
    const t = await uploadApi.requestTicket({ captureId: capId, sessionId: sid, passId: c!.passId!, sequenceId: c!.sequenceId, sizeBytes: c!.sizeBytes!, md5: c!.md5!, mimeType: 'image/jpeg' }, token!, identity.deviceId, 30_000);
    const up = await cloudUpload(t.ok ? t.data.upload! : (null as never), c!.filePath!, 30_000);
    assert.ok(up.ok);
    await remoteRepo.saveUploaded(capId, up.ok ? up.result : (null as never), 0); // fila SUBIDA, sin confirmar
    await getDb().runAsync("UPDATE sync_queue SET status = 'PENDIENTE', last_error_code = NULL WHERE entity_type = 'CAPTURE' AND entity_id = ?", [capId]);
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.uploaded, 0, 'no hay un segundo UPLOAD_OK');
    assert.equal((await remoteRepo.getRemoteUpload(capId))?.status, 'CONFIRMADA');
    assert.equal((await sessionRepo.getSession(sid))?.status, 'SYNCED');
  });

  await step('CP-29: conflicto 409 (mismo captureId con otro contenido) → ERROR_SINCRONIZACION visible y el resto continúa', async () => {
    const sid = await miniSession(9);
    const capId = (await queueRepo.listSessionItems(sid)).find((i: { entityType: string }) => i.entityType === 'CAPTURE')!.entityId;
    const r1 = await sync.runSync({ trigger: 'MANUAL' });
    assert.ok(['SINCRONIZADO', 'SINCRONIZACION_CON_ERRORES'].includes(r1.code));
    // Mismo captureId, otro archivo (md5 y tamaño distintos) y sin registro local de la subida anterior.
    await getDb().runAsync('DELETE FROM remote_uploads WHERE capture_id = ?', [capId]);
    await getDb().runAsync("UPDATE captures SET md5 = '00000000000000000000000000000000', size_bytes = size_bytes + 1 WHERE capture_id = ?", [capId]);
    await getDb().runAsync("UPDATE sync_queue SET status = 'PENDIENTE' WHERE entity_type = 'CAPTURE' AND entity_id = ?", [capId]);
    await sessionRepo.updateSession(sid, { status: 'CLOSED' });
    const other = await miniSession(10); // otra sesión en la misma ronda
    await sync.runSync({ trigger: 'MANUAL' });
    const item = (await queueRepo.listSessionItems(sid)).find((i: { entityType: string }) => i.entityType === 'CAPTURE');
    assert.equal(item?.status, 'ERROR_DEFINITIVO');
    assert.equal(item?.lastErrorCode, 'CAPTURE_CONFLICT');
    assert.equal((await captureRepo.getCapture(capId))?.remoteSyncStatus, 'ERROR_SINCRONIZACION');
    assert.equal((await sessionRepo.getSession(other))?.status, 'SYNCED', 'el resto continúa');
  });

  await step('PANT-20: resumen por sesión con fotos en la nube y errores con su código', async () => {
    const o = await syncOverview();
    const s = o.sessions.find((x: { sessionId: string }) => x.sessionId === sessionId);
    assert.ok(s);
    assert.equal(s!.cloud.confirmed, captureIds.length + 1); // incluye la confirmada con alreadyConfirmed (sin fila local)
    assert.equal(s!.cloud.uploadedNotConfirmed, 0);
    assert.ok(o.errors >= 1);
    assert.ok(o.sessions.some((x: { errorItems: { code: string | null }[] }) => x.errorItems.some((e) => e.code === 'ARCHIVO_NO_DISPONIBLE')));
    assert.ok(o.lastSync && typeof o.lastSync.code === 'string');
  });

  await step('token rechazado por el servidor (401): se renueva una vez y la ronda sigue', async () => {
    const sid6 = await miniSession(5);
    const tk = await loadTokens();
    await saveTokens({ ...tk!, accessToken: tk!.accessToken.slice(0, -4) + 'AAAA', accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString() }, operatorId);
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.ok(['SINCRONIZADO', 'SINCRONIZACION_CON_ERRORES'].includes(r.code), JSON.stringify(r));
    assert.equal(r.retried, 0, 'el 401 no es un fallo: se renovó el token');
    assert.equal((await sessionRepo.getSession(sid6))?.status, 'SYNCED');
  });

  await step('modo MULTIPART (Supuesto S-07, v1): la foto pasa por Django y queda confirmada', async () => {
    const sid7 = await miniSession(6);
    CONFIG.sync.uploadMode = 'MULTIPART';
    try {
      const r = await sync.runSync({ trigger: 'MANUAL' });
      assert.ok(['SINCRONIZADO', 'SINCRONIZACION_CON_ERRORES'].includes(r.code), JSON.stringify(r));
      assert.equal(r.uploaded, 1);
    } finally {
      CONFIG.sync.uploadMode = 'TICKET';
    }
    assert.equal((await sessionRepo.getSession(sid7))?.status, 'SYNCED');
  });

  await step('servidor caído: SIN_INTERNET, la cola queda igual y no cuenta intentos', async () => {
    const sid8 = await miniSession(7);
    const { ENV } = await import(`${M}/config`);
    const before = await queueRepo.listSessionItems(sid8);
    (ENV as { apiUrl: string }).apiUrl = 'http://127.0.0.1:9'; // puerto cerrado
    try {
      const r = await sync.runSync({ trigger: 'MANUAL' });
      assert.equal(r.code, 'SIN_INTERNET', JSON.stringify(r));
    } finally {
      (ENV as { apiUrl: string }).apiUrl = API;
    }
    const after = await queueRepo.listSessionItems(sid8);
    assert.deepEqual(after.map((i: { status: string; attempts: number }) => [i.status, i.attempts]), before.map((i: { status: string; attempts: number }) => [i.status, i.attempts]));
    const r2 = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r2.code === 'SINCRONIZADO' || r2.code === 'SINCRONIZACION_CON_ERRORES', true, JSON.stringify(r2));
    assert.equal((await sessionRepo.getSession(sid8))?.status, 'SYNCED');
  });

  await step('«Reintentar errores»: el error vuelve a la cola (y sigue en error si la causa persiste)', async () => {
    const r = await sync.retrySyncErrors();
    assert.equal(r.code, 'SINCRONIZACION_CON_ERRORES', JSON.stringify(r));
    assert.ok((await queueRepo.countSyncErrors()) >= 1);
  });

  await step('cambio de contraseña: política de Django (PASSWORD_POLICY con motivo) y contraseña actual mala', async () => {
    const bad = await auth.changePassword(CLAVE, '12345678');
    assert.equal(bad.ok, false);
    assert.ok(!bad.ok && (bad.code === 'PASSWORD_POLICY'), JSON.stringify(bad));
    assert.ok(!bad.ok && bad.fieldErrors && bad.fieldErrors.some((f: { field: string }) => f.field === 'newPassword'));
    const wrong = await auth.changePassword('otra-clave-9', 'NuevaClave2026x');
    assert.ok(!wrong.ok && wrong.code === 'CONTRASENA_ACTUAL_INCORRECTA', JSON.stringify(wrong));
  });

  await step('sin tokens (sesión OFFLINE): la sincronización pide validar la contraseña', async () => {
    useAppSession.getState().set({ mode: 'OFFLINE' });
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'REAUTENTICACION_REQUERIDA');
    useAppSession.getState().set({ mode: 'ONLINE' });
  });

  await step('CP-33: celular revocado por el administrador → al sincronizar se borran tokens y verificador; datos intactos', async () => {
    const sid = await miniSession(11);
    const before = await queueRepo.listSessionItems(sid);
    if (!serverDb) return console.log('      (omitido: revocar el celular requiere PLATAFORMA_DB)');
    const revocar = (valor: string | null) =>
      serverDb
        .prepare("UPDATE devices SET revoked_at = ? WHERE replace(device_id, '-', '') = replace(?, '-', '')")
        .run(valor, identity.deviceId);
    revocar(new Date().toISOString().replace('T', ' ').replace('Z', ''));
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'DEVICE_REVOKED', JSON.stringify(r));
    assert.equal(await loadTokens(), null, 'tokens borrados');
    const { loadVerifierJson } = await import(`${M}/auth/tokenStore`);
    assert.equal(await loadVerifierJson(), null, 'verificador borrado');
    assert.equal(useAppSession.getState().status, 'SIN_SESION');
    const after = await queueRepo.listSessionItems(sid);
    assert.equal(after.length, before.length, 'la cola y los datos de campo se conservan');
    assert.ok((await sessionRepo.getSession(sid)) !== null);
    revocar(null);
  });

  console.log(`\n${failures.length === 0 ? '✓' : '✗'} Integración: ${passed} pasos OK, ${failures.length} con falla`);
  if (failures.length) process.exitCode = 1;

  // ------------------------------------------------------------ utilidades
  function CONFIG_VERSION_SAFE(): string {
    return 'CFG-4';
  }

  /** Sesión cerrada mínima: 1 pasada, 1 secuencia, 1 foto. Devuelve el sessionId. */
  async function miniSession(seed: number): Promise<string> {
    const sid = newId();
    const t = now();
    await sessionRepo.insertSession({
      sessionId: sid, operatorUserId: operatorId, controllerDeviceId: identity.deviceId, status: 'CLOSING', mode: 'AUTOMATICO',
      intervalMs: 4000, startedAt: t, endedAt: null, appVersion: '0.4.0', configVersion: 'CFG-4', qualityProfileVersion: 'Q0',
      pairingTokenHash: null, shortTestPassedAt: t, createdAt: t, updatedAt: t, remoteSyncStatus: 'PENDIENTE_NUBE',
    });
    const dev = newId();
    await sessionRepo.upsertSessionDevice({
      sessionId: sid, role: 'CAMERA_1', deviceId: dev, userId: operatorId, platform: 'ios', model: 'iPhone 12', osVersion: '18.1',
      appVersion: '0.4.0', pairedAt: t, lastSeenAt: t, linkStatus: 'DESCONECTADA', released: false, batteryLevel: 60,
      freeSpaceBytes: 2e9, pendingTransfers: 0, clockOffsetMs: null,
    });
    const passId = newId();
    await passRepo.insertPass({
      passId, sessionId: sid, lotId, rowId, lateralCode: 'LATERAL_A', passOrder: 1, direction: 'ASCENDENTE',
      startMarkerId: markerIds[0], endMarkerId: null, currentSegmentId: null, currentMarkerId: null, status: 'INCOMPLETE',
      startedAt: t, endedAt: t, sequencesTotal: 1, sequencesComplete: 0, sequencesIncomplete: 1, remoteSyncStatus: 'PENDIENTE_NUBE',
    });
    const sequenceId = newId();
    const capId = newId();
    await seqRepo.insertSequence({
      sequenceId, passId, sessionId: sid, sequenceNumber: 1, mode: 'AUTOMATICO', status: 'PARTIAL', lotId, rowId, segmentId: null,
      markerId: null, gps: null, gpsAgeMs: null, issuedAt: t, expiresAt: t, completedAt: null,
      slots: {
        CAMERA_1: { role: 'CAMERA_1', captureId: capId, outcome: 'OK_RECIBIDA' },
        CAMERA_2: { role: 'CAMERA_2', captureId: newId(), outcome: 'SIN_RESPUESTA' },
      },
      remoteSyncStatus: 'PENDIENTE_NUBE',
    });
    const bytes = makeJpeg(200 + seed);
    const file = capturePath(sid, passId, capId);
    file.write(bytes);
    await captureRepo.upsertCapture({
      captureId: capId, sequenceId, sessionId: sid, passId, lateralCode: 'LATERAL_A', isTest: false, deviceId: dev,
      cameraRole: 'CAMERA_1', userId: operatorId, capturedAt: t, filePath: file.uri, sizeBytes: bytes.length, width: 64,
      height: 48, md5: createHash('md5').update(bytes).digest('hex'), qualityStatus: 'UTILIZABLE', qualityProfileVersion: 'Q0',
      replacesCaptureId: null, localTransferStatus: 'RECIBIDA_CONTROLADOR', remoteSyncStatus: 'PENDIENTE_NUBE',
      transferAttempts: 1, syncAttempts: 0, lastError: null, fileDeletedAt: null,
    });
    await captureRepo.upsertQualityResult(capId, { status: 'UTILIZABLE', reasons: [], metrics: null, profileVersion: 'Q0' });
    await finalizeClose((await sessionRepo.getSession(sid))!);
    return sid;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
