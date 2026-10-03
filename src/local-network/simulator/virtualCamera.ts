// src/local-network/simulator/virtualCamera.ts — Cámara VIRTUAL para Expo Go (maestro §6.3, RF-48).
//
// QUÉ HACE: se comporta como el celular de una cámara real pero dentro del controlador:
//  - "escanea" el QR y envía PAIR_REQUEST con el token; responde ACK a PAIRED, SESSION_CONTEXT,
//    START_PASS, END_PASS, PAUSE, RESUME y SESSION_CLOSED; responde HEARTBEAT con su estado.
//  - Ante CAPTURE_COMMAND: valida vencimiento (COMMAND_EXPIRED), pasada (WRONG_PASS), ocupación (BUSY) y
//    duplicados (reenvía la respuesta guardada); "toma" una foto copiando una muestra (útil, oscura o
//    borrosa), ejecuta la CALIDAD REAL (qualityPipeline) y responde CAPTURE_OK o QUALITY_ERROR; luego
//    "transfiere" la foto al receptor del controlador.
//  - En modo AUTOMÁTICO puede reportar CAMARA_EN_MOVIMIENTO (simulator.movementRate).
//  - dropFor(ms): simula la caída del Wi-Fi y la reconexión con RESYNC (CP-20).
// NUNCA se usa en las pantallas de la cámara real (PANT-30/31/32).

import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { CONFIG } from '../../config';
import { nowIso, nowMs } from '../../domain/time';
import type { CameraRole, QualityResult, UserRole } from '../../domain/types';
import { evaluatePhoto, pipelineConfigFrom } from '../../device/qualityPipeline';
import { createEnvelope } from '../../protocol/envelope';
import type {
  CaptureContextConfig,
  Envelope,
  LocalCaptureMeta,
  MessageType,
  PairingQrPayload,
  PayloadMap,
} from '../../protocol/messages';
import { copyFile, ensureDir, fileFacts, incomingPath } from '../../storage/files';

type SampleKind = 'UTIL' | 'OSCURA' | 'BORROSA';

const SAMPLE_MODULES: Record<SampleKind, number> = {
  UTIL: require('../../../assets/sample/muestra_util.jpg'),
  OSCURA: require('../../../assets/sample/muestra_oscura.jpg'),
  BORROSA: require('../../../assets/sample/muestra_borrosa.jpg'),
};

interface SampleInfo {
  uri: string;
  width: number;
  height: number;
}
const sampleCache = new Map<SampleKind, SampleInfo>();
/** La calidad de cada muestra se calcula UNA vez con el pipeline real y se reutiliza (rapidez del simulador). */
const qualityCache = new Map<string, QualityResult>();

async function loadSample(kind: SampleKind): Promise<SampleInfo> {
  const cached = sampleCache.get(kind);
  if (cached) return cached;
  const asset = Asset.fromModule(SAMPLE_MODULES[kind]);
  await asset.downloadAsync();
  const info = { uri: asset.localUri ?? asset.uri, width: asset.width ?? 1600, height: asset.height ?? 1200 };
  sampleCache.set(kind, info);
  return info;
}

export interface VirtualUser {
  id: string;
  name: string;
  roles: UserRole[];
  authMode: 'ONLINE' | 'OFFLINE';
}

export interface VirtualCameraHost {
  /** Envía un mensaje de la cámara al servidor simulado. */
  toServer(cam: VirtualCamera, env: Envelope): void;
  /** Avisa que el "socket" se cerró. */
  closed(cam: VirtualCamera, reason: string): void;
  /** Entrega una foto al receptor del controlador; devuelve su respuesta. */
  deliver(meta: LocalCaptureMeta, tempUri: string, remote: string): Promise<{ result: string } | null>;
  user(): VirtualUser;
  platform(): 'android' | 'ios';
}

interface PendingDelivery {
  meta: LocalCaptureMeta;
  uri: string;
}

export class VirtualCamera {
  readonly deviceId: string;
  connected = false;
  private offline = false;
  private qr: PairingQrPayload | null = null;
  private config: CaptureContextConfig | null = null;
  private context: PayloadMap['SESSION_CONTEXT'] | null = null;
  private busy = false;
  private forceBad = false;
  private processed = new Map<string, Envelope>();
  private pending: PendingDelivery[] = [];
  private lastSequenceId: string | null = null;
  private battery = 92 + Math.round(Math.random() * 6);

  constructor(
    readonly role: CameraRole,
    private readonly host: VirtualCameraHost,
  ) {
    this.deviceId = role === 'CAMERA_1' ? 'a11a0000-0000-4000-8000-00000000c001' : 'a11a0000-0000-4000-8000-00000000c002';
  }

  get remoteAddress(): string {
    return `10.0.0.${this.role === 'CAMERA_1' ? 21 : 22}`;
  }

  setQr(qr: PairingQrPayload): void {
    this.qr = qr;
  }

  setForceBad(): void {
    this.forceBad = true;
  }

  setOffline(offline: boolean): void {
    this.offline = offline;
    if (offline && this.connected) {
      this.connected = false;
      this.host.closed(this, 'offline');
    } else if (!offline) {
      this.connect();
    }
  }

  /** Simula la caída del enlace por `ms` milisegundos y la reconexión automática. */
  dropFor(ms: number): void {
    this.setOffline(true);
    setTimeout(() => this.setOffline(false), ms);
  }

  /** Conecta y envía PAIR_REQUEST (también al reconectar, maestro §14.9). */
  connect(): void {
    if (this.offline || !this.qr) return;
    this.connected = true;
    const u = this.host.user();
    this.send('PAIR_REQUEST', {
      pairingToken: this.qr.pairingToken,
      requestedRole: this.role,
      userId: u.id,
      userName: u.name,
      userRoles: u.roles,
      authMode: u.authMode,
      platform: this.host.platform(),
      model: this.role === 'CAMERA_1' ? 'Virtual 1' : 'Virtual 2',
      osVersion: 'sim',
      appVersion: this.qr.controllerAppVersion,
      protocolVersion: 1,
      batteryLevel: this.battery,
      freeSpaceBytes: 24 * 1024 ** 3,
      pendingTransfers: this.pending.length,
    });
  }

  disconnect(): void {
    this.connected = false;
  }

  private send<T extends MessageType>(type: T, payload: PayloadMap[T], messageId?: string): Envelope<T> {
    const env = createEnvelope(type, this.qr?.sessionId ?? '', this.deviceId, payload, messageId);
    if (this.connected && !this.offline) this.host.toServer(this, env as Envelope);
    return env;
  }

  private ack(ref: Envelope): void {
    this.send('ACK', { ackType: 'MESSAGE', refMessageId: ref.messageId, captureId: null, result: 'RECEIVED', reason: null });
  }

  /** Mensaje del controlador hacia esta cámara. */
  receive(env: Envelope): void {
    if (this.offline || !this.connected) return;
    switch (env.type) {
      case 'PAIRED': {
        const p = env.payload as PayloadMap['PAIRED'];
        this.config = p.config;
        this.ack(env);
        // Al reconectar, reanuda las transferencias pendientes (maestro §8.10).
        setTimeout(() => this.flushPending(), 200);
        break;
      }
      case 'PAIR_REJECTED':
        this.connected = false;
        break;
      case 'SESSION_CONTEXT':
        this.context = env.payload as PayloadMap['SESSION_CONTEXT'];
        this.ack(env);
        break;
      case 'START_PASS':
      case 'END_PASS':
      case 'PAUSE':
      case 'RESUME':
      case 'SESSION_CLOSED':
        if (env.type === 'END_PASS' && this.context) this.context = { ...this.context, passId: null, lateralCode: null };
        this.ack(env);
        break;
      case 'HEARTBEAT':
        this.battery = Math.max(20, this.battery - (Math.random() < 0.02 ? 1 : 0));
        this.send('HEARTBEAT', {
          echoSentAt: env.sentAt,
          role: this.role,
          batteryLevel: this.battery,
          freeSpaceBytes: 24 * 1024 ** 3,
          pendingTransfers: this.pending.length,
          lastSequenceId: this.lastSequenceId,
          appState: 'active',
        });
        break;
      case 'CAPTURE_COMMAND':
        void this.onCapture(env as Envelope<'CAPTURE_COMMAND'>);
        break;
      case 'RESYNC_REQUEST': {
        const caps = this.pending
          .filter((p) => !p.meta.isTest)
          .map((p) => ({
            captureId: p.meta.captureId,
            sequenceId: p.meta.sequenceId,
            qualityStatus: p.meta.qualityStatus,
            localTransferStatus: 'PENDIENTE_LOCAL' as const,
          }));
        this.send('RESYNC_STATE', { lastSequenceIdSeen: this.lastSequenceId, page: 1, totalPages: 1, captures: caps });
        break;
      }
      default:
        break;
    }
  }

  private async onCapture(env: Envelope<'CAPTURE_COMMAND'>): Promise<void> {
    const cmd = env.payload;
    const dup = this.processed.get(env.messageId);
    if (dup) {
      this.host.toServer(this, dup);
      return;
    }
    const error = (code: 'COMMAND_EXPIRED' | 'WRONG_PASS' | 'BUSY' | 'INTERNAL') =>
      this.send('ERROR', { code, detail: null, refMessageId: env.messageId });
    if (this.busy) return void error('BUSY');
    if (nowMs() > new Date(cmd.expiresAt).getTime()) return void error('COMMAND_EXPIRED');
    if (cmd.purpose === 'SECUENCIA' && cmd.passId !== (this.context?.passId ?? null)) return void error('WRONG_PASS');
    if (cmd.purpose === 'PRUEBA_CORTA' && this.context?.passId) return void error('WRONG_PASS');
    if (!this.config) return void error('INTERNAL');
    this.busy = true;
    const started = nowMs();
    try {
      // Modo automático: solo dispara con la cámara quieta.
      if (cmd.mode === 'AUTOMATICO' && cmd.purpose === 'SECUENCIA' && Math.random() < CONFIG.simulator.movementRate) {
        await wait(CONFIG.capture.stability.maxWaitMs);
        const resp = this.send('QUALITY_ERROR', {
          sequenceId: cmd.sequenceId,
          captureId: cmd.captureId,
          capturedAt: null,
          qualityStatus: 'REPETIR_NITIDEZ',
          reasons: ['CAMARA_EN_MOVIMIENTO'],
          metrics: null,
          profileVersion: this.config.qualityProfileVersion,
          fileAvailable: false,
        });
        this.processed.set(env.messageId, resp as Envelope);
        return;
      }
      await wait(CONFIG.simulator.captureDelayMs + Math.random() * 120);
      const kind: SampleKind = this.forceBad
        ? 'OSCURA'
        : Math.random() < CONFIG.simulator.qualityErrorRate
          ? Math.random() < 0.5
            ? 'OSCURA'
            : 'BORROSA'
          : 'UTIL';
      this.forceBad = false;
      const sample = await loadSample(kind);
      const capturedAt = nowIso();
      const dest = new File(ensureDir('simulator', this.role), `${cmd.captureId}.jpg`);
      copyFile(sample.uri, dest);
      const facts = fileFacts(dest.uri);
      const quality = await this.quality(kind, sample);
      this.lastSequenceId = cmd.sequenceId;
      let resp: Envelope;
      if (quality.status === 'UTILIZABLE' || quality.status === 'PENDIENTE_REVISION_TECNICA') {
        resp = this.send('CAPTURE_OK', {
          sequenceId: cmd.sequenceId,
          captureId: cmd.captureId,
          capturedAt,
          width: sample.width,
          height: sample.height,
          sizeBytes: facts.sizeBytes,
          md5: facts.md5,
          qualityStatus: quality.status,
          reasons: quality.reasons,
          metrics: quality.metrics,
          profileVersion: quality.profileVersion,
          captureDurationMs: nowMs() - started,
        }) as Envelope;
      } else {
        resp = this.send('QUALITY_ERROR', {
          sequenceId: cmd.sequenceId,
          captureId: cmd.captureId,
          capturedAt,
          qualityStatus: quality.status,
          reasons: quality.reasons,
          metrics: quality.metrics,
          profileVersion: quality.profileVersion,
          fileAvailable: true,
        }) as Envelope;
      }
      this.processed.set(env.messageId, resp);
      const accepted = resp.type === 'CAPTURE_OK';
      const isTest = cmd.purpose === 'PRUEBA_CORTA';
      if (accepted || isTest || this.config.transferIncludeRejected) {
        const u = this.host.user();
        this.pending.push({
          uri: dest.uri,
          meta: {
            captureId: cmd.captureId,
            sequenceId: cmd.sequenceId,
            sessionId: env.sessionId,
            passId: cmd.passId,
            lateralCode: cmd.lateralCode,
            isTest,
            deviceId: this.deviceId,
            cameraRole: this.role,
            userId: u.id,
            capturedAt,
            width: sample.width,
            height: sample.height,
            sizeBytes: facts.sizeBytes,
            md5: facts.md5,
            qualityStatus: quality.status,
            qualityReasons: quality.reasons,
            qualityMetrics: quality.metrics,
            profileVersion: quality.profileVersion,
            replacesCaptureId: cmd.replacesCaptureId,
          },
        });
        setTimeout(() => this.flushPending(), CONFIG.simulator.transferDelayMs);
      }
    } catch {
      error('INTERNAL');
    } finally {
      this.busy = false;
    }
  }

  private async quality(kind: SampleKind, sample: SampleInfo): Promise<QualityResult> {
    const cfg = this.config as CaptureContextConfig;
    const key = `${kind}|${cfg.qualityProfileVersion}`;
    const cached = qualityCache.get(key);
    if (cached) return cached;
    const result = await evaluatePhoto(
      sample.uri,
      sample.width,
      sample.height,
      pipelineConfigFrom(cfg.quality),
      cfg.qualityProfileVersion,
    );
    if (result.status !== 'PENDIENTE_REVISION_TECNICA') qualityCache.set(key, result);
    return result;
  }

  /** Envía al receptor del controlador las fotos pendientes (una a la vez, prioridad: prueba corta). */
  private flushing = false;
  private async flushPending(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      this.pending.sort((a, b) => Number(b.meta.isTest) - Number(a.meta.isTest));
      while (this.pending.length > 0 && this.connected && !this.offline) {
        const item = this.pending[0];
        const temp = incomingPath(`${item.meta.captureId}-sim`);
        copyFile(item.uri, temp);
        const res = await this.host.deliver(item.meta, temp.uri, this.remoteAddress);
        if (!res) break; // receptor detenido: se reintenta en la próxima conexión
        this.pending.shift();
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Para el resumen de la cámara virtual (tarjetas del controlador). */
  get pendingCount(): number {
    return this.pending.length;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
