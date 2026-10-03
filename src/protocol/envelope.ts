// src/protocol/envelope.ts — Creación y lectura de sobres del protocolo local.
//
// QUÉ HACE:
//  - createEnvelope(): arma un mensaje con messageId nuevo, hora del emisor y versión de protocolo.
//  - parseEnvelope(): convierte el texto recibido por WebSocket en un Envelope validado con zod.
//    Devuelve { ok:false, code:'INVALID_MESSAGE' } si el JSON o el esquema no son válidos.

import { newId } from '../domain/ids';
import { nowIso } from '../domain/time';
import type { UUID } from '../domain/types';
import { PROTOCOL_VERSION, type Envelope, type MessageType, type PairingQrPayload, type PayloadMap } from './messages';
import { envelopeSchema, PAYLOAD_SCHEMAS, pairingQrSchema } from './schemas';

export function createEnvelope<T extends MessageType>(
  type: T,
  sessionId: UUID,
  deviceId: UUID,
  payload: PayloadMap[T],
  messageId: UUID = newId(),
): Envelope<T> {
  return { v: PROTOCOL_VERSION, type, messageId, sessionId, deviceId, sentAt: nowIso(), payload };
}

export type ParseResult =
  { ok: true; envelope: Envelope } | { ok: false; code: 'INVALID_MESSAGE'; detail: string; messageId: string | null };

export function parseEnvelope(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: 'INVALID_MESSAGE', detail: 'JSON inválido', messageId: null };
  }
  const env = envelopeSchema.safeParse(raw);
  if (!env.success) {
    const mid = typeof (raw as { messageId?: unknown })?.messageId === 'string' ? (raw as { messageId: string }).messageId : null;
    return { ok: false, code: 'INVALID_MESSAGE', detail: 'Sobre inválido', messageId: mid };
  }
  const schema = PAYLOAD_SCHEMAS[env.data.type];
  const payload = schema.safeParse(env.data.payload);
  if (!payload.success) {
    return { ok: false, code: 'INVALID_MESSAGE', detail: `Payload inválido en ${env.data.type}`, messageId: env.data.messageId };
  }
  return { ok: true, envelope: { ...env.data, payload: payload.data } as Envelope };
}

export function serializeEnvelope(env: Envelope): string {
  return JSON.stringify(env);
}

/** Lee el texto de un QR escaneado. null si no es un QR de la app (mensaje QR_INVALIDO). */
export function parsePairingQr(text: string): PairingQrPayload | null {
  try {
    const parsed = pairingQrSchema.safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data as PairingQrPayload) : null;
  } catch {
    return null;
  }
}

/** Tipado estrecho para manejar un sobre ya validado según su tipo. */
export function isType<T extends MessageType>(env: Envelope, type: T): env is Envelope<T> {
  return env.type === type;
}
