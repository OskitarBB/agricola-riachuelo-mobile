// src/local-network/tcp/tcpControlServer.ts — Servidor de control REAL del controlador (maestro §14.11).
//
// SOLO DEVELOPMENT BUILD / APK (Fase 2). Nunca se importa en Expo Go: factory.ts lo carga con require()
// diferido y le pasa el módulo react-native-tcp-socket ya cargado (regla R-04).
//
// QUÉ HACE: abre un servidor TCP en 0.0.0.0:<controlPort>; por cada conexión crea un WsServerConnection
// (códec WebSocket propio, Anexo A) que valida el handshake y entrega mensajes de texto. Cada texto se
// valida con zod (parseEnvelope) y se entrega a la app con el deviceId del emisor.
// Un socket queda asociado al primer deviceId que envía; si luego envía otro → ERROR UNKNOWN_DEVICE y se cierra.

import * as Crypto from 'expo-crypto';
import type TcpSocketsModule from 'react-native-tcp-socket';

import { createEnvelope, parseEnvelope, serializeEnvelope } from '../../protocol/envelope';
import type { Envelope, MessageType } from '../../protocol/messages';
import type { ControlServer, PeerInfo, Unsubscribe } from '../transport';
import { WsServerConnection } from '../wsCodec';

type TcpModule = typeof TcpSocketsModule;
type TcpServer = ReturnType<TcpModule['createServer']>;
type TcpSocket = Parameters<NonNullable<Parameters<TcpModule['createServer']>[1]>>[0];

interface Conn {
  id: number;
  ws: WsServerConnection;
  socket: TcpSocket;
  deviceId: string | null;
  remoteAddress: string;
}

const sha1Base64 = (s: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, s, { encoding: Crypto.CryptoEncoding.BASE64 });

export class TcpControlServer implements ControlServer {
  private server: TcpServer | null = null;
  private conns = new Map<number, Conn>();
  private nextId = 1;
  private msgHandlers = new Set<(from: PeerInfo, m: Envelope) => void>();
  private closeHandlers = new Set<(p: PeerInfo, reason: string) => void>();
  private invalidHandlers = new Set<(from: PeerInfo | null, detail: string, messageId: string | null) => void>();

  constructor(
    private readonly tcp: TcpModule,
    private readonly getIp: () => Promise<string | null>,
    private readonly maxMessageBytes: number,
    private readonly selfDeviceId: () => string,
  ) {}

  async start(port: number): Promise<{ host: string; port: number }> {
    if (this.server) await this.stop();
    await new Promise<void>((resolve, reject) => {
      const server = this.tcp.createServer((socket) => this.accept(socket));
      server.on('error', (err: Error) => reject(err));
      server.listen({ port, host: '0.0.0.0', reuseAddress: true }, () => resolve());
      this.server = server;
    });
    return { host: (await this.getIp()) ?? '0.0.0.0', port };
  }

  async stop(): Promise<void> {
    for (const c of this.conns.values()) {
      try {
        c.ws.close(1001, 'stop');
        c.socket.destroy();
      } catch {
        // ya cerrado
      }
    }
    this.conns.clear();
    const s = this.server;
    this.server = null;
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  private peer(c: Conn): PeerInfo {
    return { deviceId: c.deviceId ?? '', role: null, remoteAddress: c.remoteAddress };
  }

  private accept(socket: TcpSocket): void {
    const id = this.nextId++;
    const conn: Conn = {
      id,
      socket,
      deviceId: null,
      remoteAddress: socket.remoteAddress ?? '',
      ws: null as unknown as WsServerConnection,
    };
    conn.ws = new WsServerConnection(
      (bytes) => {
        socket.write(bytes);
      },
      () => socket.destroy(),
      sha1Base64,
      {
        onOpen: () => undefined,
        onText: (text) => this.onText(conn, text),
        onClose: (_code, reason) => this.dropConn(conn, reason || 'close'),
        onError: (err) => this.dropConn(conn, err.message),
      },
      this.maxMessageBytes,
    );
    this.conns.set(id, conn);
    socket.on('data', (chunk: string | Uint8Array) => {
      const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      void conn.ws.onData(bytes);
    });
    socket.on('error', () => this.dropConn(conn, 'socket_error'));
    socket.on('close', () => this.dropConn(conn, 'socket_closed'));
  }

  private dropConn(conn: Conn, reason: string): void {
    if (!this.conns.has(conn.id)) return;
    this.conns.delete(conn.id);
    if (conn.deviceId) this.closeHandlers.forEach((h) => h(this.peer(conn), reason));
  }

  private onText(conn: Conn, text: string): void {
    const parsed = parseEnvelope(text);
    if (!parsed.ok) {
      this.invalidHandlers.forEach((h) => h(conn.deviceId ? this.peer(conn) : null, parsed.detail, parsed.messageId));
      return;
    }
    const env = parsed.envelope;
    if (conn.deviceId && conn.deviceId !== env.deviceId) {
      const err = createEnvelope('ERROR', env.sessionId, this.selfDeviceId(), {
        code: 'UNKNOWN_DEVICE',
        detail: null,
        refMessageId: env.messageId,
      });
      this.rawSend(conn, err);
      conn.socket.destroy();
      return;
    }
    if (!conn.deviceId) {
      // Si ese deviceId ya tenía otro socket (reconexión), el anterior se cierra.
      for (const other of this.conns.values()) {
        if (other !== conn && other.deviceId === env.deviceId) {
          this.conns.delete(other.id);
          try {
            other.socket.destroy();
          } catch {
            // ya cerrado
          }
        }
      }
      conn.deviceId = env.deviceId;
    }
    this.msgHandlers.forEach((h) => h(this.peer(conn), env));
  }

  private rawSend(conn: Conn, env: Envelope): void {
    try {
      if (conn.ws.isOpen) conn.ws.sendText(serializeEnvelope(env));
    } catch {
      // socket cerrado: el monitor marcará la cámara como PERDIDA
    }
  }

  send<T extends MessageType>(deviceId: string, message: Envelope<T>): void {
    for (const c of this.conns.values()) if (c.deviceId === deviceId) this.rawSend(c, message as Envelope);
  }

  broadcast<T extends MessageType>(message: Envelope<T>): void {
    for (const c of this.conns.values()) if (c.deviceId) this.rawSend(c, message as Envelope);
  }

  disconnect(deviceId: string, reason: string): void {
    for (const c of [...this.conns.values()]) {
      if (c.deviceId === deviceId) {
        try {
          c.ws.close(1000, reason);
          c.socket.destroy();
        } catch {
          // ya cerrado
        }
        this.dropConn(c, reason);
      }
    }
  }

  onMessage(handler: (from: PeerInfo, message: Envelope) => void): Unsubscribe {
    this.msgHandlers.add(handler);
    return () => this.msgHandlers.delete(handler);
  }

  onPeerClosed(handler: (peer: PeerInfo, reason: string) => void): Unsubscribe {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  onInvalid(handler: (from: PeerInfo | null, detail: string, messageId: string | null) => void): Unsubscribe {
    this.invalidHandlers.add(handler);
    return () => this.invalidHandlers.delete(handler);
  }
}
