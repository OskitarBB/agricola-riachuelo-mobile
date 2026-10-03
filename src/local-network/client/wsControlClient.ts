// src/local-network/client/wsControlClient.ts — Cliente de control de la CÁMARA (WebSocket nativo de RN).
//
// QUÉ HACE: conecta a ws://<host>:<controlPort>/control, valida cada mensaje recibido con zod y avisa
// los cambios de estado (CONECTANDO / CONECTADO / DESCONECTADO). La reconexión con esperas crecientes
// la decide src/camera/cameraAgent.ts (protocol.reconnectDelaysMs).
// Funciona también en Expo Go (WebSocket es parte de React Native): una cámara en Expo Go puede
// vincularse con un controlador instalado como APK.

import { parseEnvelope, serializeEnvelope } from '../../protocol/envelope';
import type { Envelope, MessageType } from '../../protocol/messages';
import type { ClientStatus, ControlClient, Unsubscribe } from '../transport';

export class WsControlClient implements ControlClient {
  private ws: WebSocket | null = null;
  private msgHandlers = new Set<(m: Envelope) => void>();
  private statusHandlers = new Set<(s: ClientStatus, detail?: string) => void>();
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  private emitStatus(s: ClientStatus, detail?: string): void {
    this.statusHandlers.forEach((h) => h(s, detail));
  }

  connect(url: string): Promise<void> {
    this.close();
    this.emitStatus('CONECTANDO');
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            ws.close();
          } catch {
            // nada
          }
          this.emitStatus('DESCONECTADO', 'timeout');
          reject(new Error('timeout'));
        }
      }, 8_000);
      ws.onopen = () => {
        clearTimeout(timer);
        this._connected = true;
        this.emitStatus('CONECTADO');
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      ws.onmessage = (ev: { data: unknown }) => {
        if (typeof ev.data !== 'string') return;
        const parsed = parseEnvelope(ev.data);
        if (parsed.ok) this.msgHandlers.forEach((h) => h(parsed.envelope));
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('error'));
        }
      };
      ws.onclose = (ev: { reason?: string }) => {
        clearTimeout(timer);
        const was = this._connected;
        this._connected = false;
        if (this.ws === ws) this.ws = null;
        if (was || settled) this.emitStatus('DESCONECTADO', ev.reason);
        if (!settled) {
          settled = true;
          this.emitStatus('DESCONECTADO', ev.reason);
          reject(new Error('closed'));
        }
      };
    });
  }

  send<T extends MessageType>(message: Envelope<T>): void {
    if (!this.ws || !this._connected) throw new Error('Sin conexión');
    this.ws.send(serializeEnvelope(message as Envelope));
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this._connected = false;
    if (ws) {
      try {
        ws.close();
      } catch {
        // ya cerrado
      }
    }
  }

  onMessage(handler: (message: Envelope) => void): Unsubscribe {
    this.msgHandlers.add(handler);
    return () => this.msgHandlers.delete(handler);
  }

  onStatus(handler: (status: ClientStatus, detail?: string) => void): Unsubscribe {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }
}
