// src/local-network/tcp/tcpFileReceiver.ts — Receptor HTTP REAL de fotos en el controlador (opción A, §14.8).
//
// SOLO DEVELOPMENT BUILD / APK (Fase 2). Se carga con require() diferido desde factory.ts.
//
// QUÉ HACE: servidor TCP en <filePort> que entiende un POST /local/captures con el JPEG como cuerpo
// binario y los metadatos en la cabecera X-Capture-Meta (JSON en base64url). El cuerpo se escribe por
// bloques en incoming/{captureId}.part con FileHandle.writeBytes (no se acumula en memoria). Al terminar,
// el manejador de la app (consolidationService) verifica md5/tamaño, mueve la foto y responde.
// Tabla de códigos HTTP ↔ LocalCaptureResponse: maestro §14.8.

import { FileMode, type FileHandle } from 'expo-file-system';
import type TcpSocketsModule from 'react-native-tcp-socket';

import type { LocalCaptureMeta, LocalCaptureResponse } from '../../protocol/messages';
import { localCaptureMetaSchema } from '../../protocol/schemas';
import { deleteFileIfExists, freeSpaceBytes, incomingPath } from '../../storage/files';
import { decodeBase64UrlToText, HttpUploadConnection, type UploadResult, type UploadSink } from '../httpUpload';
import type { FileReceiver, Unsubscribe } from '../transport';

type TcpModule = typeof TcpSocketsModule;
type TcpServer = ReturnType<TcpModule['createServer']>;
type Handler = (meta: LocalCaptureMeta, tempFileUri: string, remoteAddress: string | null) => Promise<LocalCaptureResponse>;

const MAX_BODY_BYTES = 50 * 1024 * 1024;
const SPACE_MARGIN_BYTES = 50 * 1024 * 1024;

export function httpStatusFor(r: LocalCaptureResponse): number {
  if (r.result !== 'REJECTED') return 200;
  switch (r.reason) {
    case 'INVALID_META':
      return 400;
    case 'WRONG_DEVICE':
      return 403;
    case 'NOT_FOUND':
    case 'UNKNOWN_SESSION':
    case 'UNKNOWN_SEQUENCE':
      return 404;
    case 'CAPTURE_CONFLICT':
      return 409;
    case 'LENGTH_REQUIRED':
      return 411;
    case 'PAYLOAD_TOO_LARGE':
      return 413;
    case 'MD5_MISMATCH':
    case 'SIZE_MISMATCH':
      return 422;
    case 'NO_SPACE':
      return 507;
    default:
      return 500;
  }
}

function rejected(reason: LocalCaptureResponse['reason']): UploadResult {
  const body: LocalCaptureResponse = { result: 'REJECTED', reason };
  return { status: httpStatusFor(body), body };
}

export class TcpFileReceiver implements FileReceiver {
  private server: TcpServer | null = null;
  private handler: Handler | null = null;

  constructor(private readonly tcp: TcpModule) {}

  async start(port: number): Promise<void> {
    if (this.server) await this.stop();
    await new Promise<void>((resolve, fail) => {
      const server = this.tcp.createServer((socket) => {
        const remote = socket.remoteAddress ?? null;
        const conn = new HttpUploadConnection(
          (bytes) => {
            socket.write(bytes);
          },
          () => socket.destroy(),
          async (head, contentLength) => {
            if (head.method !== 'POST' || head.path.split('?')[0] !== '/local/captures') return rejected('NOT_FOUND');
            let meta: LocalCaptureMeta;
            try {
              const parsed = localCaptureMetaSchema.safeParse(
                JSON.parse(decodeBase64UrlToText(head.headers['x-capture-meta'] ?? '')),
              );
              if (!parsed.success) return rejected('INVALID_META');
              meta = parsed.data as LocalCaptureMeta;
            } catch {
              return rejected('INVALID_META');
            }
            const free = freeSpaceBytes();
            if (free !== null && free < contentLength + SPACE_MARGIN_BYTES) return rejected('NO_SPACE');
            return this.makeSink(meta, remote);
          },
          MAX_BODY_BYTES,
        );
        socket.on('data', (chunk: string | Uint8Array) => {
          void conn.onData(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
        });
        socket.on('close', () => conn.onClose());
        socket.on('error', () => conn.onClose());
      });
      server.on('error', (err: Error) => fail(err));
      server.listen({ port, host: '0.0.0.0', reuseAddress: true }, () => resolve());
      this.server = server;
    });
  }

  private makeSink(meta: LocalCaptureMeta, remote: string | null): UploadSink {
    const file = incomingPath(meta.captureId);
    deleteFileIfExists(file.uri);
    file.create({ intermediates: true });
    const handle: FileHandle = file.open(FileMode.WriteOnly);
    let closed = false;
    const close = () => {
      if (!closed) {
        closed = true;
        try {
          handle.close();
        } catch {
          // ya cerrado
        }
      }
    };
    return {
      write: (chunk) => handle.writeBytes(chunk),
      finish: async () => {
        close();
        if (!this.handler) return rejected('INTERNAL');
        try {
          const res = await this.handler(meta, file.uri, remote);
          return { status: httpStatusFor(res), body: res };
        } catch {
          return rejected('INTERNAL');
        } finally {
          deleteFileIfExists(file.uri); // si el manejador movió el archivo, ya no existe
        }
      },
      abort: () => {
        close();
        deleteFileIfExists(file.uri);
      },
    };
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  onCapture(handler: Handler): Unsubscribe {
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = null;
    };
  }
}
