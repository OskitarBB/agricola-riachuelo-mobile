/** @jest-environment node */
// __tests__/wsCodec.test.ts — Códec WebSocket (maestro Anexo A.1 / E.2): clave RFC 6455, frames partidos,
// longitudes de 16 bits, fragmentación, ping/pong, cierre y límite de tamaño.

import { createHash } from 'node:crypto';

import {
  computeAcceptKey,
  encodeFrame,
  FrameDecoder,
  MessageAssembler,
  OPCODE,
  WsServerConnection,
} from '../src/local-network/wsCodec';

const sha1Base64 = async (s: string) => createHash('sha1').update(s).digest('base64');

function mask(frame: Uint8Array): Uint8Array {
  // Convierte un frame del servidor (sin máscara) en uno de cliente (con máscara).
  const b1 = frame[1] & 0x7f;
  const headerLen = b1 < 126 ? 2 : b1 === 126 ? 4 : 10;
  const payload = frame.subarray(headerLen);
  const key = [0x12, 0x34, 0x56, 0x78];
  const out = new Uint8Array(headerLen + 4 + payload.length);
  out.set(frame.subarray(0, headerLen));
  out[1] |= 0x80;
  out.set(key, headerLen);
  for (let i = 0; i < payload.length; i++) out[headerLen + 4 + i] = payload[i] ^ key[i & 3];
  return out;
}

test('clave de aceptación del ejemplo de la RFC 6455', async () => {
  expect(await computeAcceptKey('dGhlIHNhbXBsZSBub25jZQ==', sha1Base64)).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('decodifica frames enmascarados aunque lleguen byte a byte (16 bits)', () => {
  const text = 'x'.repeat(1000);
  const frame = mask(encodeFrame(OPCODE.TEXT, new TextEncoder().encode(text)));
  const dec = new FrameDecoder();
  const asm = new MessageAssembler();
  let got = '';
  for (const b of frame) {
    for (const f of dec.push(new Uint8Array([b]))) {
      const ev = asm.accept(f);
      if (ev?.kind === 'text') got = ev.text;
    }
  }
  expect(got).toBe(text);
});

test('une mensajes fragmentados y rechaza frames sin máscara', () => {
  const dec = new FrameDecoder();
  const asm = new MessageAssembler();
  const a = mask(encodeFrame(OPCODE.TEXT, new TextEncoder().encode('Hola '), false));
  const b = mask(encodeFrame(OPCODE.CONTINUATION, new TextEncoder().encode('campo'), true));
  const evs = [...dec.push(a), ...dec.push(b)].map((f) => asm.accept(f)).filter(Boolean);
  expect(evs).toEqual([{ kind: 'text', text: 'Hola campo' }]);
  expect(() => new FrameDecoder().push(encodeFrame(OPCODE.TEXT, new Uint8Array([1])))).toThrow();
});

test('servidor: handshake, texto, ping/pong y cierre', async () => {
  const written: Uint8Array[] = [];
  const texts: string[] = [];
  let closed = false;
  const conn = new WsServerConnection(
    (b) => written.push(b),
    () => {
      closed = true;
    },
    sha1Base64,
    { onOpen: () => undefined, onText: (t) => texts.push(t), onClose: () => undefined, onError: () => undefined },
  );
  const req =
    'GET /control HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n';
  await conn.onData(new TextEncoder().encode(req));
  expect(new TextDecoder().decode(written[0])).toContain('101 Switching Protocols');
  expect(conn.isOpen).toBe(true);
  await conn.onData(mask(encodeFrame(OPCODE.TEXT, new TextEncoder().encode('{"a":1}'))));
  expect(texts).toEqual(['{"a":1}']);
  await conn.onData(mask(encodeFrame(OPCODE.PING, new Uint8Array([7]))));
  expect(written[written.length - 1][0] & 0x0f).toBe(OPCODE.PONG);
  await conn.onData(mask(encodeFrame(OPCODE.CLOSE, new Uint8Array([0x03, 0xe8]))));
  expect(closed).toBe(true);
});

test('handshake inválido responde 400', async () => {
  const written: Uint8Array[] = [];
  const conn = new WsServerConnection(
    (b) => written.push(b),
    () => undefined,
    sha1Base64,
    {
      onOpen: () => undefined,
      onText: () => undefined,
      onClose: () => undefined,
      onError: () => undefined,
    },
  );
  await conn.onData(new TextEncoder().encode('GET / HTTP/1.1\r\nHost: x\r\n\r\n'));
  expect(new TextDecoder().decode(written[0])).toContain('400');
});

test('mensaje sobre el límite cierra con 1009', () => {
  const dec = new FrameDecoder(10);
  const frame = mask(encodeFrame(OPCODE.TEXT, new Uint8Array(20)));
  expect(() => dec.push(frame)).toThrow(/grande/);
});
