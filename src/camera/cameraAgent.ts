// src/camera/cameraAgent.ts — Lado CÁMARA del protocolo local (maestro §14.6–14.9, §8.10, §8.12).
//
// QUÉ HACE:
//  - pairWithQr(): tras escanear el QR (PANT-30) conecta el WebSocket y envía PAIR_REQUEST con la función
//    del celular (CAMERA_1/2), el usuario con sesión, versión, batería, espacio y pendientes.
//  - PAIRED: guarda camera_context (host, puertos, configuración) y el token en SecureStore, aplica la
//    configuración de captura/calidad del controlador (D-21), libera fotos ya sincronizadas (RN-09) y responde ACK.
//  - Mensajes con ACK: SESSION_CONTEXT, START_PASS, END_PASS, PAUSE, RESUME, SESSION_CLOSED.
//  - HEARTBEAT: responde con echoSentAt, batería, espacio, pendientes y estado de la app; estima el reloj del controlador.
//  - CAPTURE_COMMAND: captureService (foto + calidad + respuesta + cola de transferencia).
//  - RESYNC_REQUEST: responde RESYNC_STATE paginado (solo evidencia no recibida).
//  - Reconexión automática con esperas protocol.reconnectDelaysMs; tras PAIR_REJECTED deja de reintentar.
//  - Cierre del contexto (8.12): SESSION_CLOSED, rechazo SESSION_CLOSED, sesión ya sincronizada, otro QR o "Abandonar".
// Funciona en Expo Go y en APK (usa el WebSocket de React Native y File.upload; no usa módulos nativos extra).

import { AppState } from 'react-native';

import { useAppSession } from '../auth/authStore';
import { CONFIG } from '../config';
import { median } from '../domain/rules';
import { nowIso, nowMs } from '../domain/time';
import type { CameraRole } from '../domain/types';
import { batteryPct } from '../device/batteryService';
import { getDeviceIdentity } from '../device/deviceIdentity';
import { stabilityDetector } from '../device/stabilityDetector';
import { freeSpace } from '../device/storageInfo';
import { logError, logEvent } from '../diagnostics/eventLog';
import { getNetworkFactory } from '../local-network/factory';
import type { ControlClient, Unsubscribe } from '../local-network/transport';
import { createEnvelope } from '../protocol/envelope';
import type { CaptureContextConfig, Envelope, MessageType, PairingQrPayload, PayloadMap } from '../protocol/messages';
import { captureContextConfigSchema } from '../protocol/schemas';
import { getDb } from '../storage/db';
import { deleteDirIfExists } from '../storage/files';
import { closeContext, getOpenContext, setContextJson, upsertContext } from '../storage/repositories/cameraContextRepo';
import { listUnreceivedEvidence } from '../storage/repositories/captureRepo';
import { countQueue, deleteTransfersOfSession, resetInFlight, retryErrored } from '../storage/repositories/transferQueueRepo';
import { SECURE_KEYS, secureDelete, secureGet, secureSet } from '../storage/secureStore';
import { executeCapture, reevaluatePending } from './captureService';
import { initialCameraState, useCameraLive } from './cameraStore';
import { releaseCameraPhotos } from './retentionService';
import { TransferQueue } from './transferQueue';

interface Target {
  host: string;
  controlPort: number;
  filePort: number;
  sessionId: string;
  token: string;
}

class CameraAgent {
  private factory = getNetworkFactory();
  private client: ControlClient = this.factory.createControlClient();
  private queue = new TransferQueue(this.factory.createFileSender());
  private unsubs: Unsubscribe[] = [];
  private target: Target | null = null;
  private role: CameraRole | null = null;
  private config: CaptureContextConfig | null = null;
  private sessionCtx: PayloadMap['SESSION_CONTEXT'] | null = null;
  private skews: number[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastMessageMs = 0;
  private stopped = true;
  private rejected = false;
  private lastSequenceId: string | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;

  private get myId(): string {
    return getDeviceIdentity().deviceId;
  }

  // ============================================================== ciclo de vida

  /** Al entrar a las pantallas de cámara: recupera un contexto abierto y reconecta (8.10). */
  async start(role: CameraRole): Promise<void> {
    this.role = role;
    if (this.unsubs.length === 0) {
      this.unsubs.push(
        this.client.onMessage((env) => void this.onMessage(env).catch((e: unknown) => logError('camera.message', e))),
        this.client.onStatus((s) => this.onStatus(s)),
      );
    }
    void stabilityDetector.start();
    if (!this.statusTimer) {
      this.statusTimer = setInterval(() => void this.refreshDevice(), CONFIG.device.statusPollMs);
      void this.refreshDevice();
    }
    await resetInFlight();
    const ctx = await getOpenContext();
    const token = await secureGet(SECURE_KEYS.pairingToken);
    if (ctx && token) {
      const parsed = captureContextConfigSchema.safeParse(JSON.parse(ctx.configJson));
      this.config = parsed.success ? (parsed.data as CaptureContextConfig) : null;
      this.sessionCtx = ctx.contextJson ? (JSON.parse(ctx.contextJson) as PayloadMap['SESSION_CONTEXT']) : null;
      this.target = {
        host: ctx.controllerHost,
        controlPort: ctx.controlPort,
        filePort: ctx.filePort,
        sessionId: ctx.sessionId,
        token,
      };
      useCameraLive.setState({
        sessionId: ctx.sessionId,
        role: ctx.role,
        controllerHost: ctx.controllerHost,
        passId: this.sessionCtx?.passId ?? null,
        lateral: this.sessionCtx?.lateralCode ?? null,
        markerId: this.sessionCtx?.markerId ?? null,
        mode: this.sessionCtx?.mode ?? null,
      });
      if (this.config) void reevaluatePending(this.config).catch(() => undefined);
      this.stopped = false;
      this.rejected = false;
      this.connect();
    } else {
      useCameraLive.setState({ link: 'SIN_CONTEXTO' });
    }
    await this.queue.refreshCounts();
  }

  /** Al salir de la función de cámara o cerrar la sesión de usuario. No borra datos. */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
    this.client.close();
    this.queue.clearTarget();
    stabilityDetector.stop();
  }

  hasOpenContext(): boolean {
    return useCameraLive.getState().sessionId !== null;
  }

  /** PANT-30: después de escanear un QR válido. Si hay contexto de OTRA sesión, la pantalla confirma antes. */
  async pairWithQr(qr: PairingQrPayload, role: CameraRole): Promise<void> {
    this.role = role;
    const open = await getOpenContext();
    if (open && open.sessionId !== qr.sessionId) await this.closeCurrentContext('OTRO_QR', open.sessionId);
    this.target = {
      host: qr.host,
      controlPort: qr.controlPort,
      filePort: qr.filePort,
      sessionId: qr.sessionId,
      token: qr.pairingToken,
    };
    this.rejected = false;
    this.stopped = false;
    this.reconnectAttempt = 0;
    useCameraLive.setState({ rejectReason: null, sessionId: qr.sessionId, controllerHost: qr.host, role });
    this.connect();
  }

  /** "Reescanear QR": cierra la conexión actual sin cerrar el contexto (las fotos se conservan). */
  disconnectForRescan(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.client.close();
  }

  /** "Abandonar sesión" (8.12 #5): solo sin conexión con el controlador; queda en event_log. */
  async abandon(): Promise<boolean> {
    if (this.client.connected) return false;
    const ctx = await getOpenContext();
    this.stopped = true;
    this.client.close();
    if (ctx) await this.closeCurrentContext('ABANDONADA', ctx.sessionId);
    return true;
  }

  async retryErroredTransfers(): Promise<number> {
    const n = await retryErrored();
    logEvent('INFO', 'TRANSFER', 'MANUAL_RETRY', { n });
    this.queue.kick();
    return n;
  }

  // ============================================================== conexión y reconexión

  private connect(): void {
    if (!this.target || this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const url = `ws://${this.target.host}:${this.target.controlPort}/control`;
    useCameraLive.setState({ link: 'CONECTANDO' });
    this.client.connect(url).catch(() => this.scheduleReconnect());
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.rejected || !this.target) return;
    const delays = CONFIG.protocol.reconnectDelaysMs;
    const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)];
    this.reconnectAttempt += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private onStatus(s: 'CONECTANDO' | 'CONECTADO' | 'DESCONECTADO'): void {
    if (s === 'CONECTADO') {
      this.reconnectAttempt = 0;
      this.lastMessageMs = nowMs();
      useCameraLive.setState({ link: 'CONECTADO' });
      void this.sendPairRequest();
      if (!this.watchdog) this.watchdog = setInterval(() => this.checkWatchdog(), CONFIG.protocol.heartbeatIntervalMs);
    } else if (s === 'DESCONECTADO') {
      useCameraLive.setState({ link: this.rejected ? 'RECHAZADO' : 'DESCONECTADO', paired: false });
      this.queue.clearTarget();
      this.scheduleReconnect();
    }
  }

  /** Sin mensajes del controlador por lostAfterMs → se cierra y se reintenta (14.9). */
  private checkWatchdog(): void {
    if (!this.client.connected) return;
    // Mientras una foto viaja al controlador, su app está ocupada recibiéndola: se tolera el triple antes de cortar
    // (cortar ahí obliga a reconectar y a reenviar, y alarga todo).
    const limit = this.queue.isSending() ? CONFIG.protocol.lostAfterMs * 3 : CONFIG.protocol.lostAfterMs;
    const silence = nowMs() - this.lastMessageMs;
    if (silence > limit) {
      logEvent('WARN', 'NET', 'LINK_STATE', { to: 'PERDIDA', silenceMs: silence, sending: this.queue.isSending() });
      this.client.close();
      useCameraLive.setState({ link: 'DESCONECTADO', paired: false });
      this.scheduleReconnect();
    }
  }

  private send<T extends MessageType>(type: T, payload: PayloadMap[T], sessionId?: string): Envelope<T> {
    const env = createEnvelope(type, sessionId ?? this.target?.sessionId ?? '', this.myId, payload);
    try {
      this.client.send(env);
    } catch {
      // sin conexión: el controlador marcará SIN_RESPUESTA y se conciliará con RESYNC
    }
    return env;
  }

  private ack(ref: Envelope): void {
    this.send(
      'ACK',
      { ackType: 'MESSAGE', refMessageId: ref.messageId, captureId: null, result: 'RECEIVED', reason: null },
      ref.sessionId,
    );
  }

  private async sendPairRequest(): Promise<void> {
    if (!this.target || !this.role) return;
    const s = useAppSession.getState();
    const id = getDeviceIdentity();
    const q = await countQueue();
    this.send('PAIR_REQUEST', {
      pairingToken: this.target.token,
      requestedRole: this.role,
      userId: s.user?.id ?? '',
      userName: s.user?.fullName ?? '',
      userRoles: s.user?.roles ?? [],
      authMode: s.mode ?? 'OFFLINE',
      platform: id.platform,
      model: id.model,
      osVersion: id.osVersion,
      appVersion: id.appVersion,
      protocolVersion: 1,
      batteryLevel: await batteryPct(),
      freeSpaceBytes: freeSpace(),
      pendingTransfers: q.pending,
    });
  }

  private async refreshDevice(): Promise<void> {
    useCameraLive.setState({ battery: await batteryPct(), freeSpace: freeSpace() });
  }

  private controllerSkew(): number {
    return Math.round(median(this.skews) ?? 0);
  }

  private noteSkew(controllerIso: string): void {
    const sample = new Date(controllerIso).getTime() - nowMs();
    this.skews.push(sample);
    while (this.skews.length > CONFIG.protocol.clockOffsetSamples) this.skews.shift();
  }

  // ============================================================== mensajes del controlador

  private async onMessage(env: Envelope): Promise<void> {
    this.lastMessageMs = nowMs();
    switch (env.type) {
      case 'PAIRED':
        return this.onPaired(env as Envelope<'PAIRED'>);
      case 'PAIR_REJECTED': {
        const p = env.payload as PayloadMap['PAIR_REJECTED'];
        this.rejected = true;
        useCameraLive.setState({ rejectReason: p.reason, link: 'RECHAZADO', paired: false });
        logEvent('WARN', 'NET', 'PAIR_REJECTED', { reason: p.reason });
        this.client.close();
        if (p.reason === 'SESSION_CLOSED' && this.target)
          await this.closeCurrentContext('SESSION_CLOSED_REJECT', this.target.sessionId);
        return;
      }
      case 'SESSION_CONTEXT': {
        this.sessionCtx = env.payload as PayloadMap['SESSION_CONTEXT'];
        await setContextJson(env.sessionId, JSON.stringify(this.sessionCtx));
        useCameraLive.setState({
          passId: this.sessionCtx.passId,
          lateral: this.sessionCtx.lateralCode,
          markerId: this.sessionCtx.markerId,
          mode: this.sessionCtx.mode,
        });
        this.ack(env);
        return;
      }
      case 'START_PASS':
        useCameraLive.setState({ paused: false });
        this.ack(env);
        return;
      case 'END_PASS':
        this.ack(env);
        return;
      case 'PAUSE':
        useCameraLive.setState({ paused: true });
        this.ack(env);
        return;
      case 'RESUME':
        useCameraLive.setState({ paused: false });
        this.ack(env);
        return;
      case 'SESSION_CLOSED':
        this.ack(env);
        await this.closeCurrentContext('SESSION_CLOSED', env.sessionId);
        return;
      case 'HEARTBEAT': {
        this.noteSkew(env.sentAt);
        const q = await countQueue();
        this.send('HEARTBEAT', {
          echoSentAt: env.sentAt,
          role: this.role ?? 'CAMERA_1',
          batteryLevel: useCameraLive.getState().battery,
          freeSpaceBytes: useCameraLive.getState().freeSpace,
          pendingTransfers: q.pending,
          lastSequenceId: this.lastSequenceId,
          appState:
            AppState.currentState === 'active' ? 'active' : AppState.currentState === 'background' ? 'background' : 'inactive',
        });
        return;
      }
      case 'CAPTURE_COMMAND':
        return this.onCaptureCommand(env as Envelope<'CAPTURE_COMMAND'>);
      case 'RESYNC_REQUEST':
        return this.onResync(env);
      case 'ACK': {
        const p = env.payload as PayloadMap['ACK'];
        if (p.ackType === 'FILE') void this.queue.refreshCounts();
        return;
      }
      case 'ERROR': {
        const p = env.payload as PayloadMap['ERROR'];
        logEvent('WARN', 'NET', 'ERROR_RECIBIDO', { code: p.code });
        if (p.code === 'NOT_PAIRED') void this.sendPairRequest();
        if (p.code === 'UNKNOWN_SESSION') {
          this.rejected = true;
          this.client.close();
          useCameraLive.setState({ link: 'RECHAZADO', rejectReason: 'INVALID_TOKEN' });
        }
        return;
      }
      default:
        return;
    }
  }

  private async onPaired(env: Envelope<'PAIRED'>): Promise<void> {
    const p = env.payload;
    if (!this.target) return;
    this.noteSkew(p.serverTime);
    this.config = p.config;
    const open = await getOpenContext();
    if (open && open.sessionId !== env.sessionId) await this.closeCurrentContext('OTRA_SESION', open.sessionId);
    await upsertContext({
      sessionId: env.sessionId,
      controllerDeviceId: p.controllerDeviceId,
      role: p.role,
      controllerHost: this.target.host,
      controlPort: this.target.controlPort,
      filePort: this.target.filePort,
      pairedAt: nowIso(),
      configJson: JSON.stringify(p.config),
      contextJson: null,
      closedAt: null,
      updatedAt: nowIso(),
    });
    await secureSet(SECURE_KEYS.pairingToken, this.target.token);
    this.ack(env);
    useCameraLive.setState({ paired: true, link: 'CONECTADO', role: p.role, sessionId: env.sessionId, rejectReason: null });
    logEvent('INFO', 'NET', 'PAIRED', { role: p.role }, env.sessionId);
    // 8.12 #3: si esta sesión ya figura sincronizada, se cierra su contexto.
    if (p.syncedSessionIds.includes(env.sessionId)) await this.closeCurrentContext('SYNCED', env.sessionId);
    await releaseCameraPhotos(p.syncedSessionIds);
    this.queue.setTarget(this.target.host, this.target.filePort, p.controllerDeviceId);
  }

  private async onCaptureCommand(env: Envelope<'CAPTURE_COMMAND'>): Promise<void> {
    if (!this.config || !this.role) {
      this.send('ERROR', { code: 'INTERNAL', detail: null, refMessageId: env.messageId });
      return;
    }
    this.lastSequenceId = env.payload.sequenceId;
    await executeCapture(
      env,
      {
        sessionId: this.target?.sessionId ?? '',
        role: this.role,
        deviceId: this.myId,
        userId: useAppSession.getState().user?.id ?? '',
        config: this.config,
        activePassId: this.sessionCtx?.passId ?? null,
        controllerSkewMs: this.controllerSkew(),
      },
      (type, payload) => this.send(type, payload, env.sessionId) as Envelope,
      (saved) => {
        try {
          this.client.send(saved);
        } catch {
          // sin conexión
        }
      },
    );
    this.queue.kick();
  }

  /** RESYNC_STATE paginado: solo evidencia de la sesión aún no RECIBIDA_CONTROLADOR (14.9). */
  private async onResync(env: Envelope): Promise<void> {
    const pending = await listUnreceivedEvidence(env.sessionId);
    const size = CONFIG.protocol.resyncPageSize;
    const totalPages = Math.max(1, Math.ceil(pending.length / size));
    for (let page = 1; page <= totalPages; page++) {
      const slice = pending.slice((page - 1) * size, page * size);
      this.send(
        'RESYNC_STATE',
        {
          lastSequenceIdSeen: this.lastSequenceId,
          page,
          totalPages,
          captures: slice.map((c) => ({
            captureId: c.captureId,
            sequenceId: c.sequenceId,
            qualityStatus: c.qualityStatus,
            localTransferStatus: c.localTransferStatus,
          })),
        },
        env.sessionId,
      );
    }
    logEvent('INFO', 'NET', 'RESYNC', { pages: totalPages, captures: pending.length }, env.sessionId);
  }

  /** 8.12: cierra el contexto, borra token y fotos de prueba corta; la evidencia pendiente se conserva. */
  private async closeCurrentContext(reason: string, sessionId: string): Promise<void> {
    await closeContext(sessionId);
    const token = await secureGet(SECURE_KEYS.pairingToken);
    if (token && this.target?.sessionId === sessionId) await secureDelete(SECURE_KEYS.pairingToken);
    deleteDirIfExists('short-test', sessionId);
    await getDb().runAsync(
      'UPDATE captures SET file_deleted_at = ? WHERE session_id = ? AND is_test = 1 AND file_deleted_at IS NULL',
      [nowIso(), sessionId],
    );
    await deleteTransfersOfSession(sessionId, true);
    logEvent('INFO', 'SESSION', 'CONTEXT_CLOSED', { reason }, sessionId);
    if (this.target?.sessionId === sessionId) {
      this.stopped = reason !== 'OTRO_QR';
      this.client.close();
      this.target = null;
      this.sessionCtx = null;
      useCameraLive.setState({
        ...initialCameraState(),
        battery: useCameraLive.getState().battery,
        freeSpace: useCameraLive.getState().freeSpace,
        sessionEnded: reason === 'SESSION_CLOSED' || reason === 'SESSION_CLOSED_REJECT',
      });
    }
    await this.queue.refreshCounts();
  }
}

export const cameraAgent = new CameraAgent();
