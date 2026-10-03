// src/controller/controllerStore.ts — Estado EN VIVO del controlador para las pantallas (Zustand).
//
// QUÉ HACE: el runtime del controlador (controllerRuntime.ts) publica aquí lo que las pantallas muestran:
// sesión y pasada vigentes, tarjetas de cada cámara (enlace, batería, espacio, pendientes, desfase),
// última secuencia, contadores, GPS, avisos, estado de la prueba corta y el QR. Las pantallas SOLO leen
// este store y llaman acciones del runtime (nunca tocan SQLite ni la red: regla R-05).

import { create } from 'zustand';

import type {
  CameraLinkStatus,
  CameraRole,
  CaptureSequence,
  GpsFix,
  MonitoringPass,
  MonitoringSession,
  Platform,
  QualityStatus,
  SlotOutcome,
} from '../domain/types';
import type { PairingQrPayload } from '../protocol/messages';

export interface CameraCard {
  role: CameraRole;
  deviceId: string | null;
  link: CameraLinkStatus;
  userName: string | null;
  model: string | null;
  platform: Platform | null;
  appVersion: string | null;
  batteryLevel: number | null;
  freeSpaceBytes: number | null;
  pendingTransfers: number;
  clockOffsetMs: number | null;
  lastOutcome: SlotOutcome | null;
  lastQuality: QualityStatus | null;
}

export type ShortTestCamState = 'SIN_EJECUTAR' | 'EN_CURSO' | 'APROBADA' | 'APROBADA_CALIDAD' | 'REPROBADA';

export interface ShortTestCamResult {
  state: ShortTestCamState;
  response: 'CAPTURE_OK' | 'QUALITY_ERROR' | 'ERROR' | 'SIN_RESPUESTA' | null;
  quality: QualityStatus | null;
  metrics: { luminanceMean: number; laplacianVariance: number } | null;
  transferred: boolean;
  responseMs: number | null;
  totalMs: number | null;
  capturedAt: string | null;
  detail: string | null;
}

export interface PassCountersView {
  total: number;
  complete: number;
  partial: number;
  incomplete: number;
}

export type AutoState = 'OFF' | 'ACTIVE' | 'PAUSED';

export interface ControllerLiveState {
  session: MonitoringSession | null;
  pass: MonitoringPass | null;
  cameras: Record<CameraRole, CameraCard>;
  lastSequence: CaptureSequence | null;
  counters: PassCountersView;
  orderInFlight: boolean;
  autoState: AutoState;
  gps: { fix: GpsFix; ageMs: number } | null;
  /** Códigos de aviso vigentes (src/ui/messages.ts). */
  alerts: string[];
  qr: { payload: PairingQrPayload; text: string } | null;
  networkKind: 'SIMULADOR' | 'RED_REAL';
  serverError: string | null;
  resyncing: boolean;
  shortTest: Record<CameraRole, ShortTestCamResult> & { running: boolean; passed: boolean; offsetMs: number | null };
  /** Repeticiones disponibles (8.5): por cámara, la secuencia más reciente con resultado repetible. */
  retakes: { role: CameraRole; sequenceNumber: number; sequenceId: string }[];
  /** Mensaje efímero para la interfaz (toast), con id para no repetirlo. */
  notice: { id: number; code: string; kind: 'info' | 'warn' | 'error' | 'success' } | null;
  ownBattery: number | null;
  ownFreeSpace: number | null;
}

export function emptyCard(role: CameraRole): CameraCard {
  return {
    role,
    deviceId: null,
    link: 'DESCONECTADA',
    userName: null,
    model: null,
    platform: null,
    appVersion: null,
    batteryLevel: null,
    freeSpaceBytes: null,
    pendingTransfers: 0,
    clockOffsetMs: null,
    lastOutcome: null,
    lastQuality: null,
  };
}

export function emptyShortTest(): ControllerLiveState['shortTest'] {
  const cam = (): ShortTestCamResult => ({
    state: 'SIN_EJECUTAR',
    response: null,
    quality: null,
    metrics: null,
    transferred: false,
    responseMs: null,
    totalMs: null,
    capturedAt: null,
    detail: null,
  });
  return { CAMERA_1: cam(), CAMERA_2: cam(), running: false, passed: false, offsetMs: null };
}

export const initialControllerState = (): ControllerLiveState => ({
  session: null,
  pass: null,
  cameras: { CAMERA_1: emptyCard('CAMERA_1'), CAMERA_2: emptyCard('CAMERA_2') },
  lastSequence: null,
  counters: { total: 0, complete: 0, partial: 0, incomplete: 0 },
  orderInFlight: false,
  autoState: 'OFF',
  gps: null,
  alerts: [],
  qr: null,
  networkKind: 'SIMULADOR',
  serverError: null,
  resyncing: false,
  shortTest: emptyShortTest(),
  retakes: [],
  notice: null,
  ownBattery: null,
  ownFreeSpace: null,
});

export const useController = create<ControllerLiveState>(() => initialControllerState());

let noticeId = 0;
export function pushNotice(code: string, kind: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
  noticeId += 1;
  useController.setState({ notice: { id: noticeId, code, kind } });
}

export function patchCamera(role: CameraRole, patch: Partial<CameraCard>): void {
  const s = useController.getState();
  useController.setState({ cameras: { ...s.cameras, [role]: { ...s.cameras[role], ...patch } } });
}
