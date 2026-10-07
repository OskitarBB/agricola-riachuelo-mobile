// tools/verificacion/piloto.ts — Prueba corta de la app contra el PILOTO real (Django + Cloudinary reales): CP-38 y CP-41.
//
// QUÉ HACE: corre en Node el código REAL de la app (como integracion.ts) con una cuenta de operador aprobada y crea UNA
// sesión de prueba pequeña y marcada como tal: 1 pasada, 2 secuencias, 3 fotos sintéticas (una UTILIZABLE y dos
// rechazadas por nitidez) y una incidencia «PRUEBA TÉCNICA». Comprueba:
//   - CP-38: las fotos van directo a Cloudinary con el ticket (type = authenticated, overwrite = false), Django las
//     confirma y quedan SINCRONIZADO; a Django solo van JSON (ningún archivo) y a Cloudinary no van las cabeceras de la API.
//   - CP-41: una foto que ya estaba en Cloudinary (subida sin confirmar y sin registro local) se vuelve a subir:
//     Cloudinary responde existing = true, no se crea otro archivo y Django la confirma.
//   - Reenviar no duplica (el ticket responde alreadyConfirmed) y al final la cola queda vacía.
// También registra en el servidor un celular «Node Verificador» (puedes revocarlo en la web después).
//
// USO (PowerShell, desde la carpeta de la app, después de `npm install`; Node 22.13 o superior):
//   $env:PERMITIR_PILOTO="1"; $env:RIACHUELO_OPERADOR="correo@ejemplo.com"; $env:RIACHUELO_CLAVE="contraseña"
//   npx tsx --tsconfig tools/verificacion/tsconfig.json tools/verificacion/piloto.ts
// Si la cuenta tiene contraseña temporal, define también $env:RIACHUELO_CLAVE_NUEVA con la contraseña nueva que quieras.
// La contraseña nunca se imprime ni se guarda en archivos.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const API = (process.env.RIACHUELO_API ?? 'https://monitoreo.agricolariachuelo.org').replace(/\/+$/, '');
const OPERADOR = process.env.RIACHUELO_OPERADOR ?? '';
const CLAVE = process.env.RIACHUELO_CLAVE ?? '';
const CLAVE_NUEVA = process.env.RIACHUELO_CLAVE_NUEVA ?? '';
if (!OPERADOR || !CLAVE) {
  console.error('Faltan RIACHUELO_OPERADOR y RIACHUELO_CLAVE (cuenta de operador aprobada).');
  process.exit(2);
}
if (/agricolariachuelo\.org/i.test(API) && process.env.PERMITIR_PILOTO !== '1') {
  console.error('Esta prueba crea una sesión de prueba y 3 fotos en el piloto. Para correrla define PERMITIR_PILOTO=1.');
  process.exit(2);
}
process.env.EXPO_PUBLIC_API_URL = API;
process.env.EXPO_PUBLIC_USE_MOCK_API = '0';
process.env.EXPO_PUBLIC_APP_ENV = 'piloto';
const BASE = path.join(os.tmpdir(), 'riachuelo-verificacion');
const WORK = path.join(BASE, 'piloto');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
process.env.RIACHUELO_SQLITE = path.join(WORK, 'app.sqlite');
process.env.RIACHUELO_ARCHIVOS = path.join(WORK, 'archivos');
(globalThis as Record<string, unknown>).__DEV__ = false;
/** Se reutiliza el mismo X-Device-Id en cada corrida: en la web aparece un solo celular «Node Verificador». */
const DEVICE_FILE = path.join(BASE, 'piloto-device-id.txt');

// Módulos de la app, relativos a este archivo (una ruta absoluta de Windows no sirve en import()).
const M = '../../src';

// ------------------------------------------------------------------ registro de las peticiones HTTP (CP-38)
interface Peticion {
  url: string;
  method: string;
  api: boolean;
  multipart: boolean;
  headers: string[];
  fields: Record<string, string>;
  respuesta?: Record<string, unknown>;
}
const peticiones: Peticion[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const body = init?.body;
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  const fields: Record<string, string> = {};
  if (multipart) {
    for (const [k, v] of (body as FormData).entries()) if (typeof v === 'string') fields[k] = v;
  }
  const p: Peticion = {
    url,
    method: init?.method ?? 'GET',
    api: url.startsWith(`${API}/api/`),
    multipart,
    headers: [...new Headers(init?.headers).keys()].map((h) => h.toLowerCase()),
    fields,
  };
  peticiones.push(p);
  const res = await fetchOriginal(input, init);
  if (multipart && !p.api) {
    try {
      p.respuesta = (await res.clone().json()) as Record<string, unknown>;
    } catch {
      // respuesta que no es JSON: la interpreta la app
    }
  }
  return res;
};

let passed = 0;
const failures: string[] = [];
async function step(name: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${err instanceof Error ? (err.stack ?? err.message).split('\n').slice(0, 4).join('\n      ') : String(err)}`);
    return false;
  }
}

async function main() {
  try {
    await import('node:sqlite');
  } catch {
    console.error(
      `Esta prueba necesita node:sqlite: Node 22.13 o superior (tu versión: ${process.version}). Con Node 22.5–22.12 ` +
        'define antes $env:NODE_OPTIONS="--experimental-sqlite".',
    );
    process.exit(2);
  }
  const jpegMod = (await import('jpeg-js')) as unknown as { default?: unknown };
  const jpeg = (jpegMod.default ?? jpegMod) as {
    encode(img: { width: number; height: number; data: Uint8Array }, q: number): { data: Uint8Array };
  };
  const { openAppDb, getDb } = await import(`${M}/storage/db`);
  const { setIdProvider, newId } = await import(`${M}/domain/ids`);
  const Crypto = await import('expo-crypto');
  const { setMeta } = await import(`${M}/storage/repositories/appMetaRepo`);
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
  const { addManualIncident } = await import(`${M}/diagnostics/incidents`);
  const sync = await import(`${M}/sync/syncService`);
  const { capturePath } = await import(`${M}/storage/files`);
  const { CONFIG } = await import(`${M}/config`);
  const { uploadApi, cloudUpload, authApi } = await import(`${M}/api`);

  console.log(`\nPiloto: ${API} · operador: ${OPERADOR}\n`);

  // ---------------------------------------------------------------- arranque (como src/boot.ts)
  await openAppDb();
  setIdProvider(() => Crypto.randomUUID());
  if (fs.existsSync(DEVICE_FILE)) await setMeta('device_id', fs.readFileSync(DEVICE_FILE, 'utf8').trim());
  const identity = await loadDeviceIdentity();
  fs.writeFileSync(DEVICE_FILE, identity.deviceId);
  useAppSession.getState().set({ identity, deviceRole: 'CONTROLADOR', booted: true });

  const okServidor = await step('servidor en línea (GET /api/v1/health)', async () => {
    const h = await authApi.health();
    assert.ok(h.serverTime, JSON.stringify(h));
  });
  if (!okServidor) return fin();

  const okLogin = await step('login del operador con internet', async () => {
    const r = await auth.login(OPERADOR, CLAVE);
    assert.ok(r.ok, `login rechazado: ${JSON.stringify(r)}`);
    if (r.ok && r.status === 'CAMBIO_CONTRASENA_REQUERIDO') {
      if (!CLAVE_NUEVA) {
        throw new Error(
          'La cuenta tiene contraseña temporal: define RIACHUELO_CLAVE_NUEVA con la contraseña nueva (o cámbiala en la app) y vuelve a correr.',
        );
      }
      const c = await auth.changePassword(CLAVE, CLAVE_NUEVA);
      assert.ok(c.ok, `cambio de contraseña rechazado: ${JSON.stringify(c)}`);
      console.log('      (contraseña temporal cambiada; desde ahora usa RIACHUELO_CLAVE_NUEVA)');
    }
    assert.equal(useAppSession.getState().status, 'AUTENTICADO');
    assert.equal(useAppSession.getState().mode, 'ONLINE');
  });
  if (!okLogin) return fin();
  const operatorId = useAppSession.getState().user?.id as string;

  let lotId = '', rowId = '', segId: string | null = null, markerId: string | null = null, lotName = '', rowNumber = 0;
  const okCat = await step('catálogos del servidor (bootstrap)', async () => {
    const r = await updateCatalogs();
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    console.log(`      (${r.info.lots} lotes, ${r.info.rows} hileras, ${r.info.segments} segmentos, ${r.info.markers} marcadores)`);
    // Se prefiere una hilera con segmento y marcador; si no hay, cualquier hilera (son opcionales en la secuencia).
    for (const lot of await catalogs.lots()) {
      for (const row of await catalogs.rows(lot.id)) {
        const segs = await catalogs.segments(row.id);
        const mks = await catalogs.markers(row.id);
        const completa = segs.length > 0 && mks.length > 0;
        if (!lotId || (completa && !segId)) {
          lotId = lot.id;
          lotName = lot.name ?? lot.code ?? lot.id;
          rowId = row.id;
          rowNumber = row.number;
          segId = segs[0]?.id ?? null;
          markerId = mks[0]?.id ?? null;
        }
      }
    }
    assert.ok(lotId && rowId, 'el catálogo del servidor no tiene lotes con hileras');
    console.log(`      (sesión de prueba en ${lotName}, hilera ${rowNumber})`);
  });
  if (!okCat) return fin();

  // ---------------------------------------------------------------- sesión de prueba (datos locales)
  const now = () => new Date().toISOString();
  const sessionId = newId();
  const passId = newId();
  const cam1 = newId();
  const cam2 = newId();
  /** JPEG sintético de 1280×960 (degradado con franjas): parecido en tamaño a una foto chica, distinto por semilla. */
  const makeJpeg = (seed: number) => {
    const w = 1280, h = 960, data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = (x * 255) / w;
        data[i + 1] = ((y * 255) / h + seed * 40) % 256;
        data[i + 2] = ((x + y + seed * 13) % 64) * 4;
        data[i + 3] = 255;
      }
    }
    return Buffer.from(jpeg.encode({ width: w, height: h, data }, 85).data);
  };
  async function addCapture(sequenceId: string, role: 'CAMERA_1' | 'CAMERA_2', seed: number, quality: 'UTILIZABLE' | 'REPETIR_NITIDEZ', captureId: string) {
    const bytes = makeJpeg(seed);
    const file = capturePath(sessionId, passId, captureId);
    file.write(bytes);
    await captureRepo.upsertCapture({
      captureId, sequenceId, sessionId, passId, lateralCode: 'LATERAL_A', isTest: false,
      deviceId: role === 'CAMERA_1' ? cam1 : cam2, cameraRole: role, userId: operatorId, capturedAt: now(),
      filePath: file.uri, sizeBytes: bytes.length, width: 1280, height: 960,
      md5: createHash('md5').update(bytes).digest('hex'), qualityStatus: quality, qualityProfileVersion: 'Q0',
      replacesCaptureId: null, localTransferStatus: 'RECIBIDA_CONTROLADOR', remoteSyncStatus: 'PENDIENTE_NUBE',
      transferAttempts: 1, syncAttempts: 0, lastError: null, fileDeletedAt: null,
    });
    await captureRepo.upsertQualityResult(captureId, {
      status: quality,
      reasons: quality === 'UTILIZABLE' ? [] : ['NITIDEZ_BAJA'],
      metrics: { luminanceMean: 120, darkRatio: 0.01, brightRatio: 0.01, laplacianVariance: quality === 'UTILIZABLE' ? 400 : 35, analyzedRegions: 4, durationMs: 200 },
      profileVersion: 'Q0',
    });
  }
  const foto1 = newId(); // UTILIZABLE (Django crea su tarea de IA)
  const foto2 = newId(); // rechazada por nitidez (se sube para auditar, sin IA)
  const foto3 = newId(); // CP-41: ya estará en Cloudinary antes de sincronizarla

  const okSesion = await step('sesión de prueba cerrada: 1 pasada, 2 secuencias, 3 fotos e incidencia «PRUEBA TÉCNICA»', async () => {
    const t = now();
    await sessionRepo.insertSession({
      sessionId, operatorUserId: operatorId, controllerDeviceId: identity.deviceId, status: 'CLOSING', mode: 'MANUAL',
      intervalMs: 4000, startedAt: t, endedAt: null, appVersion: '0.4.0', configVersion: 'CFG-4', qualityProfileVersion: 'Q0',
      pairingTokenHash: null, shortTestPassedAt: t, createdAt: t, updatedAt: t, remoteSyncStatus: 'PENDIENTE_NUBE',
    });
    for (const [role, id] of [['CAMERA_1', cam1], ['CAMERA_2', cam2]] as const) {
      await sessionRepo.upsertSessionDevice({
        sessionId, role, deviceId: id, userId: operatorId, platform: 'android', model: 'Verificador', osVersion: '14',
        appVersion: '0.4.0', pairedAt: t, lastSeenAt: t, linkStatus: 'DESCONECTADA', released: false, batteryLevel: 90,
        freeSpaceBytes: 1e9, pendingTransfers: 0, clockOffsetMs: 0,
      });
    }
    await passRepo.insertPass({
      passId, sessionId, lotId, rowId, lateralCode: 'LATERAL_A', passOrder: 1, direction: 'ASCENDENTE',
      startMarkerId: markerId, endMarkerId: null, currentSegmentId: segId, currentMarkerId: markerId, status: 'INCOMPLETE',
      startedAt: t, endedAt: t, sequencesTotal: 2, sequencesComplete: 0, sequencesIncomplete: 2, remoteSyncStatus: 'PENDIENTE_NUBE',
    });
    const seq1 = newId();
    const seq2 = newId();
    await seqRepo.insertSequence({
      sequenceId: seq1, passId, sessionId, sequenceNumber: 1, mode: 'MANUAL', status: 'PARTIAL', lotId, rowId,
      segmentId: segId, markerId, gps: null, gpsAgeMs: null, issuedAt: t, expiresAt: t, completedAt: null,
      slots: {
        CAMERA_1: { role: 'CAMERA_1', captureId: foto1, outcome: 'OK_RECIBIDA' },
        CAMERA_2: { role: 'CAMERA_2', captureId: foto2, outcome: 'RECHAZADA_CALIDAD' },
      },
      remoteSyncStatus: 'PENDIENTE_NUBE',
    });
    await seqRepo.insertSequence({
      sequenceId: seq2, passId, sessionId, sequenceNumber: 2, mode: 'MANUAL', status: 'PARTIAL', lotId, rowId,
      segmentId: segId, markerId, gps: null, gpsAgeMs: null, issuedAt: t, expiresAt: t, completedAt: null,
      slots: {
        CAMERA_1: { role: 'CAMERA_1', captureId: foto3, outcome: 'RECHAZADA_CALIDAD' },
        CAMERA_2: { role: 'CAMERA_2', captureId: newId(), outcome: 'SIN_RESPUESTA' },
      },
      remoteSyncStatus: 'PENDIENTE_NUBE',
    });
    await addCapture(seq1, 'CAMERA_1', 1, 'UTILIZABLE', foto1);
    await addCapture(seq1, 'CAMERA_2', 2, 'REPETIR_NITIDEZ', foto2);
    await addCapture(seq2, 'CAMERA_1', 3, 'REPETIR_NITIDEZ', foto3);
    await addManualIncident(
      { sessionId, passId },
      'OTRO',
      'INFO',
      'PRUEBA TÉCNICA de la app v0.4.0 (CP-38 y CP-41): sesión de verificación con fotos sintéticas. Se puede ignorar.',
    );
    await finalizeClose((await sessionRepo.getSession(sessionId))!);
    const items = await queueRepo.listSessionItems(sessionId);
    assert.equal(items.length, 1 + 1 + 1 + 3 + 1 + 1); // sesión, pasada, secuencias, 3 fotos, incidencias, cierre
  });
  if (!okSesion) return fin();

  const eventos = async (evento: string, captureId: string) => {
    await new Promise((r) => setTimeout(r, 100)); // logEvent escribe sin esperar
    const rows = (await getDb().getAllAsync(
      "SELECT data_json FROM event_log WHERE category = 'SYNC' AND event = ? ORDER BY id",
      [evento],
    )) as { data_json: string | null }[];
    return rows
      .map((r: { data_json: string | null }) => JSON.parse(r.data_json ?? '{}') as Record<string, unknown>)
      .filter((d: Record<string, unknown>) => d.captureId === captureId);
  };
  const subidasDe = (publicId: string) => peticiones.filter((p) => p.multipart && !p.api && p.fields.public_id === publicId);

  // ---------------------------------------------------------------- CP-38
  let publicId3 = '';
  await step('CP-38: fotos directo a Cloudinary con el ticket, confirmadas por Django y SINCRONIZADO', async () => {
    // La foto 3 espera (para CP-41): se envía todo lo demás.
    await getDb().runAsync(
      "UPDATE sync_queue SET status = 'ERROR_DEFINITIVO', last_error_code = 'PAUSA_PRUEBA' WHERE entity_type = 'CAPTURE' AND entity_id = ?",
      [foto3],
    );
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.uploaded, 2, JSON.stringify(r));
    assert.equal(r.errors, 0, JSON.stringify(r));
    for (const id of [foto1, foto2]) {
      assert.equal((await captureRepo.getCapture(id))?.remoteSyncStatus, 'SINCRONIZADO', id);
      const up = await remoteRepo.getRemoteUpload(id);
      assert.equal(up?.status, 'CONFIRMADA', id);
      assert.ok(up?.result.publicId.includes(id.replace(/-/g, '')) || up?.result.publicId.includes(id), `publicId ${up?.result.publicId}`);
      const subidas = subidasDe(up!.result.publicId);
      assert.equal(subidas.length, 1, 'una sola subida por foto');
      assert.equal(subidas[0].fields.type, 'authenticated', 'type del ticket');
      assert.ok(['false', '0'].includes(String(subidas[0].fields.overwrite)), 'overwrite = false');
      assert.ok(!subidas[0].headers.includes('authorization') && !subidas[0].headers.includes('x-device-id'), 'sin cabeceras de la API');
      if (subidas[0].respuesta?.type !== undefined) assert.equal(subidas[0].respuesta.type, 'authenticated');
      assert.equal((await eventos('UPLOAD_OK', id)).length, 1);
      assert.equal((await eventos('CONFIRM_OK', id)).length, 1);
      console.log(`      (${id === foto1 ? 'UTILIZABLE ' : 'rechazada  '} → Cloudinary ${up?.result.publicId}, ${up?.result.bytes} bytes)`);
    }
    // A Django solo van JSON: ningún archivo pasa por el servidor del proyecto (modo TICKET).
    assert.equal(CONFIG.sync.uploadMode, 'TICKET');
    assert.equal(peticiones.filter((p) => p.api && p.multipart).length, 0, 'ningún multipart a /api/v1');
  });

  // ---------------------------------------------------------------- CP-41
  await step('CP-41: foto que ya estaba en Cloudinary → existing = true, sin archivo nuevo y Django la confirma', async () => {
    const c = await captureRepo.getCapture(foto3);
    const token = await auth.getAccessToken();
    const t = await uploadApi.requestTicket(
      { captureId: foto3, sessionId, passId, sequenceId: c!.sequenceId, sizeBytes: c!.sizeBytes!, md5: c!.md5!, mimeType: 'image/jpeg' },
      token!,
      identity.deviceId,
      30_000,
    );
    assert.ok(t.ok && t.data.upload && !t.data.alreadyConfirmed, JSON.stringify(t));
    // Primera subida a Cloudinary SIN confirmar ni guardar el registro local (como si se hubiera perdido).
    const up = await cloudUpload(t.ok ? t.data.upload! : (null as never), c!.filePath!, 60_000);
    assert.ok(up.ok, JSON.stringify(up));
    publicId3 = up.ok ? up.result.publicId : '';
    assert.equal(await remoteRepo.getRemoteUpload(foto3), null);
    await getDb().runAsync(
      "UPDATE sync_queue SET status = 'PENDIENTE', last_error_code = NULL WHERE entity_type = 'CAPTURE' AND entity_id = ?",
      [foto3],
    );
    await sessionRepo.updateSession(sessionId, { status: 'CLOSED' });
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'SINCRONIZADO', JSON.stringify(r));
    assert.equal(r.uploaded, 1, 'la app vuelve a subir (no sabe que ya estaba)');
    const row = await remoteRepo.getRemoteUpload(foto3);
    assert.equal(row?.status, 'CONFIRMADA');
    assert.equal(row?.result.publicId, publicId3, 'mismo public_id');
    const ok = await eventos('UPLOAD_OK', foto3);
    assert.equal(ok.length, 1);
    assert.equal(ok[0].existing, true, 'Cloudinary responde existing = true');
    assert.equal(subidasDe(publicId3).length, 2, 'dos subidas al mismo public_id (overwrite = false: un solo archivo)');
    assert.equal((await captureRepo.getCapture(foto3))?.remoteSyncStatus, 'SINCRONIZADO');
    assert.equal((await sessionRepo.getSession(sessionId))?.status, 'SYNCED');
  });

  // ---------------------------------------------------------------- reenvío sin duplicados
  await step('reenviar no duplica: sin registro local, el ticket responde alreadyConfirmed y no se sube nada', async () => {
    await getDb().runAsync('DELETE FROM remote_uploads WHERE capture_id = ?', [foto1]);
    await getDb().runAsync("UPDATE sync_queue SET status = 'PENDIENTE' WHERE entity_type = 'CAPTURE' AND entity_id = ?", [foto1]);
    await sessionRepo.updateSession(sessionId, { status: 'CLOSED' });
    const antes = peticiones.filter((p) => p.multipart && !p.api).length;
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'SINCRONIZADO', JSON.stringify(r));
    assert.equal(r.uploaded, 0);
    assert.equal(peticiones.filter((p) => p.multipart && !p.api).length, antes, 'ninguna subida nueva');
    assert.equal((await eventos('ALREADY_CONFIRMED', foto1)).length, 1);
    assert.equal((await sessionRepo.getSession(sessionId))?.status, 'SYNCED');
  });

  await step('cola vacía: una nueva ronda responde NADA_PENDIENTE', async () => {
    const r = await sync.runSync({ trigger: 'MANUAL' });
    assert.equal(r.code, 'NADA_PENDIENTE', JSON.stringify(r));
    assert.equal(await queueRepo.countPendingSync(), 0);
  });

  console.log(`\nSesión de prueba: ${sessionId}`);
  console.log('En la web: Monitoreo → sesiones del operador (incidencia «PRUEBA TÉCNICA»); la foto UTILIZABLE queda en la cola de IA.');
  console.log(`Celular de la prueba (X-Device-Id): ${identity.deviceId} — «Node Verificador», se puede revocar en la web.`);
  return fin();

  function fin() {
    console.log(`\n${failures.length === 0 ? '✓' : '✗'} Piloto: ${passed} pasos OK, ${failures.length} con falla`);
    if (failures.length) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
