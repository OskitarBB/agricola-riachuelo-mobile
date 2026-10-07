// src/controller/controllerRuntime.ts — Orquestador del CONTROLADOR (protocolo local v1, maestro §8 y §14).
//
// QUÉ HACE: es el "cerebro" del celular controlador. Une los servicios de datos (sesión, pasada, secuencias,
// consolidación) con la red local (real o simulada) y publica el estado en vivo en controllerStore:
//  - Emparejamiento: token + QR, validación de PAIR_REQUEST (14.6), PAIRED, SESSION_CONTEXT, RESYNC (14.9).
//  - Monitor: HEARTBEAT cada 2 s, estados CONECTADA/INESTABLE/PERDIDA, desfase de reloj, batería y espacio.
//  - Prueba corta (14.12), inicio/cierre de pasada (START_PASS/END_PASS con ACK y reenvíos).
//  - Disparo MANUAL (botón) o AUTOMÁTICO (temporizador), nunca dos órdenes superpuestas (RN-11).
//  - Repetición de una cámara (RN-07), pausa manual o automática (enlace, batería, espacio, segundo plano),
//    reanudación (RN-10), cambio de marcador SIEMPRE manual (en AUTOMÁTICO solo en pausa, contexto §25.2).
//  - Recepción de fotos (consolidationService) y cierre de la sesión con cola de sincronización.
//  - Recuperación tras cierre o reinicio de la app (8.10): pasada a PAUSED y cámaras a DESCONECTADA.
// Todo el procesamiento de mensajes entrantes se SERIALIZA en una cola para evitar carreras en SQLite.
//
// La misma lógica funciona con la red real (factory.ts) y con el simulador. La cola que se crea al cerrar la sesión
// la envía a la plataforma src/sync/syncService.ts (Fase 4).

import { AppState, Platform as RNPlatform, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { useAppSession } from '../auth/authStore';
import { CONFIG } from '../config';
import { newId } from '../domain/ids';
import { canChangeMarker, canResumePass, canStartPass, type DeviceHealth } from '../domain/rules';
import { isRetakeable } from '../domain/sequence';
import { addMsIso, nowIso, nowMs } from '../domain/time';
import type {
  CameraLinkStatus,
  CameraRole,
  CaptureSequence,
  Direction,
  LateralCode,
  MonitoringPass,
  MonitoringSession,
  SessionDevice,
  SlotOutcome,
} from '../domain/types';
import { CAMERA_ROLES } from '../domain/types';
import { batteryPct } from '../device/batteryService';
import { getDeviceIdentity } from '../device/deviceIdentity';
import { latestFix, onGps, startGps, stopGps } from '../device/gpsService';
import { freeSpace } from '../device/storageInfo';
import { logError, logEvent, setLogSession } from '../diagnostics/eventLog';
import { addManualIncident, addSystemIncident } from '../diagnostics/incidents';
import { getNetworkFactory } from '../local-network/factory';
import { setSimulatorUser } from '../local-network/simulator/simulatedNetwork';
import type { ControlServer, FileReceiver, PeerInfo, Unsubscribe } from '../local-network/transport';
import { createEnvelope } from '../protocol/envelope';
import { ACK_REQUIRED, type Envelope, type LocalCaptureMeta, type MessageType, type PayloadMap } from '../protocol/messages';
import { deleteMeta, setMetaJson } from '../storage/repositories/appMetaRepo';
import { countMissingByRole, getCapture, upsertCapture } from '../storage/repositories/captureRepo';
import { getOpenPass, getPass, getRetakeByCapture, listPasses } from '../storage/repositories/passRepo';
import { getSequence, lastSequence, listSequences, markPendingAsNoResponse } from '../storage/repositories/sequenceRepo';
import {
  getCurrentSession,
  getSession,
  getSessionDevice,
  listSessionDevices,
  listSyncedSessionIds,
  markAllDisconnected,
  releaseRole,
  updateDeviceLink,
  upsertSessionDevice,
} from '../storage/repositories/sessionRepo';
import { SECURE_KEYS, secureDelete, secureGet, secureSet } from '../storage/secureStore';
import { clockOffsetSample, linkFromSilence, offsetMedian, pushSample } from './cameraMonitor';
import { consolidateCapture } from './consolidationService';
import { emptyCard, emptyShortTest, initialControllerState, patchCamera, pushNotice, useController } from './controllerStore';
import { buildPairedConfig, buildQr, hashToken, newPairingToken, validatePairRequest } from './pairingService';
import { changeMarker as changeMarkerData, createPass, refreshCounters, setPassStatus } from './passService';
import { applyOutcome, createSequence, markSent, prepareRetake } from './sequenceEngine';
import { createDraft, discardDraft, finalizeClose, setStatus, patchSession } from './sessionService';
import {
  decideShortTest,
  isShortTestFinal,
  isShortTestPassed,
  shortTestFailReason,
  type ShortTestObservation,
  type ShortTestPending,
} from './shortTest';

type ActionResult = { ok: true } | { ok: false; code: string };
const OK: ActionResult = { ok: true };
const fail = (code: string): ActionResult => ({ ok: false, code });

interface Peer {
  deviceId: string;
  role: CameraRole | null;
  paired: boolean;
  remoteAddress: string;
  lastSeenMs: number;
  link: CameraLinkStatus;
  offsets: number[];
  appState: 'active' | 'background' | 'inactive';
  batteryLevel: number | null;
  freeSpaceBytes: number | null;
  pendingTransfers: number;
}

interface PendingAck {
  deviceId: string;
  env: Envelope;
  retries: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (ok: boolean) => void;
}

interface Order {
  kind: 'SEQ' | 'RETAKE' | 'TEST';
  sequenceId: string;
  awaiting: Map<CameraRole, { captureId: string; messageId: string; sentMs: number }>;
  issuedMs: number;
  timer: ReturnType<typeof setTimeout>;
}

interface ShortTestRun {
  pending: ShortTestPending;
  startedMs: number;
  obs: Record<CameraRole, ShortTestObservation>;
  capturedAt: Record<CameraRole, string | null>;
  timer: ReturnType<typeof setTimeout>;
}

class ControllerRuntime {
  private factory = getNetworkFactory();
  private server: ControlServer | null = null;
  private receiver: FileReceiver | null = null;
  private netUnsubs: Unsubscribe[] = [];
  private session: MonitoringSession | null = null;
  private pass: MonitoringPass | null = null;
  private token: string | null = null;
  private manualIp: string | null = null;
  private peers = new Map<string, Peer>();
  private acks = new Map<string, PendingAck>();
  private order: Order | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private lastIssuedMs = 0;
  private queuedRetake: CameraRole | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private gpsTimer: ReturnType<typeof setInterval> | null = null;
  private gpsUnsub: (() => void) | null = null;
  private appStateSub: NativeEventSubscription | null = null;
  private resyncing = new Set<string>();
  private shortTest: ShortTestRun | null = null;
  private processed = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private initialized = false;
  private busy = false;

  // ============================================================== utilidades internas

  private get myId(): string {
    return getDeviceIdentity().deviceId;
  }

  /** Serializa tareas (mensajes entrantes, fotos, temporizadores) para evitar carreras en SQLite. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch((err: unknown) => logError('controller.queue', err));
    return run;
  }

  /** Evita dos acciones del operador a la vez (doble toque). */
  private async exclusive(task: () => Promise<ActionResult>): Promise<ActionResult> {
    if (this.busy) return fail('ORDEN_EN_CURSO');
    this.busy = true;
    try {
      return await task();
    } catch (err) {
      logError('controller.action', err);
      return fail('ERROR_INESPERADO');
    } finally {
      this.busy = false;
    }
  }

  private publish(): void {
    useController.setState({
      session: this.session,
      pass: this.pass,
      orderInFlight: this.order !== null,
      autoState: this.autoState(),
      resyncing: this.resyncing.size > 0,
      networkKind: this.factory.kind,
    });
  }

  private autoState(): 'OFF' | 'ACTIVE' | 'PAUSED' {
    if (!this.session || this.session.mode !== 'AUTOMATICO' || !this.pass) return 'OFF';
    if (this.pass.status === 'ACTIVE') return 'ACTIVE';
    if (this.pass.status === 'PAUSED') return 'PAUSED';
    return 'OFF';
  }

  private peerByRole(role: CameraRole): Peer | null {
    for (const p of this.peers.values()) if (p.role === role && p.paired) return p;
    return null;
  }

  private linkOf(role: CameraRole): CameraLinkStatus {
    return this.peerByRole(role)?.link ?? useController.getState().cameras[role].link ?? 'DESCONECTADA';
  }

  private links(): Record<CameraRole, CameraLinkStatus> {
    return { CAMERA_1: this.linkOf('CAMERA_1'), CAMERA_2: this.linkOf('CAMERA_2') };
  }

  // ============================================================== envío de mensajes y ACK

  private send<T extends MessageType>(
    deviceId: string,
    type: T,
    payload: PayloadMap[T],
  ): { env: Envelope<T>; acked: Promise<boolean> } {
    const env = createEnvelope(type, this.session?.sessionId ?? '', this.myId, payload);
    this.server?.send(deviceId, env);
    if (!ACK_REQUIRED.includes(type)) return { env, acked: Promise.resolve(true) };
    const acked = new Promise<boolean>((resolve) => {
      const pending: PendingAck = {
        deviceId,
        env: env as Envelope,
        retries: 0,
        resolve,
        timer: setTimeout(() => this.retryAck(env.messageId), CONFIG.protocol.ackTimeoutMs),
      };
      this.acks.set(env.messageId, pending);
    });
    return { env, acked };
  }

  /** Reenvía con el MISMO messageId hasta ackMaxRetries; luego el enlace pasa a PERDIDA (14.3). */
  private retryAck(messageId: string): void {
    const p = this.acks.get(messageId);
    if (!p) return;
    if (p.retries >= CONFIG.protocol.ackMaxRetries) {
      this.acks.delete(messageId);
      p.resolve(false);
      const peer = this.peers.get(p.deviceId);
      if (peer) void this.enqueue(() => this.setLink(peer, 'PERDIDA', 'sin ACK'));
      return;
    }
    p.retries += 1;
    this.server?.send(p.deviceId, p.env);
    p.timer = setTimeout(() => this.retryAck(messageId), CONFIG.protocol.ackTimeoutMs);
  }

  private broadcastAcked<T extends MessageType>(type: T, payload: PayloadMap[T]): Promise<boolean[]> {
    const waits: Promise<boolean>[] = [];
    for (const role of CAMERA_ROLES) {
      const p = this.peerByRole(role);
      if (p && (p.link === 'CONECTADA' || p.link === 'INESTABLE')) waits.push(this.send(p.deviceId, type, payload).acked);
    }
    return Promise.all(waits);
  }

  private sessionContextPayload(): PayloadMap['SESSION_CONTEXT'] {
    const s = this.session as MonitoringSession;
    const p =
      this.pass && (this.pass.status === 'ACTIVE' || this.pass.status === 'PAUSED' || this.pass.status === 'READY')
        ? this.pass
        : null;
    return {
      passId: p?.passId ?? null,
      lateralCode: p?.lateralCode ?? null,
      lotId: p?.lotId ?? null,
      rowId: p?.rowId ?? null,
      segmentId: p?.currentSegmentId ?? null,
      markerId: p?.currentMarkerId ?? null,
      direction: p?.direction ?? null,
      mode: s.mode,
      intervalMs: s.intervalMs,
    };
  }

  // ============================================================== ciclo de vida

  /** Se llama al entrar a las pantallas del controlador (y al arrancar con función CONTROLADOR). */
  async init(): Promise<void> {
    if (this.initialized) {
      this.publish();
      return;
    }
    this.initialized = true;
    const user = useAppSession.getState().user;
    setSimulatorUser(
      () => {
        const u = useAppSession.getState().user ?? user;
        return {
          id: u?.id ?? 'sin-usuario',
          name: u?.fullName ?? 'Operador',
          roles: u?.roles ?? ['OPERADOR_CAMPO'],
          authMode: useAppSession.getState().mode ?? 'OFFLINE',
        };
      },
      () => (RNPlatform.OS === 'ios' ? 'ios' : 'android'),
    );
    this.appStateSub = AppState.addEventListener('change', (s) => this.onAppState(s));
    this.statusTimer = setInterval(() => void this.checkDeviceHealth(), CONFIG.device.statusPollMs);
    void this.checkDeviceHealth();
    try {
      await this.restore();
    } catch (err) {
      logError('controller.restore', err);
    }
    this.publish();
  }

  /** Recuperación tras cierre o reinicio (maestro §8.10). */
  private async restore(): Promise<void> {
    const s = await getCurrentSession(true);
    this.session = s;
    setLogSession(s?.sessionId ?? null);
    if (!s || s.status === 'DRAFT') {
      this.publish();
      return;
    }
    let pass = await getOpenPass(s.sessionId);
    if (pass && pass.status === 'ACTIVE') {
      pass = await setPassStatus(pass, 'PAUSED');
      if (s.status === 'ACTIVE') this.session = await setStatus(s, 'PAUSED');
      await markPendingAsNoResponse(pass.passId);
      logEvent('WARN', 'SESSION', 'RECOVERED', { passId: pass.passId }, s.sessionId);
    }
    this.pass = pass;
    await markAllDisconnected(s.sessionId);
    const devices = await listSessionDevices(s.sessionId);
    this.peers.clear();
    useController.setState({
      cameras: { CAMERA_1: emptyCard('CAMERA_1'), CAMERA_2: emptyCard('CAMERA_2') },
      shortTest: emptyShortTest(),
    });
    for (const d of devices.filter((x) => !x.released)) this.applyDeviceToCard(d, 'DESCONECTADA');
    await deleteMeta('short_test_pending');
    this.token = await secureGet(SECURE_KEYS.pairingToken);
    if (!this.token && this.session) {
      this.token = newPairingToken();
      await secureSet(SECURE_KEYS.pairingToken, this.token);
      this.session = await patchSession(this.session, { pairingTokenHash: await hashToken(this.token) });
    }
    await this.startServers();
    await this.startTelemetry();
    if (this.pass) await this.refreshPassView();
    this.publish();
  }

  private async startServers(): Promise<void> {
    if (!this.session || !this.token) return;
    if (!this.server) {
      this.server = this.factory.createControlServer();
      this.receiver = this.factory.createFileReceiver();
      this.netUnsubs.push(
        this.server.onMessage((from, env) => this.onMessage(from, env)),
        this.server.onPeerClosed((peer, reason) => void this.enqueue(() => this.onPeerClosed(peer, reason))),
        this.receiver.onCapture((meta, uri, remote) => {
          this.touchPeer(meta.deviceId);
          return this.enqueue(() => this.onFile(meta, uri, remote));
        }),
      );
      // Una foto llegando prueba que la cámara está viva (una de 12 MP tarda unos segundos por Wi-Fi).
      if (this.receiver.onActivity) this.netUnsubs.push(this.receiver.onActivity((deviceId) => this.touchPeer(deviceId)));
      if (this.server.onInvalid) {
        this.netUnsubs.push(
          this.server.onInvalid((from, detail, messageId) => {
            logEvent('WARN', 'NET', 'INVALID_MESSAGE', { detail });
            if (from?.deviceId) {
              this.server?.send(
                from.deviceId,
                createEnvelope('ERROR', this.session?.sessionId ?? '', this.myId, {
                  code: 'INVALID_MESSAGE',
                  detail,
                  refMessageId: messageId,
                }),
              );
            }
          }),
        );
      }
    }
    try {
      const { host } = await this.server.start(CONFIG.pairing.controlPort);
      await this.receiver?.start(CONFIG.pairing.filePort);
      const ip = this.manualIp ?? host;
      const qr = buildQr(ip, this.session.sessionId, this.token);
      useController.setState({ qr: { payload: qr, text: JSON.stringify(qr) }, serverError: null });
      logEvent('INFO', 'NET', 'SERVER_START', { kind: this.factory.kind, host: ip }, this.session.sessionId);
      this.factory.simulator?.connectAll(qr);
    } catch (err) {
      logError('controller.server', err);
      useController.setState({ serverError: 'ERROR_INESPERADO' });
    }
    if (!this.heartbeatTimer)
      this.heartbeatTimer = setInterval(() => {
        // El HEARTBEAT sale directo del temporizador (no espera a la cola): si una tarea larga lo retrasara, las cámaras
        // dejarían de recibir señal del controlador por más de protocol.lostAfterMs y cortarían la conexión.
        this.sendHeartbeats();
        void this.enqueue(() => this.heartbeatTick());
      }, CONFIG.protocol.heartbeatIntervalMs);
  }

  private async stopServers(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.netUnsubs.forEach((u) => u());
    this.netUnsubs = [];
    try {
      await this.server?.stop();
      await this.receiver?.stop();
    } catch (err) {
      logError('controller.stopServers', err);
    }
    this.server = null;
    this.receiver = null;
    for (const a of this.acks.values()) {
      clearTimeout(a.timer);
      a.resolve(false);
    }
    this.acks.clear();
    this.peers.clear();
    this.resyncing.clear();
  }

  private async startTelemetry(): Promise<void> {
    await startGps();
    if (!this.gpsUnsub) this.gpsUnsub = onGps(() => undefined);
    if (!this.gpsTimer) this.gpsTimer = setInterval(() => useController.setState({ gps: latestFix() }), 1_000);
  }

  private stopTelemetry(): void {
    stopGps();
    this.gpsUnsub?.();
    this.gpsUnsub = null;
    if (this.gpsTimer) clearInterval(this.gpsTimer);
    this.gpsTimer = null;
  }

  /** Cierra todo (al cerrar sesión de usuario o cambiar de función). No borra datos. */
  async shutdown(): Promise<void> {
    this.stopAuto();
    if (this.order) clearTimeout(this.order.timer);
    this.order = null;
    await this.stopServers();
    this.stopTelemetry();
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.initialized = false;
    this.session = null;
    this.pass = null;
    useController.setState(initialControllerState());
  }

  // ============================================================== salud del equipo (RF-46)

  private async checkDeviceHealth(): Promise<void> {
    const bat = await batteryPct();
    const space = freeSpace();
    useController.setState({ ownBattery: bat, ownFreeSpace: space });
    const alerts: string[] = [];
    const d = CONFIG.device;
    const devices: { bat: number | null; space: number | null }[] = [{ bat, space }];
    for (const p of this.peers.values()) if (p.paired) devices.push({ bat: p.batteryLevel, space: p.freeSpaceBytes });
    let pauseReason: 'BATERIA' | 'ESPACIO' | null = null;
    for (const x of devices) {
      if (x.bat !== null && x.bat < d.pauseBatteryPct) pauseReason = 'BATERIA';
      else if (x.bat !== null && x.bat < d.warnBatteryPct && !alerts.includes('BATERIA_BAJA')) alerts.push('BATERIA_BAJA');
      if (x.space !== null && x.space < d.pauseFreeSpaceBytes) pauseReason = pauseReason ?? 'ESPACIO';
      else if (x.space !== null && x.space < d.warnFreeSpaceBytes && !alerts.includes('ESPACIO_BAJO'))
        alerts.push('ESPACIO_BAJO');
    }
    if (pauseReason) alerts.push(pauseReason === 'BATERIA' ? 'BATERIA_CRITICA' : 'ESPACIO_CRITICO');
    if (!latestFix() && this.session && this.session.status !== 'DRAFT') alerts.push('GPS_NO_DISPONIBLE');
    useController.setState({ alerts });
    if (pauseReason && this.pass?.status === 'ACTIVE') {
      await this.pauseInternal(pauseReason);
      pushNotice(pauseReason === 'BATERIA' ? 'BATERIA_CRITICA' : 'ESPACIO_CRITICO', 'error');
    }
  }

  private onAppState(state: AppStateStatus): void {
    logEvent('INFO', 'DEVICE', 'APP_STATE', { state });
    if (state !== 'active' && this.pass?.status === 'ACTIVE') {
      void this.enqueue(() => this.pauseInternal('SEGUNDO_PLANO'));
    }
  }

  // ============================================================== mensajes entrantes

  /** La cámara dio señales de vida (mensaje o datos de una foto). Se anota AL INSTANTE, no en la cola de tareas. */
  private touchPeer(deviceId: string): void {
    const peer = this.peers.get(deviceId);
    if (peer) peer.lastSeenMs = nowMs();
  }

  private onMessage(from: PeerInfo, env: Envelope): void {
    // Cualquier mensaje cuenta como señal de vida aunque la cola de tareas esté ocupada (p. ej. guardando una foto):
    // si se anotara recién al procesarlo, el monitor marcaría la cámara PERDIDA por una demora propia.
    this.touchPeer(from.deviceId);
    // Los ACK se resuelven al instante (las acciones del operador pueden estar esperándolos).
    if (env.type === 'ACK') {
      const p = env.payload as PayloadMap['ACK'];
      if (p.ackType === 'MESSAGE' && p.refMessageId) {
        const pending = this.acks.get(p.refMessageId);
        if (pending) {
          clearTimeout(pending.timer);
          this.acks.delete(p.refMessageId);
          pending.resolve(true);
        }
      }
      return;
    }
    void this.enqueue(() => this.handleMessage(from, env));
  }

  private async handleMessage(from: PeerInfo, env: Envelope): Promise<void> {
    if (env.type === 'PAIR_REQUEST') return this.onPairRequest(from, env as Envelope<'PAIR_REQUEST'>);
    const peer = this.peers.get(from.deviceId);
    if (!peer || !peer.paired) {
      this.server?.send(
        from.deviceId,
        createEnvelope('ERROR', env.sessionId, this.myId, { code: 'NOT_PAIRED', detail: null, refMessageId: env.messageId }),
      );
      return;
    }
    if (!this.session || env.sessionId !== this.session.sessionId) {
      this.server?.send(
        from.deviceId,
        createEnvelope('ERROR', env.sessionId, this.myId, { code: 'UNKNOWN_SESSION', detail: null, refMessageId: env.messageId }),
      );
      return;
    }
    peer.lastSeenMs = nowMs();
    if (peer.link === 'INESTABLE') await this.setLink(peer, 'CONECTADA');
    if (this.processed.has(env.messageId)) return; // duplicado: ya procesado (14.3)
    if (env.type === 'CAPTURE_OK' || env.type === 'QUALITY_ERROR' || env.type === 'RESYNC_STATE' || env.type === 'ERROR') {
      this.processed.add(env.messageId);
    }
    switch (env.type) {
      case 'HEARTBEAT':
        return this.onHeartbeat(peer, env as Envelope<'HEARTBEAT'>);
      case 'CAPTURE_OK':
      case 'QUALITY_ERROR':
      case 'ERROR':
        return this.onOrderResponse(peer, env);
      case 'RESYNC_STATE':
        return this.onResyncState(peer, env as Envelope<'RESYNC_STATE'>);
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- emparejamiento (14.6)

  private async onPairRequest(from: PeerInfo, env: Envelope<'PAIR_REQUEST'>): Promise<void> {
    const req = env.payload;
    const session = await getSession(env.sessionId);
    const devices = session ? await listSessionDevices(session.sessionId) : [];
    const decision = validatePairRequest(req, from.deviceId, session, await hashToken(req.pairingToken), devices);
    const reply = <T extends MessageType>(type: T, payload: PayloadMap[T]) =>
      this.server?.send(from.deviceId, createEnvelope(type, env.sessionId, this.myId, payload));
    if (!decision.ok || !session || !this.session || session.sessionId !== this.session.sessionId) {
      const reason = decision.ok ? 'SESSION_CLOSED' : decision.reason;
      reply('PAIR_REJECTED', { reason, detail: null });
      logEvent('WARN', 'NET', 'PAIR_REJECTED', { reason, role: req.requestedRole }, env.sessionId);
      setTimeout(() => this.server?.disconnect(from.deviceId, reason), 300);
      return;
    }
    const role = decision.role;
    const now = nowIso();
    const previous = devices.find((d) => d.deviceId === from.deviceId && !d.released);
    const device: SessionDevice = {
      sessionId: session.sessionId,
      role,
      deviceId: from.deviceId,
      userId: req.userId,
      platform: req.platform,
      model: req.model,
      osVersion: req.osVersion,
      appVersion: req.appVersion,
      pairedAt: previous?.pairedAt ?? now,
      lastSeenAt: now,
      linkStatus: 'CONECTADA',
      released: false,
      batteryLevel: req.batteryLevel,
      freeSpaceBytes: req.freeSpaceBytes,
      pendingTransfers: req.pendingTransfers,
      clockOffsetMs: previous?.clockOffsetMs ?? null,
    };
    await upsertSessionDevice(device);
    // Un mismo rol: si había otro peer en memoria con ese rol, se descarta.
    for (const [id, p] of this.peers) if (p.role === role && id !== from.deviceId) this.peers.delete(id);
    const peer: Peer = {
      deviceId: from.deviceId,
      role,
      paired: true,
      remoteAddress: from.remoteAddress,
      lastSeenMs: nowMs(),
      link: 'CONECTADA',
      offsets: this.peers.get(from.deviceId)?.offsets ?? [],
      appState: 'active',
      batteryLevel: req.batteryLevel,
      freeSpaceBytes: req.freeSpaceBytes,
      pendingTransfers: req.pendingTransfers,
    };
    this.peers.set(from.deviceId, peer);
    this.applyDeviceToCard(device, 'CONECTADA', req.userName);
    this.send(from.deviceId, 'PAIRED', {
      role,
      controllerDeviceId: this.myId,
      serverTime: now,
      config: buildPairedConfig(),
      syncedSessionIds: await listSyncedSessionIds(),
    });
    if (this.session.status !== 'CLOSING') this.send(from.deviceId, 'SESSION_CONTEXT', this.sessionContextPayload());
    const passes = await listPasses(session.sessionId);
    if (passes.length > 0) {
      this.resyncing.add(from.deviceId);
      this.send(from.deviceId, 'RESYNC_REQUEST', { passId: this.pass?.passId ?? null, lastSequenceIdKnown: null });
    }
    logEvent('INFO', 'NET', 'PAIRED', { role, reconnect: decision.reconnect }, session.sessionId);
    if (decision.reconnect) pushNotice('CAMARA_RECONECTADA', 'success');
    this.publish();
  }

  private applyDeviceToCard(d: SessionDevice, link: CameraLinkStatus, userName?: string): void {
    patchCamera(d.role, {
      deviceId: d.deviceId,
      link,
      model: d.model,
      platform: d.platform,
      appVersion: d.appVersion,
      batteryLevel: d.batteryLevel,
      freeSpaceBytes: d.freeSpaceBytes,
      pendingTransfers: d.pendingTransfers,
      clockOffsetMs: d.clockOffsetMs,
      ...(userName ? { userName } : {}),
    });
  }

  private async setLink(peer: Peer, link: CameraLinkStatus, detail?: string): Promise<void> {
    if (peer.link === link) return;
    const prev = peer.link;
    peer.link = link;
    if (peer.role) patchCamera(peer.role, { link });
    if (this.session) await updateDeviceLink(this.session.sessionId, peer.deviceId, { linkStatus: link, lastSeenAt: nowIso() });
    logEvent('INFO', 'NET', 'LINK_STATE', { role: peer.role, from: prev, to: link, detail }, this.session?.sessionId);
    if (link === 'PERDIDA' || link === 'DESCONECTADA') {
      peer.paired = link === 'PERDIDA' ? peer.paired : false;
      this.resyncing.delete(peer.deviceId);
      if (this.pass?.status === 'ACTIVE') {
        await this.pauseInternal('ENLACE_PERDIDO');
        if (this.session) {
          await addSystemIncident(
            { sessionId: this.session.sessionId, passId: this.pass?.passId, deviceId: peer.deviceId },
            'DESCONEXION',
            'AVISO',
            `${peer.role ?? 'Cámara'} sin enlace`,
          );
        }
        pushNotice('CAMARA_DESCONECTADA', 'error');
      }
    }
    this.publish();
  }

  private async onPeerClosed(peer: PeerInfo, reason: string): Promise<void> {
    const p = this.peers.get(peer.deviceId);
    if (!p) return;
    await this.setLink(p, 'PERDIDA', reason);
    p.paired = false; // debe volver a enviar PAIR_REQUEST
  }

  // ---------------------------------------------------------------- heartbeat y monitor (14.9)

  /** HEARTBEAT a cada cámara vinculada y conectada (14.9). */
  private sendHeartbeats(): void {
    const st = useController.getState();
    for (const peer of this.peers.values()) {
      if (!peer.paired || (peer.link !== 'CONECTADA' && peer.link !== 'INESTABLE')) continue;
      try {
        this.send(peer.deviceId, 'HEARTBEAT', {
          echoSentAt: null,
          role: 'CONTROLADOR',
          batteryLevel: st.ownBattery,
          freeSpaceBytes: st.ownFreeSpace,
          pendingTransfers: 0,
          lastSequenceId: st.lastSequence?.sequenceId ?? null,
          appState: 'active',
        });
      } catch (err) {
        logError('controller.heartbeat', err);
      }
    }
  }

  /** Estado del enlace de cada cámara según el silencio (14.9). Corre en la cola: puede pausar la pasada. */
  private async heartbeatTick(): Promise<void> {
    const now = nowMs();
    for (const peer of this.peers.values()) {
      if (!peer.paired) continue;
      const next = linkFromSilence(peer.link, now - peer.lastSeenMs, CONFIG.protocol);
      if (next !== peer.link) await this.setLink(peer, next, 'heartbeat');
    }
  }

  private async onHeartbeat(peer: Peer, env: Envelope<'HEARTBEAT'>): Promise<void> {
    const p = env.payload;
    peer.batteryLevel = p.batteryLevel;
    peer.freeSpaceBytes = p.freeSpaceBytes;
    peer.pendingTransfers = p.pendingTransfers;
    peer.appState = p.appState;
    let offset: number | null = null;
    if (p.echoSentAt) {
      const sample = clockOffsetSample(new Date(p.echoSentAt).getTime(), new Date(env.sentAt).getTime(), nowMs());
      peer.offsets = pushSample(peer.offsets, sample.offsetMs, CONFIG.protocol.clockOffsetSamples);
      offset = offsetMedian(peer.offsets);
    }
    if (peer.role) {
      patchCamera(peer.role, {
        batteryLevel: p.batteryLevel,
        freeSpaceBytes: p.freeSpaceBytes,
        pendingTransfers: p.pendingTransfers,
        clockOffsetMs: offset,
      });
    }
    if (this.session) {
      await updateDeviceLink(this.session.sessionId, peer.deviceId, {
        lastSeenAt: nowIso(),
        batteryLevel: p.batteryLevel,
        freeSpaceBytes: p.freeSpaceBytes,
        pendingTransfers: p.pendingTransfers,
        clockOffsetMs: offset,
      });
    }
    if (p.appState !== 'active' && this.pass?.status === 'ACTIVE') {
      await this.pauseInternal('SEGUNDO_PLANO');
      pushNotice('PAUSA_SEGUNDO_PLANO', 'warn');
    }
  }

  // ---------------------------------------------------------------- RESYNC (14.9)

  private async onResyncState(peer: Peer, env: Envelope<'RESYNC_STATE'>): Promise<void> {
    const p = env.payload;
    for (const c of p.captures) {
      const seq = await getSequence(c.sequenceId);
      const role = peer.role;
      if (!seq || !role || seq.slots[role].captureId !== c.captureId) {
        if (this.session && !seq) {
          await addSystemIncident(
            { sessionId: this.session.sessionId, captureId: c.captureId, deviceId: peer.deviceId },
            'TRANSFERENCIA',
            'INFO',
            'Captura no emitida en RESYNC',
          );
        }
        continue;
      }
      const outcome = seq.slots[role].outcome;
      if (outcome === 'PENDIENTE' || outcome === 'SIN_RESPUESTA') {
        const accepted = c.qualityStatus === 'UTILIZABLE' || c.qualityStatus === 'PENDIENTE_REVISION_TECNICA';
        const next: SlotOutcome = accepted
          ? 'OK_PENDIENTE_ARCHIVO'
          : c.qualityStatus === 'ERROR_CAMARA'
            ? 'ERROR_CAMARA'
            : 'RECHAZADA_CALIDAD';
        await applyOutcome(seq.sequenceId, role, next, c.captureId);
      }
    }
    if (p.page >= p.totalPages) {
      this.resyncing.delete(peer.deviceId);
      logEvent('INFO', 'NET', 'RESYNC', { role: peer.role, captures: p.captures.length }, this.session?.sessionId);
      await this.refreshPassView();
      this.publish();
    }
  }

  // ---------------------------------------------------------------- respuestas a órdenes (14.7)

  private async onOrderResponse(peer: Peer, env: Envelope): Promise<void> {
    const role = peer.role;
    if (!role || !this.session) return;
    let sequenceId: string;
    let captureId: string | null;
    let outcome: SlotOutcome;
    let refMessageId: string | null = null;
    if (env.type === 'CAPTURE_OK') {
      const p = env.payload as PayloadMap['CAPTURE_OK'];
      sequenceId = p.sequenceId;
      captureId = p.captureId;
      outcome = 'OK_PENDIENTE_ARCHIVO';
      patchCamera(role, { lastQuality: p.qualityStatus });
      logEvent('INFO', 'CAPTURE', 'CAPTURE_OK', { role, ms: p.captureDurationMs, q: p.qualityStatus }, this.session.sessionId);
    } else if (env.type === 'QUALITY_ERROR') {
      const p = env.payload as PayloadMap['QUALITY_ERROR'];
      sequenceId = p.sequenceId;
      captureId = p.captureId;
      outcome = p.qualityStatus === 'ERROR_CAMARA' ? 'ERROR_CAMARA' : 'RECHAZADA_CALIDAD';
      patchCamera(role, { lastQuality: p.qualityStatus });
      logEvent('WARN', 'CAPTURE', 'QUALITY_ERROR', { role, q: p.qualityStatus, reasons: p.reasons }, this.session.sessionId);
      if (p.reasons.includes('CAMARA_EN_MOVIMIENTO')) pushNotice('CAMARA_EN_MOVIMIENTO', 'warn');
    } else {
      const p = env.payload as PayloadMap['ERROR'];
      refMessageId = p.refMessageId;
      const target = this.order
        ? [...this.order.awaiting.entries()].find(([r, a]) => r === role && a.messageId === refMessageId)
        : undefined;
      if (!target || !this.order) {
        logEvent('WARN', 'NET', 'ERROR_RECIBIDO', { code: p.code, role }, this.session.sessionId);
        return;
      }
      sequenceId = this.order.sequenceId;
      captureId = target[1].captureId;
      outcome = p.code === 'INTERNAL' ? 'ERROR_CAMARA' : 'SIN_RESPUESTA';
      if (p.code === 'WRONG_PASS') this.send(peer.deviceId, 'SESSION_CONTEXT', this.sessionContextPayload());
      if (p.code === 'COMMAND_EXPIRED') pushNotice('ORDEN_VENCIDA', 'warn');
      await addSystemIncident(
        { sessionId: this.session.sessionId, passId: this.pass?.passId, sequenceId, deviceId: peer.deviceId },
        p.code === 'INTERNAL' ? 'SOPORTE' : 'OTRO',
        'AVISO',
        `Cámara respondió ${p.code}`,
      );
    }

    const isCurrent =
      this.order && this.order.sequenceId === sequenceId && this.order.awaiting.get(role)?.captureId === captureId;

    // Prueba corta: solo observaciones (no hay secuencia en SQLite).
    if (this.shortTest && this.shortTest.pending.testId === sequenceId) {
      const o = this.shortTest.obs[role];
      o.response = env.type === 'CAPTURE_OK' ? 'CAPTURE_OK' : env.type === 'QUALITY_ERROR' ? 'QUALITY_ERROR' : 'ERROR';
      o.quality =
        env.type === 'ERROR' ? null : (env.payload as PayloadMap['CAPTURE_OK'] | PayloadMap['QUALITY_ERROR']).qualityStatus;
      o.responseMs = nowMs() - this.shortTest.startedMs;
      if (env.type === 'CAPTURE_OK') this.shortTest.capturedAt[role] = (env.payload as PayloadMap['CAPTURE_OK']).capturedAt;
      if (env.type === 'QUALITY_ERROR') this.shortTest.capturedAt[role] = (env.payload as PayloadMap['QUALITY_ERROR']).capturedAt;
      if (isCurrent) this.order?.awaiting.delete(role);
      this.updateShortTestView();
      await this.evaluateShortTest(false);
      if (this.order && this.order.awaiting.size === 0) await this.finishOrder();
      return;
    }

    // Evidencia: fila de la captura en espera de la foto (14.7 paso 7) y resultado de la cámara.
    if (captureId && env.type !== 'ERROR') {
      const fileExpected =
        env.type === 'CAPTURE_OK' ||
        ((env.payload as PayloadMap['QUALITY_ERROR']).fileAvailable && CONFIG.transfer.includeRejected);
      if (fileExpected) await this.ensurePendingCaptureRow(peer, env, sequenceId, captureId);
    }
    const updated = await applyOutcome(sequenceId, role, outcome, captureId ?? undefined);
    if (updated) patchCamera(role, { lastOutcome: updated.slots[role].outcome });
    if (outcome === 'RECHAZADA_CALIDAD' || outcome === 'ERROR_CAMARA') {
      await addSystemIncident(
        { sessionId: this.session.sessionId, passId: this.pass?.passId, sequenceId, captureId, deviceId: peer.deviceId },
        'CALIDAD',
        'INFO',
        `${role} ${outcome}`,
      );
    }
    if (isCurrent && this.order) {
      const a = this.order.awaiting.get(role);
      if (a) logEvent('DEBUG', 'CAPTURE', 'LATENCY_MS', { role, ms: nowMs() - a.sentMs }, this.session.sessionId);
      this.order.awaiting.delete(role);
      if (this.order.awaiting.size === 0) await this.finishOrder();
    }
    await this.refreshPassView();
  }

  /**
   * Fila de la captura en espera de su archivo (14.7 paso 7): sirve para contar las fotos que faltan llegar (PANT-19).
   * Usa los datos reales de la pasada (lateral), del celular de la cámara (usuario) y de la repetición; cuando llega
   * el archivo, consolidationService la completa con los metadatos de la cámara.
   */
  private async ensurePendingCaptureRow(peer: Peer, env: Envelope, sequenceId: string, captureId: string): Promise<void> {
    if (await getCapture(captureId)) return;
    const seq = await getSequence(sequenceId);
    if (!seq || !peer.role) return;
    const ok = env.type === 'CAPTURE_OK' ? (env.payload as PayloadMap['CAPTURE_OK']) : null;
    const qe = env.type === 'QUALITY_ERROR' ? (env.payload as PayloadMap['QUALITY_ERROR']) : null;
    const pass = this.pass && this.pass.passId === seq.passId ? this.pass : await getPass(seq.passId);
    const device = await getSessionDevice(seq.sessionId, peer.deviceId);
    const retake = await getRetakeByCapture(captureId);
    await upsertCapture({
      captureId,
      sequenceId,
      sessionId: seq.sessionId,
      passId: seq.passId,
      lateralCode: pass?.lateralCode ?? 'LATERAL_A',
      isTest: false,
      deviceId: peer.deviceId,
      cameraRole: peer.role,
      userId: device?.userId ?? useAppSession.getState().user?.id ?? '',
      capturedAt: ok?.capturedAt ?? qe?.capturedAt ?? nowIso(),
      filePath: null,
      sizeBytes: ok?.sizeBytes ?? null,
      width: ok?.width ?? null,
      height: ok?.height ?? null,
      md5: ok?.md5 ?? null,
      qualityStatus: ok?.qualityStatus ?? qe?.qualityStatus ?? 'CAPTURED',
      qualityProfileVersion: ok?.profileVersion ?? qe?.profileVersion ?? CONFIG.quality.profileVersion,
      replacesCaptureId: retake?.replacesCaptureId ?? null,
      localTransferStatus: 'PENDIENTE_LOCAL',
      remoteSyncStatus: 'PENDIENTE_NUBE',
      transferAttempts: 0,
      syncAttempts: 0,
      lastError: null,
      fileDeletedAt: null,
    });
  }

  private async onOrderTimeout(): Promise<void> {
    const order = this.order;
    if (!order || !this.session) return;
    for (const [role, a] of order.awaiting) {
      if (order.kind === 'TEST' && this.shortTest) {
        this.shortTest.obs[role].response = 'SIN_RESPUESTA';
        continue;
      }
      const updated = await applyOutcome(order.sequenceId, role, 'SIN_RESPUESTA', a.captureId);
      if (updated) patchCamera(role, { lastOutcome: 'SIN_RESPUESTA' });
      await addSystemIncident(
        { sessionId: this.session.sessionId, passId: this.pass?.passId, sequenceId: order.sequenceId, captureId: a.captureId },
        'OTRO',
        'AVISO',
        `${role} sin respuesta`,
      );
    }
    order.awaiting.clear();
    if (order.kind === 'TEST') {
      this.updateShortTestView();
      await this.evaluateShortTest(false);
    }
    await this.finishOrder();
  }

  private async finishOrder(): Promise<void> {
    if (this.order) clearTimeout(this.order.timer);
    this.order = null;
    await this.refreshPassView();
    this.publish();
    this.scheduleAuto();
  }

  // ---------------------------------------------------------------- recepción de fotos

  private async onFile(meta: LocalCaptureMeta, tempUri: string, remote: string | null) {
    return consolidateCapture(meta, tempUri, remote, {
      peerAddress: (deviceId) => {
        const p = this.peers.get(deviceId);
        if (!p || this.factory.kind === 'SIMULADOR') return null;
        return p.remoteAddress || null;
      },
      shortTestPending: () => this.shortTest?.pending ?? null,
      onShortTestFile: (role) => {
        if (!this.shortTest) return;
        this.shortTest.obs[role].transferred = true;
        this.shortTest.obs[role].totalMs = nowMs() - this.shortTest.startedMs;
        this.updateShortTestView();
        void this.evaluateShortTest(false);
      },
      onEvidenceFile: (role) => {
        void this.refreshPassView().then(() => {
          const seq = useController.getState().lastSequence;
          if (seq) patchCamera(role, { lastOutcome: seq.slots[role].outcome });
        });
      },
      sendAckFile: (deviceId, sessionId, captureId, result) => {
        this.server?.send(
          deviceId,
          createEnvelope('ACK', sessionId, this.myId, { ackType: 'FILE', refMessageId: null, captureId, result, reason: null }),
        );
      },
    });
  }

  // ============================================================== vista de la pasada

  private async refreshPassView(): Promise<void> {
    if (!this.pass) {
      useController.setState({ lastSequence: null, counters: { total: 0, complete: 0, partial: 0, incomplete: 0 }, retakes: [] });
      return;
    }
    const { pass, partial } = await refreshCounters(this.pass.passId);
    this.pass = pass;
    const last = await lastSequence(pass.passId);
    const seqs = await listSequences(pass.passId);
    const retakes: { role: CameraRole; sequenceNumber: number; sequenceId: string }[] = [];
    for (const role of CAMERA_ROLES) {
      for (let i = seqs.length - 1; i >= 0; i--) {
        if (isRetakeable(seqs[i].slots[role].outcome)) {
          retakes.push({ role, sequenceNumber: seqs[i].sequenceNumber, sequenceId: seqs[i].sequenceId });
          break;
        }
      }
    }
    useController.setState({
      pass,
      lastSequence: last,
      retakes,
      counters: {
        total: pass.sequencesTotal,
        complete: pass.sequencesComplete,
        partial,
        incomplete: pass.sequencesIncomplete,
      },
    });
  }

  // ============================================================== ACCIONES DEL OPERADOR

  /** PANT-12 — Crear sesión (DRAFT). */
  createSession(mode: 'MANUAL' | 'AUTOMATICO', intervalMs: number): Promise<ActionResult> {
    return this.exclusive(async () => {
      const user = useAppSession.getState().user;
      if (!user) return fail('ERROR_INESPERADO');
      const st = useController.getState();
      const r = await createDraft({
        mode,
        intervalMs,
        operatorUserId: user.id,
        controllerDeviceId: this.myId,
        batteryPct: st.ownBattery,
        freeSpaceBytes: st.ownFreeSpace,
      });
      if (!r.ok) return fail(r.code);
      this.session = r.session;
      this.pass = null;
      setLogSession(r.session.sessionId);
      useController.setState({
        shortTest: emptyShortTest(),
        cameras: { CAMERA_1: emptyCard('CAMERA_1'), CAMERA_2: emptyCard('CAMERA_2') },
      });
      this.publish();
      return OK;
    });
  }

  discardDraft(): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (!this.session || this.session.status !== 'DRAFT') return fail('ERROR_INESPERADO');
      await discardDraft(this.session.sessionId);
      this.session = null;
      setLogSession(null);
      this.publish();
      return OK;
    });
  }

  /** PANT-13 — DRAFT → PREPARING: token nuevo, servidores y QR. Si ya está preparada, solo muestra el QR. */
  openPairing(): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (!this.session) return fail('ERROR_INESPERADO');
      if (this.session.status === 'DRAFT') {
        this.token = newPairingToken();
        await secureSet(SECURE_KEYS.pairingToken, this.token);
        this.session = await setStatus(this.session, 'PREPARING', { pairingTokenHash: await hashToken(this.token) });
      }
      if (!this.token) this.token = await secureGet(SECURE_KEYS.pairingToken);
      if (!this.token) {
        this.token = newPairingToken();
        await secureSet(SECURE_KEYS.pairingToken, this.token);
        this.session = await patchSession(this.session, { pairingTokenHash: await hashToken(this.token) });
      }
      await this.startServers();
      await this.startTelemetry();
      this.publish();
      return OK;
    });
  }

  /** "Regenerar QR": el anterior deja de valer (INVALID_TOKEN); las cámaras conectadas siguen conectadas. */
  regenerateQr(): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (!this.session) return fail('ERROR_INESPERADO');
      this.token = newPairingToken();
      await secureSet(SECURE_KEYS.pairingToken, this.token);
      this.session = await patchSession(this.session, { pairingTokenHash: await hashToken(this.token) });
      const qr = useController.getState().qr;
      if (qr) {
        const payload = { ...qr.payload, pairingToken: this.token };
        useController.setState({ qr: { payload, text: JSON.stringify(payload) } });
        this.factory.simulator?.connectAll(payload);
      }
      logEvent('INFO', 'NET', 'QR_REGENERATED', {}, this.session.sessionId);
      return OK;
    });
  }

  /** IP escrita a mano (Q-04) cuando getIpAddressAsync no la detecta (hotspot). */
  setManualIp(ip: string | null): void {
    this.manualIp = ip && ip.trim() ? ip.trim() : null;
    const qr = useController.getState().qr;
    if (qr && this.manualIp) {
      const payload = { ...qr.payload, host: this.manualIp };
      useController.setState({ qr: { payload, text: JSON.stringify(payload) } });
    }
  }

  /** "Liberar CÁMARA X" (RN-16): solo con esa cámara PERDIDA/DESCONECTADA y sin pasada abierta. */
  releaseCamera(role: CameraRole): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (!this.session) return fail('ERROR_INESPERADO');
      const link = this.linkOf(role);
      const openPass = this.pass && ['READY', 'ACTIVE', 'PAUSED'].includes(this.pass.status);
      if (openPass || (link !== 'PERDIDA' && link !== 'DESCONECTADA')) return fail('LIBERAR_CAMARA_NO_PERMITIDO');
      await releaseRole(this.session.sessionId, role);
      for (const [id, p] of this.peers) if (p.role === role) this.peers.delete(id);
      patchCamera(role, emptyCard(role));
      if (this.session.status === 'READY') this.session = await setStatus(this.session, 'PREPARING', { shortTestPassedAt: null });
      else this.session = await patchSession(this.session, { shortTestPassedAt: null });
      useController.setState({ shortTest: emptyShortTest() });
      logEvent('INFO', 'SESSION', 'ROLE_RELEASED', { role }, this.session.sessionId);
      this.publish();
      return OK;
    });
  }

  /** Herramientas del simulador (solo Expo Go). */
  get simulator() {
    return this.factory.simulator;
  }

  // ---------------------------------------------------------------- prueba corta (14.12)

  runShortTest(): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (!this.session || this.session.status !== 'PREPARING') return fail('ERROR_INESPERADO');
      const links = this.links();
      if (links.CAMERA_1 !== 'CONECTADA' || links.CAMERA_2 !== 'CONECTADA') return fail('CAMARAS_NO_LISTAS');
      if (this.order) return fail('ORDEN_EN_CURSO');
      const testId = newId();
      const captureIds: Record<CameraRole, string> = { CAMERA_1: newId(), CAMERA_2: newId() };
      const issuedAt = nowIso();
      const pending: ShortTestPending = { sessionId: this.session.sessionId, testId, captureIds, issuedAt };
      await setMetaJson('short_test_pending', pending);
      if (this.shortTest) clearTimeout(this.shortTest.timer);
      const obs = (): ShortTestObservation => ({
        response: null,
        quality: null,
        transferred: false,
        responseMs: null,
        totalMs: null,
      });
      this.shortTest = {
        pending,
        startedMs: nowMs(),
        obs: { CAMERA_1: obs(), CAMERA_2: obs() },
        capturedAt: { CAMERA_1: null, CAMERA_2: null },
        timer: setTimeout(() => void this.enqueue(() => this.evaluateShortTest(true)), CONFIG.shortTest.timeoutMs),
      };
      const awaiting = new Map<CameraRole, { captureId: string; messageId: string; sentMs: number }>();
      for (const role of CAMERA_ROLES) {
        const peer = this.peerByRole(role) as Peer;
        const { env } = this.send(peer.deviceId, 'CAPTURE_COMMAND', {
          purpose: 'PRUEBA_CORTA',
          sequenceId: testId,
          sequenceNumber: 0,
          captureId: captureIds[role],
          passId: null,
          lateralCode: null,
          mode: this.session.mode,
          issuedAt,
          expiresAt: addMsIso(issuedAt, CONFIG.protocol.commandValidityMs),
          replacesCaptureId: null,
        });
        awaiting.set(role, { captureId: captureIds[role], messageId: env.messageId, sentMs: nowMs() });
      }
      this.order = {
        kind: 'TEST',
        sequenceId: testId,
        awaiting,
        issuedMs: nowMs(),
        timer: setTimeout(() => void this.enqueue(() => this.onOrderTimeout()), CONFIG.protocol.captureResponseTimeoutMs),
      };
      const st = emptyShortTest();
      st.running = true;
      st.CAMERA_1.state = 'EN_CURSO';
      st.CAMERA_2.state = 'EN_CURSO';
      useController.setState({ shortTest: st });
      this.publish();
      return OK;
    });
  }

  private updateShortTestView(): void {
    if (!this.shortTest) return;
    const cur = useController.getState().shortTest;
    const next = { ...cur };
    for (const role of CAMERA_ROLES) {
      const o = this.shortTest.obs[role];
      next[role] = {
        ...cur[role],
        response: o.response,
        quality: o.quality,
        transferred: o.transferred,
        responseMs: o.responseMs,
        totalMs: o.totalMs,
        capturedAt: this.shortTest.capturedAt[role],
        state: decideShortTest(o, {
          captureResponseTimeoutMs: CONFIG.protocol.captureResponseTimeoutMs,
          shortTestTimeoutMs: CONFIG.shortTest.timeoutMs,
        }),
      };
    }
    useController.setState({ shortTest: next });
  }

  private async evaluateShortTest(timedOut: boolean): Promise<void> {
    const run = this.shortTest;
    if (!run || !this.session) return;
    const cfg = {
      captureResponseTimeoutMs: CONFIG.protocol.captureResponseTimeoutMs,
      shortTestTimeoutMs: CONFIG.shortTest.timeoutMs,
    };
    const states = CAMERA_ROLES.map((r) => {
      const s = decideShortTest(run.obs[r], cfg);
      return timedOut && !isShortTestFinal(s) ? 'REPROBADA' : s;
    });
    if (!states.every(isShortTestFinal)) return;
    clearTimeout(run.timer);
    this.shortTest = null;
    const passed = states.every(isShortTestPassed);
    const c1 = run.capturedAt.CAMERA_1;
    const c2 = run.capturedAt.CAMERA_2;
    const off1 = useController.getState().cameras.CAMERA_1.clockOffsetMs ?? 0;
    const off2 = useController.getState().cameras.CAMERA_2.clockOffsetMs ?? 0;
    const offsetMs = c1 && c2 ? Math.abs(new Date(c1).getTime() - off1 - (new Date(c2).getTime() - off2)) : null;
    const view = useController.getState().shortTest;
    const reasons = CAMERA_ROLES.map((r) => shortTestFailReason(run.obs[r], cfg, timedOut));
    useController.setState({
      shortTest: {
        ...view,
        CAMERA_1: { ...view.CAMERA_1, state: states[0], detail: states[0] === 'REPROBADA' ? reasons[0] : null },
        CAMERA_2: { ...view.CAMERA_2, state: states[1], detail: states[1] === 'REPROBADA' ? reasons[1] : null },
        running: false,
        passed,
        offsetMs,
      },
    });
    logEvent(
      passed ? 'INFO' : 'WARN',
      'SESSION',
      'SHORT_TEST',
      { passed, states, reasons, offsetMs, obs: run.obs, limits: cfg },
      this.session.sessionId,
    );
    if (passed) {
      await deleteMeta('short_test_pending');
      this.session = await setStatus(this.session, 'READY', { shortTestPassedAt: nowIso() });
      pushNotice(
        states.includes('APROBADA_CALIDAD') ? 'PRUEBA_CORTA_CALIDAD' : 'PRUEBA_APROBADA',
        states.includes('APROBADA_CALIDAD') ? 'warn' : 'success',
      );
    } else {
      pushNotice('PRUEBA_CORTA_FALLIDA', 'error');
    }
    this.publish();
  }

  // ---------------------------------------------------------------- pasada

  async evaluateStart(): Promise<{ links: Record<CameraRole, CameraLinkStatus>; shortTestPassed: boolean }> {
    return { links: this.links(), shortTestPassed: !!this.session?.shortTestPassedAt };
  }

  private healthList(): DeviceHealth[] {
    const st = useController.getState();
    const list: DeviceHealth[] = [{ batteryPct: st.ownBattery, freeSpaceBytes: st.ownFreeSpace }];
    for (const role of CAMERA_ROLES)
      list.push({ batteryPct: st.cameras[role].batteryLevel, freeSpaceBytes: st.cameras[role].freeSpaceBytes });
    return list;
  }

  /** PANT-15 — Iniciar pasada: START_PASS con ACK de ambas cámaras → ACTIVE + SESSION_CONTEXT. */
  startPass(input: {
    lotId: string;
    rowId: string;
    lateral: LateralCode;
    direction: Direction;
    segmentId: string | null;
    markerId: string | null;
    repeatReason: string | null;
  }): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (!this.session || this.session.status !== 'READY')
        return fail(this.session?.shortTestPassedAt ? 'PASADA_ABIERTA' : 'PRUEBA_CORTA_PENDIENTE');
      const rule = canStartPass({
        links: this.links(),
        shortTestPassed: !!this.session.shortTestPassedAt,
        lotId: input.lotId,
        rowId: input.rowId,
        lateral: input.lateral,
        markerId: input.markerId,
        devices: this.healthList(),
        minBatteryPct: CONFIG.device.minBatteryToStartPct,
        minFreeSpaceBytes: CONFIG.device.minFreeSpaceToStartBytes,
      });
      if (!rule.ok) return fail(rule.code);
      const created = await createPass({ sessionId: this.session.sessionId, ...input, markerId: input.markerId as string });
      if (!created.ok) return fail(created.code);
      let pass = created.pass;
      this.pass = pass;
      const acks = await this.broadcastAcked('START_PASS', {
        passId: pass.passId,
        lateralCode: pass.lateralCode,
        passOrder: pass.passOrder,
      });
      if (acks.length < 2 || acks.some((a) => !a)) {
        pass = await setPassStatus(pass, 'INCOMPLETE', { endedAt: nowIso() });
        await addSystemIncident(
          { sessionId: this.session.sessionId, passId: pass.passId },
          'DESCONEXION',
          'AVISO',
          'Sin ACK de START_PASS',
        );
        this.pass = null;
        this.publish();
        return fail('CAMARAS_NO_LISTAS');
      }
      pass = await setPassStatus(pass, 'ACTIVE', { startedAt: nowIso() });
      this.pass = pass;
      this.session = await setStatus(this.session, 'ACTIVE', { startedAt: this.session.startedAt ?? nowIso() });
      await this.broadcastAcked('SESSION_CONTEXT', this.sessionContextPayload());
      await this.refreshPassView();
      this.lastIssuedMs = 0;
      this.publish();
      this.scheduleAuto();
      return OK;
    });
  }

  /** Disparo MANUAL ("CAPTURAR"). En AUTOMÁTICO lo usa el temporizador. */
  capture(): Promise<ActionResult> {
    return this.enqueue(() => this.issueSequence());
  }

  private async issueSequence(): Promise<ActionResult> {
    if (!this.session || !this.pass || this.pass.status !== 'ACTIVE') return fail('PASADA_NO_ABIERTA');
    if (this.order) return fail('ORDEN_EN_CURSO');
    const links = this.links();
    if (links.CAMERA_1 !== 'CONECTADA' || links.CAMERA_2 !== 'CONECTADA') return fail('CAMARAS_NO_LISTAS');
    if (this.resyncing.size > 0) return fail('RESYNC_EN_CURSO');
    const seq = await createSequence(this.pass, this.session.mode, latestFix());
    const awaiting = new Map<CameraRole, { captureId: string; messageId: string; sentMs: number }>();
    for (const role of CAMERA_ROLES) {
      const peer = this.peerByRole(role) as Peer;
      const { env } = this.send(peer.deviceId, 'CAPTURE_COMMAND', {
        purpose: 'SECUENCIA',
        sequenceId: seq.sequenceId,
        sequenceNumber: seq.sequenceNumber,
        captureId: seq.slots[role].captureId,
        passId: this.pass.passId,
        lateralCode: this.pass.lateralCode,
        mode: this.session.mode,
        issuedAt: seq.issuedAt,
        expiresAt: seq.expiresAt,
        replacesCaptureId: null,
      });
      awaiting.set(role, { captureId: seq.slots[role].captureId, messageId: env.messageId, sentMs: nowMs() });
    }
    const sent = await markSent(seq, true);
    this.lastIssuedMs = nowMs();
    this.order = {
      kind: 'SEQ',
      sequenceId: seq.sequenceId,
      awaiting,
      issuedMs: nowMs(),
      timer: setTimeout(() => void this.enqueue(() => this.onOrderTimeout()), CONFIG.protocol.captureResponseTimeoutMs),
    };
    patchCamera('CAMERA_1', { lastOutcome: 'PENDIENTE' });
    patchCamera('CAMERA_2', { lastOutcome: 'PENDIENTE' });
    useController.setState({ lastSequence: sent });
    this.publish();
    return OK;
  }

  // ---------------------------------------------------------------- automático

  private scheduleAuto(): void {
    this.stopAuto();
    if (this.autoState() !== 'ACTIVE' || this.order) return;
    const wait = Math.max(150, this.lastIssuedMs + (this.session?.intervalMs ?? CONFIG.capture.intervalMs) - nowMs());
    this.autoTimer = setTimeout(() => void this.enqueue(() => this.autoTick()), wait);
  }

  private stopAuto(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
  }

  private async autoTick(): Promise<void> {
    this.autoTimer = null;
    if (this.autoState() !== 'ACTIVE' || this.order) return;
    if (this.queuedRetake) {
      const role = this.queuedRetake;
      this.queuedRetake = null;
      const r = await this.issueRetake(role);
      if (r.ok) return;
    }
    const r = await this.issueSequence();
    if (!r.ok) this.scheduleAuto();
  }

  // ---------------------------------------------------------------- repetición (8.5, RN-07)

  retake(role: CameraRole): Promise<ActionResult> {
    if (this.autoState() === 'ACTIVE' && this.order) {
      // En automático la repetición sale en lugar de la siguiente secuencia.
      this.queuedRetake = role;
      pushNotice('REPETICION_EN_COLA', 'info');
      return Promise.resolve(OK);
    }
    return this.enqueue(() => this.issueRetake(role));
  }

  private async issueRetake(role: CameraRole): Promise<ActionResult> {
    if (!this.session || !this.pass || this.pass.status !== 'ACTIVE') return fail('PASADA_NO_ABIERTA');
    if (this.order) return fail('ORDEN_EN_CURSO');
    if (this.linkOf(role) !== 'CONECTADA') return fail('CAMARA_DESCONECTADA');
    const target = useController.getState().retakes.find((r) => r.role === role);
    if (!target) return fail('ERROR_INESPERADO');
    const seq = (await getSequence(target.sequenceId)) as CaptureSequence;
    const { seq: updated, newCaptureId, replaces } = await prepareRetake(seq, role, this.pass, latestFix());
    const issuedAt = nowIso();
    const peer = this.peerByRole(role) as Peer;
    const { env } = this.send(peer.deviceId, 'CAPTURE_COMMAND', {
      purpose: 'SECUENCIA',
      sequenceId: seq.sequenceId,
      sequenceNumber: seq.sequenceNumber,
      captureId: newCaptureId,
      passId: this.pass.passId,
      lateralCode: this.pass.lateralCode,
      mode: this.session.mode,
      issuedAt,
      expiresAt: addMsIso(issuedAt, CONFIG.protocol.commandValidityMs),
      replacesCaptureId: replaces,
    });
    this.lastIssuedMs = nowMs();
    this.order = {
      kind: 'RETAKE',
      sequenceId: seq.sequenceId,
      awaiting: new Map([[role, { captureId: newCaptureId, messageId: env.messageId, sentMs: nowMs() }]]),
      issuedMs: nowMs(),
      timer: setTimeout(() => void this.enqueue(() => this.onOrderTimeout()), CONFIG.protocol.captureResponseTimeoutMs),
    };
    patchCamera(role, { lastOutcome: 'PENDIENTE' });
    useController.setState({ lastSequence: updated });
    await this.refreshPassView();
    this.publish();
    return OK;
  }

  // ---------------------------------------------------------------- pausa / reanudar

  pause(): Promise<ActionResult> {
    return this.enqueue(async () => {
      if (!this.pass || this.pass.status !== 'ACTIVE') return fail('PASADA_NO_ABIERTA');
      await this.pauseInternal('OPERADOR');
      return OK;
    });
  }

  private async pauseInternal(reason: PayloadMap['PAUSE']['reason']): Promise<void> {
    if (!this.session || !this.pass || this.pass.status !== 'ACTIVE') return;
    this.stopAuto();
    this.queuedRetake = null;
    this.pass = await setPassStatus(this.pass, 'PAUSED');
    if (this.session.status === 'ACTIVE') this.session = await setStatus(this.session, 'PAUSED');
    void this.broadcastAcked('PAUSE', { reason });
    if (reason !== 'OPERADOR') {
      const type =
        reason === 'BATERIA'
          ? 'BATERIA'
          : reason === 'ESPACIO'
            ? 'ESPACIO'
            : reason === 'ENLACE_PERDIDO'
              ? 'DESCONEXION'
              : 'OTRO';
      await addSystemIncident(
        { sessionId: this.session.sessionId, passId: this.pass.passId },
        type,
        'AVISO',
        `Pausa automática: ${reason}`,
      );
    }
    this.publish();
  }

  resume(): Promise<ActionResult> {
    return this.enqueue(async () => {
      if (!this.session || !this.pass || this.pass.status !== 'PAUSED') return fail('PASADA_NO_ABIERTA');
      const rule = canResumePass({
        links: this.links(),
        resyncInProgress: this.resyncing.size > 0,
        devices: this.healthList(),
        pauseBatteryPct: CONFIG.device.pauseBatteryPct,
        pauseFreeSpaceBytes: CONFIG.device.pauseFreeSpaceBytes,
      });
      if (!rule.ok) return fail(rule.code);
      this.pass = await setPassStatus(this.pass, 'ACTIVE');
      if (this.session.status === 'PAUSED') this.session = await setStatus(this.session, 'ACTIVE');
      void this.broadcastAcked('RESUME', {});
      this.lastIssuedMs = 0;
      this.publish();
      this.scheduleAuto();
      return OK;
    });
  }

  // ---------------------------------------------------------------- cambio de marcador (8.6, §25.2)

  canChangeMarkerNow(): ActionResult {
    if (!this.session || !this.pass) return fail('PASADA_NO_ABIERTA');
    const r = canChangeMarker(this.session.mode, this.pass.status, this.order !== null);
    return r.ok ? OK : fail(r.code);
  }

  changeMarker(markerId: string, segmentId: string | null): Promise<ActionResult> {
    return this.enqueue(async () => {
      const check = this.canChangeMarkerNow();
      if (!check.ok || !this.pass) return check;
      this.pass = await changeMarkerData(this.pass, markerId, segmentId, latestFix()?.fix ?? null);
      void this.broadcastAcked('SESSION_CONTEXT', this.sessionContextPayload());
      this.publish();
      return OK;
    });
  }

  // ---------------------------------------------------------------- terminar pasada (8.7)

  endPass(status: 'COMPLETED' | 'INCOMPLETE', reason: string | null): Promise<ActionResult> {
    return this.exclusive(async () => {
      if (!this.session || !this.pass || !['ACTIVE', 'PAUSED', 'READY'].includes(this.pass.status))
        return fail('PASADA_NO_ABIERTA');
      if (this.order) return fail('ORDEN_EN_CURSO');
      if (status === 'INCOMPLETE' && !(reason && reason.trim().length >= 3)) return fail('INCIDENCIA_REQUERIDA');
      this.stopAuto();
      this.queuedRetake = null;
      if (status === 'INCOMPLETE' && reason) {
        await addManualIncident({ sessionId: this.session.sessionId, passId: this.pass.passId }, 'OPERADOR', 'AVISO', reason);
      }
      await this.refreshPassView();
      const closed = await setPassStatus(this.pass, status, { endedAt: nowIso(), endMarkerId: this.pass.currentMarkerId });
      if (this.session.status === 'ACTIVE' || this.session.status === 'PAUSED')
        this.session = await setStatus(this.session, 'READY');
      this.pass = closed;
      void this.broadcastAcked('END_PASS', { passId: closed.passId, status });
      this.pass = null;
      void this.broadcastAcked('SESSION_CONTEXT', this.sessionContextPayload());
      this.pass = closed; // se conserva en la vista para el resumen de PANT-18
      this.publish();
      return OK;
    });
  }

  /** Después de cerrar la pasada, la vista vuelve a "sin pasada". */
  clearClosedPass(): void {
    if (this.pass && (this.pass.status === 'COMPLETED' || this.pass.status === 'INCOMPLETE')) {
      this.pass = null;
      void this.refreshPassView();
      this.publish();
    }
  }

  // ---------------------------------------------------------------- cerrar sesión de monitoreo (8.8)

  async missingPhotos(): Promise<Record<CameraRole, number>> {
    if (!this.session) return { CAMERA_1: 0, CAMERA_2: 0 };
    return countMissingByRole(this.session.sessionId);
  }

  closeSession(force: boolean): Promise<ActionResult & { missing?: Record<CameraRole, number> }> {
    return this.exclusive(async () => {
      if (!this.session) return fail('ERROR_INESPERADO');
      if (this.order) return fail('ORDEN_EN_CURSO');
      this.stopAuto();
      if (['PREPARING', 'READY', 'ACTIVE', 'PAUSED'].includes(this.session.status))
        this.session = await setStatus(this.session, 'CLOSING');
      const open = await getOpenPass(this.session.sessionId);
      if (open) {
        await addSystemIncident(
          { sessionId: this.session.sessionId, passId: open.passId },
          'OPERADOR',
          'AVISO',
          'Pasada cerrada al cerrar la sesión',
        );
        await setPassStatus(open, 'INCOMPLETE', { endedAt: nowIso(), endMarkerId: open.currentMarkerId });
        void this.broadcastAcked('END_PASS', { passId: open.passId, status: 'INCOMPLETE' });
        this.pass = null;
      }
      const missing = await countMissingByRole(this.session.sessionId);
      const total = missing.CAMERA_1 + missing.CAMERA_2;
      if (total > 0 && !force) {
        this.publish();
        return { ok: false, code: 'CIERRE_CON_PENDIENTES', missing };
      }
      if (total > 0) {
        await addSystemIncident(
          { sessionId: this.session.sessionId },
          'TRANSFERENCIA',
          'AVISO',
          `Cierre con fotos pendientes: C1=${missing.CAMERA_1}, C2=${missing.CAMERA_2}`,
        );
      }
      const closed = await finalizeClose(this.session);
      this.session = closed;
      await deleteMeta('short_test_pending');
      const acks = this.broadcastAcked('SESSION_CLOSED', { sessionId: closed.sessionId });
      await Promise.race([
        acks,
        new Promise((r) => setTimeout(r, CONFIG.protocol.ackTimeoutMs * (CONFIG.protocol.ackMaxRetries + 1))),
      ]);
      await this.stopServers();
      this.stopTelemetry();
      await secureDelete(SECURE_KEYS.pairingToken);
      this.token = null;
      this.session = null;
      this.pass = null;
      setLogSession(null);
      useController.setState({
        ...initialControllerState(),
        ownBattery: useController.getState().ownBattery,
        ownFreeSpace: useController.getState().ownFreeSpace,
      });
      this.publish();
      return OK;
    });
  }

  /** Para PANT-10: ¿hay sesión abierta (7.12)? */
  hasOpenSession(): boolean {
    return !!this.session && this.session.status !== 'DRAFT';
  }

  /** Recarga la sesión desde SQLite (después de acciones fuera del runtime). */
  async reload(): Promise<void> {
    if (this.session) this.session = await getSession(this.session.sessionId);
    this.publish();
  }
}

export const controllerRuntime = new ControllerRuntime();
