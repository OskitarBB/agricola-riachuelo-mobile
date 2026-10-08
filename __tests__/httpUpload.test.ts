/** @jest-environment node */
// __tests__/httpUpload.test.ts — Receptor HTTP de fotos (maestro Anexo A.2 / E.3): cuerpo por bloques con md5,
// duplicado ALREADY_RECEIVED, md5 erróneo 422, Expect: 100-continue, sin Content-Length 411 y base64url.

import { createHash } from 'node:crypto';

import {
  decodeBase64UrlToText,
  encodeTextToBase64Url,
  HttpUploadConnection,
  type UploadSink,
} from '../src/local-network/httpUpload';
import { closeGracefully, httpStatusFor } from '../src/local-network/tcp/tcpFileReceiver';

function makeSink(expectedMd5: string, store: Map<string, string>, id: string): UploadSink {
  const hash = createHash('md5');
  return {
    write: (c) => hash.update(c),
    finish: async () => {
      const md5 = hash.digest('hex');
      if (md5 !== expectedMd5) return { status: 422, body: { result: 'REJECTED', reason: 'MD5_MISMATCH' } };
      if (store.get(id) === md5) return { status: 200, body: { result: 'ALREADY_RECEIVED', reason: null } };
      store.set(id, md5);
      return { status: 200, body: { result: 'RECEIVED', reason: null } };
    },
    abort: () => undefined,
  };
}

async function send(body: Uint8Array, md5: string, store: Map<string, string>, extraHeaders = '') {
  const out: Uint8Array[] = [];
  const conn = new HttpUploadConnection(
    (b) => out.push(b),
    () => undefined,
    async () => makeSink(md5, store, 'cap-1'),
  );
  const head = `POST /local/captures HTTP/1.1\r\nHost: x\r\nContent-Length: ${body.length}\r\n${extraHeaders}\r\n`;
  await conn.onData(new TextEncoder().encode(head));
  for (let i = 0; i < body.length; i += 65536) await conn.onData(body.subarray(i, i + 65536));
  return out.map((b) => new TextDecoder().decode(b)).join('');
}

test('foto de 3 MB: recibida, luego duplicada, y md5 erróneo', async () => {
  const body = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) & 0xff);
  const md5 = createHash('md5').update(body).digest('hex');
  const store = new Map<string, string>();
  expect(await send(body, md5, store)).toContain('"RECEIVED"');
  expect(await send(body, md5, store)).toContain('"ALREADY_RECEIVED"');
  expect(await send(body, 'f'.repeat(32), store)).toContain('422');
});

test('Expect: 100-continue y falta de Content-Length', async () => {
  const body = new Uint8Array([1, 2, 3]);
  const md5 = createHash('md5').update(body).digest('hex');
  const res = await send(body, md5, new Map(), 'Expect: 100-continue\r\n');
  expect(res).toContain('100 Continue');
  const out: Uint8Array[] = [];
  const conn = new HttpUploadConnection(
    (b) => out.push(b),
    () => undefined,
    async () => makeSink(md5, new Map(), 'x'),
  );
  await conn.onData(new TextEncoder().encode('POST /local/captures HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n'));
  expect(new TextDecoder().decode(out[0])).toContain('411');
});

test('base64url ida y vuelta (con tildes) y tabla de códigos HTTP', () => {
  const text = JSON.stringify({ a: 'Riachuelo — vid ñandú', n: 1 });
  expect(decodeBase64UrlToText(encodeTextToBase64Url(text))).toBe(text);
  expect(httpStatusFor({ result: 'RECEIVED', reason: null })).toBe(200);
  expect(httpStatusFor({ result: 'REJECTED', reason: 'MD5_MISMATCH' })).toBe(422);
  expect(httpStatusFor({ result: 'REJECTED', reason: 'NO_SPACE' })).toBe(507);
  expect(httpStatusFor({ result: 'REJECTED', reason: 'WRONG_DEVICE' })).toBe(403);
});

describe('cierre ordenado del receptor (v0.4.4: la cámara reenviaba la foto si la respuesta se cortaba)', () => {
  function fakeSocket() {
    const calls: string[] = [];
    let onClose: (() => void) | null = null;
    return {
      calls,
      closeNow: () => onClose?.(),
      end: () => calls.push('end'),
      destroy: () => calls.push('destroy'),
      onClose: (cb: () => void) => {
        onClose = cb;
      },
    };
  }
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test('envía FIN solo después de escribir la respuesta y no destruye si la cámara cierra', async () => {
    const s = fakeSocket();
    let flush!: () => void;
    closeGracefully(s, new Promise<void>((r) => (flush = r)), 50);
    await tick(10);
    expect(s.calls).toEqual([]); // la respuesta aún no se escribió: no se cierra nada
    flush();
    await tick(5);
    expect(s.calls).toEqual(['end']);
    s.closeNow();
    await tick(80);
    expect(s.calls).toEqual(['end']);
  });

  test('si la cámara no cierra, se destruye después de la espera', async () => {
    const s = fakeSocket();
    closeGracefully(s, Promise.resolve(), 20);
    await tick(60);
    expect(s.calls).toEqual(['end', 'destroy']);
  });
});
