// tools/verificacion/redlocal.ts — Red local REAL entre controlador y cámara, en Node (maestro §14.2, §14.8, §14.11).
//
// QUÉ HACE: usa el módulo `net` de Node en lugar de react-native-tcp-socket (misma forma: createServer, listen,
// socket.on('data'), write, destroy) para correr el código REAL del APK:
//   - TcpControlServer (TCP + códec WebSocket propio) ← WsControlClient (WebSocket estándar, como el de RN);
//   - TcpFileReceiver (HTTP propio sobre TCP) ← UploadFileSender (File.upload con cuerpo binario).
// También comprueba cómo factory.ts carga react-native-tcp-socket (su index.js termina con module.exports).
// No necesita servidor ni internet. Uso: npx tsx --tsconfig tools/verificacion/tsconfig.json tools/verificacion/redlocal.ts
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

const WORK = path.join(os.tmpdir(), 'riachuelo-verificacion', 'redlocal');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
process.env.RIACHUELO_SQLITE = path.join(WORK, 'app.sqlite');
process.env.RIACHUELO_ARCHIVOS = path.join(WORK, 'archivos');
(globalThis as Record<string, unknown>).__DEV__ = false;
const M = '../../src';

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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('tiempo agotado esperando la condición');
    await wait(10);
  }
}

async function main() {
  if (typeof WebSocket === 'undefined') {
    console.error('Se necesita Node 22 o superior (WebSocket global).');
    process.exit(2);
  }
  const { TcpControlServer } = await import(`${M}/local-network/tcp/tcpControlServer`);
  const { TcpFileReceiver } = await import(`${M}/local-network/tcp/tcpFileReceiver`);
  const { WsControlClient } = await import(`${M}/local-network/client/wsControlClient`);
  const { UploadFileSender } = await import(`${M}/local-network/client/uploadFileSender`);
  const { createEnvelope } = await import(`${M}/protocol/envelope`);
  const { setIdProvider } = await import(`${M}/domain/ids`);
  setIdProvider(() => randomUUID());
  const tcp = net as never; // net tiene la misma forma que react-native-tcp-socket para lo que usa la app

  console.log('\nRed local (código del APK sobre TCP de Node)\n');

  await step('carga de react-native-tcp-socket: module.exports reemplaza a exports.default (factory.ts usa mod.default ?? mod)', async () => {
    // Con `module.exports = {…}` al final del index.js de la librería, require() devuelve el objeto sin `.default`.
    const mod = { createServer: () => 'ok' } as { default?: { createServer: () => string }; createServer: () => string };
    assert.equal((mod.default ?? mod).createServer(), 'ok');
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/local-network/factory.ts'), 'utf8');
    assert.ok(src.includes('mod.default ?? mod'), 'factory.ts no debe depender solo de .default');
  });

  const sessionId = randomUUID();
  const ctrlId = randomUUID();
  const camId = randomUUID();
  const server = new TcpControlServer(tcp, async () => '127.0.0.1', 256 * 1024, () => ctrlId);
  const received: { from: string; type: string }[] = [];
  const closed: string[] = [];
  server.onMessage((from: { deviceId: string }, env: { type: string }) => received.push({ from: from.deviceId, type: env.type }));
  server.onPeerClosed((p: { deviceId: string }, reason: string) => closed.push(`${p.deviceId}:${reason}`));
  let port = 0;

  await step('servidor de control: escucha y devuelve la IP para el QR', async () => {
    port = 18000 + Math.floor(Math.random() * 1000);
    const r = await server.start(port);
    assert.deepEqual(r, { host: '127.0.0.1', port });
  });

  const client = new WsControlClient();
  const camReceived: string[] = [];
  client.onMessage((env: { type: string }) => camReceived.push(env.type));

  await step('cámara → controlador: conexión WebSocket (handshake del códec propio) y mensaje HEARTBEAT', async () => {
    await client.connect(`ws://127.0.0.1:${port}/control`);
    assert.equal(client.connected, true);
    client.send(
      createEnvelope('HEARTBEAT', sessionId, camId, {
        echoSentAt: null,
        role: 'CAMERA_1',
        batteryLevel: 0.8,
        freeSpaceBytes: 1e9,
        pendingTransfers: 0,
        lastSequenceId: null,
        appState: 'active',
      }),
    );
    await until(() => received.length > 0);
    assert.deepEqual(received[0], { from: camId, type: 'HEARTBEAT' });
  });

  await step('controlador → cámara: send() por deviceId y mensajes grandes (> 64 KB, tramas extendidas)', async () => {
    server.send(
      camId,
      createEnvelope('HEARTBEAT', sessionId, ctrlId, {
        echoSentAt: new Date().toISOString(),
        role: 'CONTROLADOR',
        batteryLevel: null,
        freeSpaceBytes: null,
        pendingTransfers: 0,
        lastSequenceId: null,
        appState: 'active',
      }),
    );
    await until(() => camReceived.includes('HEARTBEAT'));
    // Mensaje inválido grande: el servidor lo rechaza por zod sin cortar la conexión.
    const invalid: string[] = [];
    server.onInvalid((_f: unknown, detail: string) => invalid.push(detail));
    (client as unknown as { ws: WebSocket }).ws.send(JSON.stringify({ v: 1, type: 'HEARTBEAT', relleno: 'x'.repeat(100_000) }));
    await until(() => invalid.length > 0);
    assert.equal(client.connected, true);
  });

  await step('desconexión: el controlador se entera (onPeerClosed) cuando la cámara cierra', async () => {
    client.close();
    await until(() => closed.some((c) => c.startsWith(camId)));
  });

  const receiver = new TcpFileReceiver(tcp);
  let filePort = 0;
  const got: { captureId: string; md5: string; size: number; remote: string | null }[] = [];
  receiver.onCapture(async (meta: { captureId: string; md5: string; sizeBytes: number }, uri: string, remote: string | null) => {
    const bytes = fs.readFileSync(uri.replace(/^file:\/\//, ''));
    const md5 = createHash('md5').update(bytes).digest('hex');
    got.push({ captureId: meta.captureId, md5, size: bytes.length, remote });
    if (md5 !== meta.md5) return { result: 'REJECTED', reason: 'MD5_MISMATCH' };
    return { result: 'RECEIVED', reason: null };
  });

  await step('foto cámara → controlador: POST binario de 2 MB, md5 y tamaño verificados (opción A, §14.8)', async () => {
    filePort = port + 1;
    await receiver.start(filePort);
    const bytes = Buffer.alloc(2 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) % 256;
    const file = path.join(WORK, 'foto.jpg');
    fs.writeFileSync(file, bytes);
    const md5 = createHash('md5').update(bytes).digest('hex');
    const meta = {
      captureId: randomUUID(), sequenceId: randomUUID(), sessionId, passId: randomUUID(), lateralCode: 'LATERAL_A', isTest: false,
      deviceId: camId, cameraRole: 'CAMERA_1', userId: randomUUID(), capturedAt: new Date().toISOString(), width: 4000, height: 3000,
      sizeBytes: bytes.length, md5, qualityStatus: 'UTILIZABLE', qualityReasons: [],
      qualityMetrics: { luminanceMean: 120, darkRatio: 0.01, brightRatio: 0.01, laplacianVariance: 400, analyzedRegions: 4, durationMs: 200 },
      profileVersion: 'Q0', replacesCaptureId: null,
    };
    const res = await new UploadFileSender().send(`http://127.0.0.1:${filePort}`, meta as never, `file://${file}`, 20_000);
    assert.equal(res.result, 'RECEIVED', JSON.stringify(res));
    assert.equal(got.length, 1);
    assert.equal(got[0].md5, md5);
    assert.equal(got[0].size, bytes.length);
  });

  await step('foto con metadatos inválidos: 400 INVALID_META (la cámara no reintenta a ciegas)', async () => {
    const file = path.join(WORK, 'mala.jpg');
    fs.writeFileSync(file, Buffer.from('abc'));
    const res = await new UploadFileSender().send(`http://127.0.0.1:${filePort}`, { captureId: 'x', deviceId: camId } as never, `file://${file}`, 10_000);
    assert.deepEqual(res, { result: 'REJECTED', reason: 'INVALID_META' });
  });

  await step('reinicio: stop() y start() en el mismo puerto (volver a PANT-13 o regenerar)', async () => {
    await server.stop();
    await receiver.stop();
    await server.start(port);
    await receiver.start(filePort);
    const c2 = new WsControlClient();
    await c2.connect(`ws://127.0.0.1:${port}/control`);
    assert.equal(c2.connected, true);
    c2.close();
    await server.stop();
    await receiver.stop();
  });

  console.log(`\n${failures.length === 0 ? '✓' : '✗'} Red local: ${passed} pasos OK, ${failures.length} con falla`);
  if (failures.length) process.exitCode = 1;
  setTimeout(() => process.exit(), 200);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
