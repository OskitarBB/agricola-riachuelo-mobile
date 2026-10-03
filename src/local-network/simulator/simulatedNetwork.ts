// src/local-network/simulator/simulatedNetwork.ts — Red local SIMULADA en memoria (Expo Go, Fase 1).
//
// QUÉ HACE: implementa ControlServer y FileReceiver sin sockets. Dos cámaras virtuales (virtualCamera.ts)
// viven dentro del controlador y hablan EXACTAMENTE el mismo protocolo: cada mensaje se serializa y se
// vuelve a validar con zod (parseEnvelope), igual que en la red real. Así el flujo completo
// (emparejar → prueba corta → pasada → secuencias → transferencias) se prueba con un solo iPhone.
// Incluye controles para inducir fallos (cortar enlace, foto oscura, cámara apagada).

import { parseEnvelope, serializeEnvelope } from '../../protocol/envelope';
import type { Envelope, LocalCaptureMeta, LocalCaptureResponse, MessageType, PairingQrPayload } from '../../protocol/messages';
import { deleteFileIfExists } from '../../storage/files';
import type { ControlServer, FileReceiver, PeerInfo, SimulatorControls, Unsubscribe } from '../transport';
import { VirtualCamera, type VirtualCameraHost, type VirtualUser } from './virtualCamera';
import type { CameraRole } from '../../domain/types';

/** Latencia simulada del Wi-Fi por mensaje. */
const LINK_LATENCY_MS = 25;

type CaptureHandler = (
  meta: LocalCaptureMeta,
  tempFileUri: string,
  remoteAddress: string | null,
) => Promise<LocalCaptureResponse>;

let userProvider: () => VirtualUser = () => ({
  id: 'sim-user',
  name: 'Operador',
  roles: ['OPERADOR_CAMPO'],
  authMode: 'OFFLINE',
});
let platformProvider: () => 'android' | 'ios' = () => 'ios';

/** El controlador indica qué usuario "tiene sesión" en las cámaras virtuales (mismo operador, D-04). */
export function setSimulatorUser(provider: () => VirtualUser, platform: () => 'android' | 'ios'): void {
  userProvider = provider;
  platformProvider = platform;
}

class SimulatedHub implements VirtualCameraHost, SimulatorControls {
  running = false;
  receiverRunning = false;
  readonly cams: Record<CameraRole, VirtualCamera>;
  private msgHandlers = new Set<(from: PeerInfo, m: Envelope) => void>();
  private closeHandlers = new Set<(p: PeerInfo, reason: string) => void>();
  private invalidHandlers = new Set<(from: PeerInfo | null, detail: string, messageId: string | null) => void>();
  captureHandler: CaptureHandler | null = null;
  private connectTimers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    this.cams = { CAMERA_1: new VirtualCamera('CAMERA_1', this), CAMERA_2: new VirtualCamera('CAMERA_2', this) };
  }

  // ---------------------------------------------------------------- VirtualCameraHost
  toServer(cam: VirtualCamera, env: Envelope): void {
    if (!this.running) return;
    const text = serializeEnvelope(env);
    setTimeout(() => {
      if (!this.running || !cam.connected) return;
      const parsed = parseEnvelope(text);
      const peer: PeerInfo = { deviceId: cam.deviceId, role: cam.role, remoteAddress: cam.remoteAddress };
      if (!parsed.ok) {
        this.invalidHandlers.forEach((h) => h(peer, parsed.detail, parsed.messageId));
        return;
      }
      this.msgHandlers.forEach((h) => h(peer, parsed.envelope));
    }, LINK_LATENCY_MS);
  }

  closed(cam: VirtualCamera, reason: string): void {
    const peer: PeerInfo = { deviceId: cam.deviceId, role: cam.role, remoteAddress: cam.remoteAddress };
    this.closeHandlers.forEach((h) => h(peer, reason));
  }

  async deliver(meta: LocalCaptureMeta, tempUri: string, remote: string): Promise<{ result: string } | null> {
    if (!this.receiverRunning || !this.captureHandler) {
      deleteFileIfExists(tempUri);
      return null;
    }
    try {
      return await this.captureHandler(meta, tempUri, remote);
    } finally {
      deleteFileIfExists(tempUri);
    }
  }

  user(): VirtualUser {
    return userProvider();
  }

  platform(): 'android' | 'ios' {
    return platformProvider();
  }

  // ---------------------------------------------------------------- SimulatorControls
  connectAll(qr: PairingQrPayload): void {
    this.connectTimers.forEach(clearTimeout);
    this.connectTimers = [];
    (['CAMERA_1', 'CAMERA_2'] as CameraRole[]).forEach((role, i) => {
      const cam = this.cams[role];
      cam.setQr(qr);
      if (cam.connected) return;
      this.connectTimers.push(setTimeout(() => this.running && cam.connect(), 900 + i * 700));
    });
  }

  dropCamera(role: CameraRole, ms: number): void {
    this.cams[role].dropFor(ms);
  }

  forceBadPhoto(role: CameraRole): void {
    this.cams[role].setForceBad();
  }

  setOffline(role: CameraRole, offline: boolean): void {
    this.cams[role].setOffline(offline);
  }

  // ---------------------------------------------------------------- servidor
  sendTo(deviceId: string, env: Envelope): void {
    const cam = Object.values(this.cams).find((c) => c.deviceId === deviceId);
    if (!cam || !this.running) return;
    const text = serializeEnvelope(env);
    setTimeout(() => {
      const parsed = parseEnvelope(text);
      if (parsed.ok) cam.receive(parsed.envelope);
    }, LINK_LATENCY_MS);
  }

  addMsg(h: (from: PeerInfo, m: Envelope) => void): Unsubscribe {
    this.msgHandlers.add(h);
    return () => this.msgHandlers.delete(h);
  }

  addClose(h: (p: PeerInfo, reason: string) => void): Unsubscribe {
    this.closeHandlers.add(h);
    return () => this.closeHandlers.delete(h);
  }

  addInvalid(h: (from: PeerInfo | null, detail: string, messageId: string | null) => void): Unsubscribe {
    this.invalidHandlers.add(h);
    return () => this.invalidHandlers.delete(h);
  }

  stopAll(): void {
    this.connectTimers.forEach(clearTimeout);
    this.connectTimers = [];
    Object.values(this.cams).forEach((c) => c.disconnect());
  }
}

/** Un único "hub" por ejecución de la app: servidor y receptor simulados comparten las cámaras virtuales. */
export const simulatedHub = new SimulatedHub();

export class SimulatedControlServer implements ControlServer {
  constructor(private readonly getIp: () => Promise<string | null>) {}

  async start(port: number): Promise<{ host: string; port: number }> {
    simulatedHub.running = true;
    return { host: (await this.getIp()) ?? '192.168.0.10', port };
  }

  async stop(): Promise<void> {
    simulatedHub.running = false;
    simulatedHub.stopAll();
  }

  send<T extends MessageType>(deviceId: string, message: Envelope<T>): void {
    simulatedHub.sendTo(deviceId, message as Envelope);
  }

  broadcast<T extends MessageType>(message: Envelope<T>): void {
    Object.values(simulatedHub.cams).forEach((c) => c.connected && simulatedHub.sendTo(c.deviceId, message as Envelope));
  }

  disconnect(deviceId: string, reason: string): void {
    const cam = Object.values(simulatedHub.cams).find((c) => c.deviceId === deviceId);
    if (!cam) return;
    cam.disconnect();
    simulatedHub.closed(cam, reason);
  }

  onMessage(handler: (from: PeerInfo, message: Envelope) => void): Unsubscribe {
    return simulatedHub.addMsg(handler);
  }

  onPeerClosed(handler: (peer: PeerInfo, reason: string) => void): Unsubscribe {
    return simulatedHub.addClose(handler);
  }

  onInvalid(handler: (from: PeerInfo | null, detail: string, messageId: string | null) => void): Unsubscribe {
    return simulatedHub.addInvalid(handler);
  }
}

export class SimulatedFileReceiver implements FileReceiver {
  async start(): Promise<void> {
    simulatedHub.receiverRunning = true;
  }

  async stop(): Promise<void> {
    simulatedHub.receiverRunning = false;
  }

  onCapture(handler: CaptureHandler): Unsubscribe {
    simulatedHub.captureHandler = handler;
    return () => {
      if (simulatedHub.captureHandler === handler) simulatedHub.captureHandler = null;
    };
  }
}
