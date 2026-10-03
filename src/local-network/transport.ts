// src/local-network/transport.ts — Interfaces de transporte (contrato del maestro §6.3).
//
// QUÉ HACE: la app depende de ESTAS interfaces, nunca de la librería de red. Implementaciones:
//  (1) Real: servidor TCP + WebSocket propio (react-native-tcp-socket) en el controlador y WebSocket
//      nativo de React Native en las cámaras → Development Build / APK (Fase 2).
//  (2) Simulador en memoria con dos cámaras virtuales → Expo Go (Fase 1).
// factory.ts elige con isRunningInExpoGo() de 'expo'.
// Ajuste menor (Supuesto S-06): onCapture recibe además la IP de origen para el control de 14.8.

import type { CameraRole, UUID } from '../domain/types';
import type { Envelope, LocalCaptureMeta, LocalCaptureResponse, MessageType, PairingQrPayload } from '../protocol/messages';

export type Unsubscribe = () => void;

export interface PeerInfo {
  deviceId: UUID;
  role: CameraRole | null;
  remoteAddress: string;
}

/** Controlador: servidor de control (WebSocket). */
export interface ControlServer {
  start(port: number): Promise<{ host: string; port: number }>;
  stop(): Promise<void>;
  send<T extends MessageType>(deviceId: UUID, message: Envelope<T>): void;
  broadcast<T extends MessageType>(message: Envelope<T>): void;
  disconnect(deviceId: UUID, reason: string): void;
  onMessage(handler: (from: PeerInfo, message: Envelope) => void): Unsubscribe;
  onPeerClosed(handler: (peer: PeerInfo, reason: string) => void): Unsubscribe;
  /** Mensajes que no pasaron la validación zod (para responder ERROR INVALID_MESSAGE). */
  onInvalid?(handler: (from: PeerInfo | null, detail: string, messageId: string | null) => void): Unsubscribe;
}

export type ClientStatus = 'CONECTANDO' | 'CONECTADO' | 'DESCONECTADO';

/** Cámara: cliente de control (WebSocket nativo de React Native). */
export interface ControlClient {
  connect(url: string): Promise<void>; // ws://<host>:<controlPort>/control
  send<T extends MessageType>(message: Envelope<T>): void;
  close(): void;
  readonly connected: boolean;
  onMessage(handler: (message: Envelope) => void): Unsubscribe;
  onStatus(handler: (status: ClientStatus, detail?: string) => void): Unsubscribe;
}

/** Controlador: receptor de fotos (opción A: HTTP POST /local/captures). */
export interface FileReceiver {
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  /** El manejador verifica md5/tamaño, guarda archivo + registro y decide la respuesta (idempotente). */
  onCapture(
    handler: (meta: LocalCaptureMeta, tempFileUri: string, remoteAddress: string | null) => Promise<LocalCaptureResponse>,
  ): Unsubscribe;
}

/** Cámara: envío de una foto al controlador. */
export interface FileSender {
  send(baseUrl: string, meta: LocalCaptureMeta, fileUri: string, timeoutMs: number): Promise<LocalCaptureResponse>;
}

/** Controles del simulador (solo existen en Expo Go). */
export interface SimulatorControls {
  /** Las cámaras virtuales "escanean" el QR y se conectan. */
  connectAll(qr: PairingQrPayload): void;
  /** Corta el enlace de una cámara virtual durante `ms` y luego reconecta (CP-20/CP-37). */
  dropCamera(role: CameraRole, ms: number): void;
  /** La siguiente foto de esa cámara saldrá oscura (CP-15). */
  forceBadPhoto(role: CameraRole): void;
  /** Apaga una cámara virtual (no responde) hasta reconectarla. */
  setOffline(role: CameraRole, offline: boolean): void;
}

export interface LocalNetworkFactory {
  readonly kind: 'SIMULADOR' | 'RED_REAL';
  createControlServer(): ControlServer;
  createControlClient(): ControlClient;
  createFileReceiver(): FileReceiver;
  createFileSender(): FileSender;
  /** IP del celular en la red Wi-Fi (expo-network getIpAddressAsync). */
  getLocalIp(): Promise<string | null>;
  /** Solo en el simulador. */
  readonly simulator: SimulatorControls | null;
}
