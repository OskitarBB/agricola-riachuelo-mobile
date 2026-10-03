// CÓDIGO DE REFERENCIA PROBADO (maestro, Anexo A.2). No modificar sin actualizar __tests__/httpUpload.test.ts.
// src/local-network/httpUpload.ts — Receptor HTTP mínimo para la opción A de transferencia
// (POST /local/captures con el JPEG como cuerpo binario y metadatos en la cabecera X-Capture-Meta).
// Sin dependencias de plataforma: en la app, el socket es react-native-tcp-socket y el sink escribe con FileHandle.
import { concatBytes, parseHttpHead, type HttpRequestHead } from './wsCodec';
export interface UploadResult {
  status: number;
  body: unknown;
}
export interface UploadSink {
  /** Bloque del cuerpo en orden. */
  write(chunk: Uint8Array): void;
  /** Cuerpo completo: verificar tamaño/hash, registrar en SQLite y devolver la respuesta. */
  finish(): Promise<UploadResult>;
  /** Conexión cortada o error: descartar el archivo temporal. */
  abort(reason: string): void;
}
/** Decide si acepta la petición. Devuelve un sink o una respuesta inmediata de rechazo. */
export type UploadRouter = (head: HttpRequestHead, contentLength: number) => Promise<UploadSink | UploadResult>;
const REASONS: Record<number, string> = {
  100: 'Continue',
  200: 'OK',
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  411: 'Length Required',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
  507: 'Insufficient Storage',
};
function responseBytes(status: number, body: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(body));
  const head =
    `HTTP/1.1 ${status} ${REASONS[status] ?? 'Status'}\r\nContent-Type: application/json\r\n` +
    `Content-Length: ${json.length}\r\nConnection: close\r\n\r\n`;
  const headBytes = new TextEncoder().encode(head);
  return concatBytes(headBytes, json);
}
function isSink(x: UploadSink | UploadResult): x is UploadSink {
  return typeof (x as UploadSink).write === 'function';
}
export class HttpUploadConnection {
  private state: 'HEAD' | 'BODY' | 'DONE' = 'HEAD';
  private pending: Uint8Array = new Uint8Array(0);
  private remaining = 0;
  private sink: UploadSink | null = null;
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private readonly write: (bytes: Uint8Array) => void,
    private readonly end: () => void,
    private readonly route: UploadRouter,
    private readonly maxBodyBytes = 50 * 1024 * 1024,
  ) {}
  onData(chunk: Uint8Array): Promise<void> {
    this.queue = this.queue
      .then(() => this.process(chunk))
      .catch((err: unknown) => {
        this.sink?.abort(String(err));
        this.respond(500, { result: 'REJECTED', reason: 'INTERNAL' });
      });
    return this.queue;
  }
  /** Llamar si el socket se cierra antes de terminar. */
  onClose(): void {
    if (this.state === 'BODY') this.sink?.abort('Conexión cerrada antes de recibir todo el cuerpo');
    this.state = 'DONE';
  }
  private respond(status: number, body: unknown): void {
    if (this.state === 'DONE') return;
    this.state = 'DONE';
    this.write(responseBytes(status, body));
    this.end();
  }
  private async process(chunk: Uint8Array): Promise<void> {
    if (this.state === 'DONE') return;
    if (this.state === 'HEAD') {
      this.pending = concatBytes(this.pending, chunk);
      const head = parseHttpHead(this.pending);
      if (!head) return;
      const rest = this.pending.slice(head.headerBytes);
      this.pending = new Uint8Array(0);
      if ((head.headers['transfer-encoding'] ?? '').toLowerCase().includes('chunked')) {
        this.respond(411, { result: 'REJECTED', reason: 'LENGTH_REQUIRED' });
        return;
      }
      const contentLength = Number(head.headers['content-length']);
      if (!Number.isInteger(contentLength) || contentLength <= 0) {
        this.respond(411, { result: 'REJECTED', reason: 'LENGTH_REQUIRED' });
        return;
      }
      if (contentLength > this.maxBodyBytes) {
        this.respond(413, { result: 'REJECTED', reason: 'PAYLOAD_TOO_LARGE' });
        return;
      }
      const routed = await this.route(head, contentLength);
      if (!isSink(routed)) {
        this.respond(routed.status, routed.body);
        return;
      }
      if ((head.headers['expect'] ?? '').toLowerCase() === '100-continue') {
        this.write(new TextEncoder().encode('HTTP/1.1 100 Continue\r\n\r\n'));
      }
      this.sink = routed;
      this.remaining = contentLength;
      this.state = 'BODY';
      if (rest.length === 0) return;
      chunk = rest;
    }
    if (this.state === 'BODY' && this.sink) {
      const take = chunk.length <= this.remaining ? chunk : chunk.subarray(0, this.remaining);
      this.sink.write(take);
      this.remaining -= take.length;
      if (this.remaining === 0) {
        const result = await this.sink.finish();
        this.respond(result.status, result.body);
      }
    }
  }
}
/** base64url → texto UTF-8 (para la cabecera X-Capture-Meta). Sin depender de Buffer. */
export function decodeBase64UrlToText(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error('base64url inválido');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
/** Texto UTF-8 → base64url sin relleno (lado cámara). */
export function encodeTextToBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + alphabet[(n >> 6) & 63] + alphabet[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + alphabet[(n >> 6) & 63];
  }
  return out;
}
