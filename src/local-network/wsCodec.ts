// CÓDIGO DE REFERENCIA PROBADO (maestro, Anexo A). No modificar sin actualizar __tests__/wsCodec.test.ts.
// src/local-network/wsCodec.ts — Servidor WebSocket mínimo (RFC 6455) sobre un socket TCP crudo.
// Sin dependencias de plataforma: recibe bytes (Uint8Array) y entrega bytes. En la app, el socket es
// react-native-tcp-socket y sha1Base64 usa expo-crypto (digestStringAsync SHA-1, codificación BASE64).
export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const OPCODE = { CONTINUATION: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa } as const;
export type Sha1Base64 = (input: string) => Promise<string>;
export class WsProtocolError extends Error {
  constructor(
    message: string,
    public readonly closeCode: number = 1002,
  ) {
    super(message);
    this.name = 'WsProtocolError';
  }
}
export interface HttpRequestHead {
  method: string;
  path: string;
  headers: Record<string, string>; // claves en minúsculas
  headerBytes: number; // bytes ocupados por la cabecera, incluido \r\n\r\n
}
function asciiDecode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
function asciiEncode(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}
export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
/** Devuelve la cabecera HTTP si ya llegó completa (termina en \r\n\r\n); si no, null. */
export function parseHttpHead(bytes: Uint8Array, maxHeaderBytes = 8192): HttpRequestHead | null {
  const limit = Math.min(bytes.length, maxHeaderBytes);
  for (let i = 3; i < limit; i++) {
    if (bytes[i - 3] === 13 && bytes[i - 2] === 10 && bytes[i - 1] === 13 && bytes[i] === 10) {
      const lines = asciiDecode(bytes.subarray(0, i - 3)).split('\r\n');
      const [method = '', path = ''] = (lines[0] ?? '').split(' ');
      const headers: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const idx = line.indexOf(':');
        if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
      }
      return { method, path, headers, headerBytes: i + 1 };
    }
  }
  if (bytes.length >= maxHeaderBytes) throw new WsProtocolError('Cabecera HTTP demasiado grande', 1009);
  return null;
}
export async function computeAcceptKey(secWebSocketKey: string, sha1Base64: Sha1Base64): Promise<string> {
  return sha1Base64(secWebSocketKey + WS_GUID);
}
export function encodeFrame(opcode: number, payload: Uint8Array, fin = true): Uint8Array {
  const len = payload.length;
  const headerLen = len < 126 ? 2 : len <= 0xffff ? 4 : 10;
  const out = new Uint8Array(headerLen + len);
  out[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
  if (len < 126) {
    out[1] = len;
  } else if (len <= 0xffff) {
    out[1] = 126;
    out[2] = (len >>> 8) & 0xff;
    out[3] = len & 0xff;
  } else {
    out[1] = 127;
    const hi = Math.floor(len / 0x100000000);
    const lo = len >>> 0;
    out[2] = (hi >>> 24) & 0xff;
    out[3] = (hi >>> 16) & 0xff;
    out[4] = (hi >>> 8) & 0xff;
    out[5] = hi & 0xff;
    out[6] = (lo >>> 24) & 0xff;
    out[7] = (lo >>> 16) & 0xff;
    out[8] = (lo >>> 8) & 0xff;
    out[9] = lo & 0xff;
  }
  out.set(payload, headerLen);
  return out;
}
export interface WsFrame {
  fin: boolean;
  opcode: number;
  payload: Uint8Array;
}
/** Decodifica frames del cliente (enmascarados) aunque lleguen partidos en varios bloques TCP. */
export class FrameDecoder {
  private buf: Uint8Array = new Uint8Array(0);
  constructor(
    private readonly maxPayload = 64 * 1024,
    private readonly requireMask = true,
  ) {}
  push(chunk: Uint8Array): WsFrame[] {
    this.buf = concatBytes(this.buf, chunk);
    const frames: WsFrame[] = [];
    for (;;) {
      const buf = this.buf;
      if (buf.length < 2) break;
      const b0 = buf[0];
      const b1 = buf[1];
      if ((b0 & 0x70) !== 0) throw new WsProtocolError('Bits RSV activos sin extensión negociada');
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      if (this.requireMask && !masked) throw new WsProtocolError('Los frames del cliente deben venir enmascarados');
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) break;
        len = (buf[2] << 8) | buf[3];
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) break;
        const hi = ((buf[2] << 24) | (buf[3] << 16) | (buf[4] << 8) | buf[5]) >>> 0;
        const lo = ((buf[6] << 24) | (buf[7] << 16) | (buf[8] << 8) | buf[9]) >>> 0;
        if (hi !== 0) throw new WsProtocolError('Frame demasiado grande', 1009);
        len = lo;
        offset = 10;
      }
      if (len > this.maxPayload) throw new WsProtocolError('Frame demasiado grande', 1009);
      const isControl = (opcode & 0x08) !== 0;
      if (isControl && (!fin || len > 125)) throw new WsProtocolError('Frame de control inválido');
      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + len) break;
      const start = offset + maskLen;
      const payload = buf.slice(start, start + len);
      if (masked) {
        const m0 = buf[offset],
          m1 = buf[offset + 1],
          m2 = buf[offset + 2],
          m3 = buf[offset + 3];
        for (let i = 0; i < payload.length; i++) {
          const k = i & 3;
          payload[i] ^= k === 0 ? m0 : k === 1 ? m1 : k === 2 ? m2 : m3;
        }
      }
      frames.push({ fin, opcode, payload });
      this.buf = buf.slice(start + len);
    }
    return frames;
  }
}
export type WsEvent =
  | { kind: 'text'; text: string }
  | { kind: 'binary'; data: Uint8Array }
  | { kind: 'ping'; data: Uint8Array }
  | { kind: 'pong'; data: Uint8Array }
  | { kind: 'close'; code: number; reason: string };
/** Une frames fragmentados en mensajes completos; los frames de control pasan directo. */
export class MessageAssembler {
  private parts: Uint8Array[] = [];
  private size = 0;
  private opcode: number | null = null;
  private readonly decoder = new TextDecoder();
  constructor(private readonly maxMessage = 64 * 1024) {}
  accept(frame: WsFrame): WsEvent | null {
    switch (frame.opcode) {
      case OPCODE.PING:
        return { kind: 'ping', data: frame.payload };
      case OPCODE.PONG:
        return { kind: 'pong', data: frame.payload };
      case OPCODE.CLOSE: {
        const p = frame.payload;
        const code = p.length >= 2 ? (p[0] << 8) | p[1] : 1005;
        const reason = p.length > 2 ? this.decoder.decode(p.subarray(2)) : '';
        return { kind: 'close', code, reason };
      }
      case OPCODE.TEXT:
      case OPCODE.BINARY:
        if (this.opcode !== null) throw new WsProtocolError('Nuevo mensaje antes de terminar el anterior');
        this.opcode = frame.opcode;
        break;
      case OPCODE.CONTINUATION:
        if (this.opcode === null) throw new WsProtocolError('Continuación sin mensaje iniciado');
        break;
      default:
        throw new WsProtocolError(`Opcode no soportado: ${frame.opcode}`);
    }
    this.size += frame.payload.length;
    if (this.size > this.maxMessage) throw new WsProtocolError('Mensaje demasiado grande', 1009);
    this.parts.push(frame.payload);
    if (!frame.fin) return null;
    const data = new Uint8Array(this.size);
    let off = 0;
    for (const part of this.parts) {
      data.set(part, off);
      off += part.length;
    }
    const opcode = this.opcode;
    this.parts = [];
    this.size = 0;
    this.opcode = null;
    return opcode === OPCODE.TEXT ? { kind: 'text', text: this.decoder.decode(data) } : { kind: 'binary', data };
  }
}
export interface WsConnectionHandlers {
  onOpen(head: HttpRequestHead): void;
  onText(text: string): void;
  onClose(code: number, reason: string): void;
  onError(error: Error): void;
}
/**
 * Conexión de servidor: valida el handshake, responde 101, decodifica mensajes, responde PING con PONG
 * y completa el cierre. `write` envía bytes por el socket; `end` cierra el socket.
 */
export class WsServerConnection {
  private state: 'HANDSHAKE' | 'OPEN' | 'CLOSING' | 'CLOSED' = 'HANDSHAKE';
  private pending: Uint8Array = new Uint8Array(0);
  private queue: Promise<void> = Promise.resolve();
  private readonly decoder: FrameDecoder;
  private readonly assembler: MessageAssembler;
  private readonly encoder = new TextEncoder();
  constructor(
    private readonly write: (bytes: Uint8Array) => void,
    private readonly end: () => void,
    private readonly sha1Base64: Sha1Base64,
    private readonly handlers: WsConnectionHandlers,
    maxMessageBytes = 64 * 1024,
  ) {
    this.decoder = new FrameDecoder(maxMessageBytes);
    this.assembler = new MessageAssembler(maxMessageBytes);
  }
  get isOpen(): boolean {
    return this.state === 'OPEN';
  }
  /** Llamar con cada bloque recibido del socket. Procesa en orden aunque el handshake sea asíncrono. */
  onData(chunk: Uint8Array): Promise<void> {
    this.queue = this.queue.then(() => this.process(chunk)).catch((err: unknown) => this.fail(err));
    return this.queue;
  }
  sendText(text: string): void {
    if (this.state !== 'OPEN') throw new Error('WebSocket no abierto');
    this.write(encodeFrame(OPCODE.TEXT, this.encoder.encode(text)));
  }
  close(code = 1000, reason = ''): void {
    if (this.state === 'CLOSED' || this.state === 'CLOSING') return;
    if (this.state === 'OPEN') this.write(encodeFrame(OPCODE.CLOSE, this.closePayload(code, reason)));
    this.state = 'CLOSING';
  }
  private closePayload(code: number, reason: string): Uint8Array {
    const r = this.encoder.encode(reason);
    const p = new Uint8Array(2 + r.length);
    p[0] = (code >>> 8) & 0xff;
    p[1] = code & 0xff;
    p.set(r, 2);
    return p;
  }
  private async process(chunk: Uint8Array): Promise<void> {
    if (this.state === 'CLOSED') return;
    if (this.state === 'HANDSHAKE') {
      this.pending = concatBytes(this.pending, chunk);
      const head = parseHttpHead(this.pending);
      if (!head) return;
      const h = head.headers;
      const key = h['sec-websocket-key'];
      const valid =
        head.method === 'GET' &&
        (h['upgrade'] ?? '').toLowerCase() === 'websocket' &&
        (h['connection'] ?? '').toLowerCase().includes('upgrade') &&
        h['sec-websocket-version'] === '13' &&
        typeof key === 'string' &&
        key.length > 0;
      if (!valid) {
        this.write(asciiEncode('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
        this.state = 'CLOSED';
        this.end();
        return;
      }
      const accept = await computeAcceptKey(key, this.sha1Base64);
      this.write(
        asciiEncode(
          'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        ),
      );
      this.state = 'OPEN';
      const rest = this.pending.slice(head.headerBytes);
      this.pending = new Uint8Array(0);
      this.handlers.onOpen(head);
      if (rest.length === 0) return;
      chunk = rest;
    }
    for (const frame of this.decoder.push(chunk)) {
      const ev = this.assembler.accept(frame);
      if (!ev) continue;
      if (ev.kind === 'text') this.handlers.onText(ev.text);
      else if (ev.kind === 'ping') this.write(encodeFrame(OPCODE.PONG, ev.data));
      else if (ev.kind === 'close') {
        if (this.state === 'OPEN')
          this.write(encodeFrame(OPCODE.CLOSE, this.closePayload(ev.code === 1005 ? 1000 : ev.code, '')));
        this.state = 'CLOSED';
        this.handlers.onClose(ev.code, ev.reason);
        this.end();
        return;
      }
      // Mensajes binarios y PONG se ignoran en el protocolo v1.
    }
  }
  private fail(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    const code = err instanceof WsProtocolError ? err.closeCode : 1011;
    if (this.state === 'OPEN') this.write(encodeFrame(OPCODE.CLOSE, this.closePayload(code, '')));
    this.state = 'CLOSED';
    this.handlers.onError(error);
    this.end();
  }
}
