// __tests__/captureUploader.test.ts — Subida directa de una foto a Cloudinary (maestro v2.0 §15.7; Anexo E.8 en Jest).
// Dependencias falsas en memoria: no usan red, Expo ni Cloudinary.

import { parseCloudinaryResponse, type CloudinaryUploadOutcome } from '../src/api/cloudinaryResponse';
import type { CaptureConfirmRequest, CaptureUploadMetadata, CaptureUploadResponse, UploadTicketResponse } from '../src/api/dto';
import { DEFAULT_CONFIG } from '../src/config/defaults';
import { syncCapture, type ApiCallResult, type CaptureUploaderDeps, type StoredUpload } from '../src/sync/captureUploader';

const CFG = DEFAULT_CONFIG.sync;
const PUBLIC_ID = 'riachuelo/dev/s1/p1/c1';

const meta = {
  captureId: 'c1',
  sequenceId: 'q1',
  sessionId: 's1',
  passId: 'p1',
  lateralCode: 'LATERAL_A',
  deviceId: 'd1',
  cameraRole: 'CAMERA_1',
  cameraUserId: 'u1',
  operatorUserId: 'u1',
  capturedAt: '2026-11-09T14:32:05.412Z',
  width: 4000,
  height: 3000,
  sizeBytes: 3_912_044,
  md5: '9e107d9d372bb6826bd81d3542a419d6',
  quality: { status: 'UTILIZABLE', reasons: [], metrics: null, profileVersion: 'Q0' },
  replacesCaptureId: null,
  retakeContext: null,
  appVersion: '0.4.0',
} as unknown as CaptureUploadMetadata;

const okBody = JSON.stringify({
  public_id: PUBLIC_ID,
  version: 1791100000,
  signature: 'abc123',
  bytes: 3_912_044,
  format: 'jpg',
  width: 4000,
  height: 3000,
  etag: 'e1',
  type: 'authenticated',
});

function ticket(expiresInMs = 3_600_000, alreadyConfirmed = false): ApiCallResult<UploadTicketResponse> {
  const serverTime = '2026-11-09T15:00:00.000Z';
  return {
    ok: true,
    status: 200,
    data: {
      captureId: 'c1',
      alreadyConfirmed,
      upload: alreadyConfirmed
        ? null
        : {
            url: 'https://api.cloudinary.com/v1_1/demo/image/upload',
            fields: {
              api_key: '123',
              timestamp: '1794236400',
              signature: 'firma',
              public_id: PUBLIC_ID,
              type: 'authenticated',
              overwrite: 'false',
            },
            publicId: PUBLIC_ID,
            expiresAt: new Date(Date.parse(serverTime) + expiresInMs).toISOString(),
            maxBytes: 10 * 1024 * 1024,
          },
      serverTime,
    },
  };
}

/** Dependencias falsas en memoria que registran cada llamada. */
function fake(opts: {
  stored?: StoredUpload | null;
  tickets?: ApiCallResult<UploadTicketResponse>[];
  uploads?: CloudinaryUploadOutcome[];
  confirms?: ApiCallResult<CaptureUploadResponse>[];
}) {
  const calls: string[] = [];
  let stored: StoredUpload | null = opts.stored ?? null;
  const tickets = [...(opts.tickets ?? [])];
  const uploads = [...(opts.uploads ?? [])];
  const confirms = [...(opts.confirms ?? [])];
  let lastConfirm: CaptureConfirmRequest | null = null;
  const take = <T>(list: T[], what: string): T => {
    const v = list.shift();
    if (v === undefined) throw new Error(`${what} inesperado`);
    return v;
  };
  const deps: CaptureUploaderDeps = {
    async getStoredUpload() {
      return stored;
    },
    async saveUploaded(_id, result, reuploadCount) {
      calls.push(`save:${reuploadCount}`);
      stored = { status: 'SUBIDA', result, reuploadCount };
    },
    async markConfirmed() {
      calls.push('confirmed');
      if (stored) stored = { ...stored, status: 'CONFIRMADA' };
    },
    async markAlreadyConfirmed() {
      calls.push('alreadyConfirmed');
    },
    async markDiscarded(_id, code) {
      calls.push(`discarded:${code}`);
      if (stored) stored = { ...stored, status: 'DESCARTADA' };
    },
    async requestTicket() {
      calls.push('ticket');
      return take(tickets, 'ticket');
    },
    async upload() {
      calls.push('upload');
      return take(uploads, 'subida');
    },
    async confirm(req) {
      calls.push('confirm');
      lastConfirm = req;
      return take(confirms, 'confirmación');
    },
  };
  return { deps, calls, getStored: () => stored, getLastConfirm: () => lastConfirm };
}

const uploadedOk = parseCloudinaryResponse(200, okBody, PUBLIC_ID);
const okResult = () => {
  if (!uploadedOk.ok) throw new Error('respuesta de prueba inválida');
  return uploadedOk.result;
};
const confirmOk: ApiCallResult<CaptureUploadResponse> = {
  ok: true,
  status: 201,
  data: { captureId: 'c1', status: 'SINCRONIZADO', duplicate: false },
};

test('respuesta de Cloudinary: éxito, forma inválida, otro public_id y error con mensaje', () => {
  expect(uploadedOk.ok).toBe(true);
  expect(okResult().version).toBe(1791100000);
  expect(okResult().existing).toBe(false);
  expect(parseCloudinaryResponse(200, '{"hola":1}', PUBLIC_ID)).toEqual({
    ok: false,
    networkError: false,
    status: 200,
    message: 'RESPUESTA_INVALIDA',
  });
  expect(parseCloudinaryResponse(200, okBody, 'otro/id')).toEqual({
    ok: false,
    networkError: false,
    status: 200,
    message: 'PUBLIC_ID_DISTINTO',
  });
  expect(
    parseCloudinaryResponse(
      400,
      '{"error":{"message":"Stale request - reported time is 1 which is out of the allowed range"}}',
      PUBLIC_ID,
    ),
  ).toEqual({
    ok: false,
    networkError: false,
    status: 400,
    message: 'Stale request - reported time is 1 which is out of the allowed range',
  });
  expect(parseCloudinaryResponse(502, '<html>', PUBLIC_ID)).toEqual({ ok: false, networkError: false, status: 502, message: null });
});

test('camino feliz: ticket, subida, guardado y confirmación', async () => {
  const f = fake({ tickets: [ticket()], uploads: [uploadedOk], confirms: [confirmOk] });
  const out = await syncCapture(meta, 'file:///c1.jpg', f.deps, CFG);
  expect(out).toEqual({ kind: 'HECHO', uploaded: true, duplicate: false });
  expect(f.calls).toEqual(['ticket', 'upload', 'save:0', 'confirm', 'confirmed']);
  expect(f.getLastConfirm()?.cloudinary.publicId).toBe(PUBLIC_ID);
  expect(f.getStored()?.status).toBe('CONFIRMADA');
});

test('subida ya hecha y sin confirmar: solo se confirma (no se vuelve a subir)', async () => {
  const f = fake({ stored: { status: 'SUBIDA', result: okResult(), reuploadCount: 0 }, confirms: [confirmOk] });
  const out = await syncCapture(meta, 'file:///c1.jpg', f.deps, CFG);
  expect(out).toEqual({ kind: 'HECHO', uploaded: false, duplicate: false });
  expect(f.calls).toEqual(['confirm', 'confirmed']);
});

test('Django caído al confirmar: REINTENTAR y la fila queda SUBIDA', async () => {
  const f = fake({ tickets: [ticket()], uploads: [uploadedOk], confirms: [{ ok: false, networkError: true }] });
  const out = await syncCapture(meta, 'file:///c1.jpg', f.deps, CFG);
  expect(out).toEqual({ kind: 'REINTENTAR', step: 'CONFIRMACION', code: null });
  expect(f.getStored()?.status).toBe('SUBIDA');
});

test('ticket con alreadyConfirmed: HECHO sin subir ni confirmar', async () => {
  const f = fake({ tickets: [ticket(3_600_000, true)] });
  const out = await syncCapture(meta, 'file:///c1.jpg', f.deps, CFG);
  expect(out).toEqual({ kind: 'HECHO', uploaded: false, duplicate: true });
  expect(f.calls).toEqual(['ticket', 'alreadyConfirmed']);
});

test('ticket vencido según Cloudinary: se pide otro y se sube', async () => {
  const stale: CloudinaryUploadOutcome = {
    ok: false,
    networkError: false,
    status: 400,
    message: 'Stale request - reported time is 1 which is out of the allowed range',
  };
  const f = fake({ tickets: [ticket(), ticket()], uploads: [stale, uploadedOk], confirms: [confirmOk] });
  const out = await syncCapture(meta, 'file:///c1.jpg', f.deps, CFG);
  expect(out.kind).toBe('HECHO');
  expect(f.calls).toEqual(['ticket', 'upload', 'ticket', 'upload', 'save:0', 'confirm', 'confirmed']);
});

test('ticket con poca vigencia: se descarta sin subir y se pide otro', async () => {
  const f = fake({ tickets: [ticket(60_000), ticket()], uploads: [uploadedOk], confirms: [confirmOk] });
  const out = await syncCapture(meta, 'file:///c1.jpg', f.deps, CFG);
  expect(out.kind).toBe('HECHO');
  expect(f.calls).toEqual(['ticket', 'ticket', 'upload', 'save:0', 'confirm', 'confirmed']);
});

test('tickets agotados: REINTENTAR más tarde', async () => {
  const f = fake({ tickets: [ticket(60_000), ticket(60_000)] });
  const out = await syncCapture(meta, 'file:///c1.jpg', f.deps, CFG);
  expect(out).toEqual({ kind: 'REINTENTAR', step: 'TICKET', code: 'TICKETS_AGOTADOS' });
});

test('Django rechaza la subida: DESCARTADA y la siguiente vez se vuelve a subir con reuploadCount 1', async () => {
  const rejected: ApiCallResult<CaptureUploadResponse> = {
    ok: false,
    networkError: false,
    status: 422,
    code: 'UPLOAD_SIGNATURE_INVALID',
  };
  const f = fake({ tickets: [ticket(), ticket()], uploads: [uploadedOk, uploadedOk], confirms: [rejected, confirmOk] });
  const first = await syncCapture(meta, 'file:///c1.jpg', f.deps, CFG);
  expect(first).toEqual({ kind: 'REPETIR_SUBIDA', step: 'CONFIRMACION', code: 'UPLOAD_SIGNATURE_INVALID' });
  expect(f.getStored()?.status).toBe('DESCARTADA');
  const second = await syncCapture(meta, 'file:///c1.jpg', f.deps, CFG);
  expect(second.kind).toBe('HECHO');
  expect(f.calls).toContain('save:1');
});

test('subidas repetidas agotadas: DEFINITIVO', async () => {
  const f = fake({ stored: { status: 'DESCARTADA', result: okResult(), reuploadCount: CFG.maxReuploads } });
  const out = await syncCapture(meta, 'file:///c1.jpg', f.deps, CFG);
  expect(out).toEqual({ kind: 'DEFINITIVO', step: 'SUBIDA', code: 'REINTENTOS_DE_SUBIDA_AGOTADOS' });
  expect(f.calls).toEqual([]);
});

test('foto más grande que el límite: DEFINITIVO sin llamadas (no se recomprime)', async () => {
  const f = fake({});
  const big = { ...meta, sizeBytes: CFG.maxUploadBytes + 1 };
  const out = await syncCapture(big, 'file:///c1.jpg', f.deps, CFG);
  expect(out).toEqual({ kind: 'DEFINITIVO', step: 'SUBIDA', code: 'FOTO_DEMASIADO_GRANDE' });
  expect(f.calls).toEqual([]);
});

test('errores al pedir el ticket y al subir', async () => {
  const noParent = fake({ tickets: [{ ok: false, networkError: false, status: 404, code: 'SEQUENCE_NOT_FOUND' }] });
  expect(await syncCapture(meta, 'f', noParent.deps, CFG)).toEqual({
    kind: 'SINCRONIZAR_PADRE',
    step: 'TICKET',
    code: 'SEQUENCE_NOT_FOUND',
  });
  const expired = fake({ tickets: [{ ok: false, networkError: false, status: 401, code: 'TOKEN_EXPIRED' }] });
  expect(await syncCapture(meta, 'f', expired.deps, CFG)).toEqual({ kind: 'RENOVAR_TOKEN', step: 'TICKET', code: 'TOKEN_EXPIRED' });
  const net = fake({ tickets: [ticket()], uploads: [{ ok: false, networkError: true }] });
  expect(await syncCapture(meta, 'f', net.deps, CFG)).toEqual({ kind: 'REINTENTAR', step: 'SUBIDA', code: 'RED' });
  const tooBig = fake({
    tickets: [ticket()],
    uploads: [{ ok: false, networkError: false, status: 400, message: 'File size too large. Got 12000000. Maximum is 10485760.' }],
  });
  expect(await syncCapture(meta, 'f', tooBig.deps, CFG)).toEqual({ kind: 'DEFINITIVO', step: 'SUBIDA', code: 'FOTO_DEMASIADO_GRANDE' });
});

test('configuración de subida coherente', () => {
  expect(CFG.uploadRequestTimeoutMs).toBeLessThan(CFG.ticketMinRemainingMs);
  expect(CFG.ticketMinRemainingMs).toBeLessThan(3_600_000);
  expect(CFG.maxUploadBytes).toBeLessThanOrEqual(10 * 1024 * 1024);
  expect(CFG.maxTicketRequests >= 2 && CFG.maxReuploads >= 1).toBe(true);
});
