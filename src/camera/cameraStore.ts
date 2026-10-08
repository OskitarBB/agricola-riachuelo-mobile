// src/camera/cameraStore.ts — Estado EN VIVO de un celular CÁMARA para PANT-30/31 (Zustand).
//
// QUÉ HACE: cameraAgent publica aquí el estado del enlace con el controlador, el contexto de la pasada
// (lateral, marcador), la pausa, la última captura y los pendientes. PANT-31 lo muestra en la franja de
// estado grande (legible a 1 m, RF-29).

import { create } from 'zustand';

import type { CameraRole, LateralCode, QualityStatus } from '../domain/types';
import type { PairRejectReason } from '../protocol/messages';

export type AgentLink = 'SIN_CONTEXTO' | 'CONECTANDO' | 'CONECTADO' | 'DESCONECTADO' | 'RECHAZADO';

export interface CameraLiveState {
  link: AgentLink;
  paired: boolean;
  role: CameraRole | null;
  sessionId: string | null;
  controllerHost: string | null;
  rejectReason: PairRejectReason | null;
  passId: string | null;
  lateral: LateralCode | null;
  markerId: string | null;
  mode: 'MANUAL' | 'AUTOMATICO' | null;
  paused: boolean;
  capturing: boolean;
  lastCapture: { quality: QualityStatus; at: string; durationMs: number | null } | null;
  pendingTransfers: number;
  errorTransfers: number;
  otherControllerPhotos: boolean;
  battery: number | null;
  freeSpace: number | null;
  flash: number; // contador para animar el destello al capturar
  /** v0.4.5: el controlador cerró la sesión de monitoreo; PANT-31 vuelve a PANT-08 (elegir función). */
  sessionEnded: boolean;
}

export const initialCameraState = (): CameraLiveState => ({
  link: 'SIN_CONTEXTO',
  paired: false,
  role: null,
  sessionId: null,
  controllerHost: null,
  rejectReason: null,
  passId: null,
  lateral: null,
  markerId: null,
  mode: null,
  paused: false,
  capturing: false,
  lastCapture: null,
  pendingTransfers: 0,
  errorTransfers: 0,
  otherControllerPhotos: false,
  battery: null,
  freeSpace: null,
  flash: 0,
  sessionEnded: false,
});

export const useCameraLive = create<CameraLiveState>(() => initialCameraState());
