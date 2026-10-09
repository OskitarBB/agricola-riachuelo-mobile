// src/controller/pairingService.ts — Emparejamiento por QR en el CONTROLADOR (maestro §14.2 y §14.6).
//
// QUÉ HACE:
//  - newPairingToken(): 16 bytes aleatorios en base64url; en SQLite solo se guarda su SHA-256.
//  - buildQr(): contenido del QR (tipo RIACHUELO_PAIR, IP, puertos, sesión, token, versión).
//  - validatePairRequest(): aplica EN ORDEN las validaciones de 14.6 y devuelve el primer motivo de
//    rechazo (PROTOCOL_MISMATCH, INVALID_TOKEN, SESSION_CLOSED, APP_VERSION_MISMATCH, USER_NOT_ALLOWED,
//    ROLE_TAKEN) o el rol aceptado.
//  - buildPairedConfig(): configuración de captura y calidad que reciben las cámaras (D-21).

import * as Crypto from 'expo-crypto';

import { APP_VERSION, CONFIG, CONFIG_VERSION } from '../config';
import { bytesToBase64Url } from '../domain/ids';
import { FIELD_ROLES, type CameraRole, type MonitoringSession, type SessionDevice } from '../domain/types';
import {
  PROTOCOL_VERSION,
  type CaptureContextConfig,
  type PairingQrPayload,
  type PairRejectReason,
  type PayloadMap,
} from '../protocol/messages';

export function newPairingToken(): string {
  return bytesToBase64Url(Crypto.getRandomBytes(CONFIG.pairing.pairingTokenBytes));
}

export async function hashToken(token: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token, { encoding: Crypto.CryptoEncoding.HEX });
}

/** Comparación en tiempo constante de dos cadenas (hashes). */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function buildQr(host: string, sessionId: string, token: string): PairingQrPayload {
  return {
    type: 'RIACHUELO_PAIR',
    protocolVersion: PROTOCOL_VERSION,
    host,
    controlPort: CONFIG.pairing.controlPort,
    filePort: CONFIG.pairing.filePort,
    sessionId,
    pairingToken: token,
    controllerAppVersion: APP_VERSION,
  };
}

export function buildPairedConfig(): CaptureContextConfig {
  const q = CONFIG.quality;
  return {
    configVersion: CONFIG_VERSION,
    qualityProfileVersion: q.profileVersion,
    jpegQuality: CONFIG.capture.jpegQuality,
    shutterSound: CONFIG.capture.shutterSound,
    quality: { timeoutMs: q.timeoutMs, exposure: { ...q.exposure }, sharpness: { ...q.sharpness } },
    heartbeatIntervalMs: CONFIG.protocol.heartbeatIntervalMs,
    transferIncludeRejected: CONFIG.transfer.includeRejected,
  };
}

export type PairDecision = { ok: true; role: CameraRole; reconnect: boolean } | { ok: false; reason: PairRejectReason };

/**
 * Validaciones de 14.6 en orden. `tokenHashOfRequest` es el SHA-256 del token recibido.
 * `devices`: filas de session_devices de la sesión (incluidas las liberadas).
 */
export function validatePairRequest(
  req: PayloadMap['PAIR_REQUEST'],
  deviceId: string,
  session: MonitoringSession | null,
  tokenHashOfRequest: string,
  devices: SessionDevice[],
): PairDecision {
  if (req.protocolVersion !== PROTOCOL_VERSION) return { ok: false, reason: 'PROTOCOL_MISMATCH' };
  if (!session || !session.pairingTokenHash || !constantTimeEquals(session.pairingTokenHash, tokenHashOfRequest)) {
    return { ok: false, reason: 'INVALID_TOKEN' };
  }
  if (!['PREPARING', 'READY', 'ACTIVE', 'PAUSED', 'CLOSING'].includes(session.status))
    return { ok: false, reason: 'SESSION_CLOSED' };
  if (CONFIG.pairing.requireSameAppVersion && req.appVersion !== APP_VERSION)
    return { ok: false, reason: 'APP_VERSION_MISMATCH' };
  // v0.5.0: el especialista entra a la app solo para «Ubicar plaga»; no puede ser cámara (FIELD_ROLES).
  if (!req.userRoles.some((r) => FIELD_ROLES.includes(r))) return { ok: false, reason: 'USER_NOT_ALLOWED' };
  const active = devices.filter((d) => !d.released);
  const mineSameRole = active.find((d) => d.deviceId === deviceId && d.role === req.requestedRole);
  if (mineSameRole) return { ok: true, role: req.requestedRole, reconnect: true };
  const roleTaken = active.some((d) => d.role === req.requestedRole);
  const myOtherRole = active.some((d) => d.deviceId === deviceId && d.role !== req.requestedRole);
  if (roleTaken || myOtherRole) return { ok: false, reason: 'ROLE_TAKEN' };
  return { ok: true, role: req.requestedRole, reconnect: false };
}
