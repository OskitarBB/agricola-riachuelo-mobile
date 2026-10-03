// src/domain/stateMachines.ts — Transiciones de estado permitidas (contrato v1, maestro §11.2 y §13).
//
// QUÉ HACE: cada mapa dice, para un estado, a qué estados se puede pasar. Los servicios llaman a
// assertTransition() antes de escribir un cambio de estado en SQLite; si no está permitido, lanzan
// InvalidTransitionError (error de programación que queda en event_log).

import type {
  AuthStatus,
  CameraLinkStatus,
  LocalTransferStatus,
  PassStatus,
  QualityStatus,
  RemoteSyncStatus,
  SequenceStatus,
  SessionStatus,
  SlotOutcome,
} from './types';

export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

export const SESSION_TRANSITIONS: TransitionMap<SessionStatus> = {
  DRAFT: ['PREPARING'], // un borrador que se descarta se elimina (no tiene datos dependientes)
  PREPARING: ['READY', 'CLOSING'],
  READY: ['ACTIVE', 'PREPARING', 'CLOSING'],
  ACTIVE: ['PAUSED', 'READY', 'CLOSING'],
  PAUSED: ['ACTIVE', 'READY', 'CLOSING'],
  CLOSING: ['CLOSED'],
  CLOSED: ['SYNCED'],
  // Si llegan datos tardíos de una sesión ya sincronizada (p. ej., una foto pendiente), vuelve a CLOSED.
  SYNCED: ['CLOSED'],
};

export const PASS_TRANSITIONS: TransitionMap<PassStatus> = {
  READY: ['ACTIVE', 'INCOMPLETE'],
  ACTIVE: ['PAUSED', 'COMPLETED', 'INCOMPLETE'],
  PAUSED: ['ACTIVE', 'COMPLETED', 'INCOMPLETE'],
  COMPLETED: [],
  INCOMPLETE: [],
};

/** El estado de la secuencia se deriva de los resultados por cámara (deriveSequenceStatus). */
export const SEQUENCE_TRANSITIONS: TransitionMap<SequenceStatus> = {
  CREATED: ['COMMAND_SENT', 'CANCELLED'],
  COMMAND_SENT: ['PARTIAL', 'COMPLETE', 'INCOMPLETE'],
  PARTIAL: ['COMMAND_SENT', 'COMPLETE', 'INCOMPLETE'],
  // Una repetición o un resultado tardío pueden reabrir o completar una secuencia incompleta (RN-07).
  INCOMPLETE: ['COMMAND_SENT', 'PARTIAL', 'COMPLETE'],
  COMPLETE: [],
  CANCELLED: [],
};

/** Resultado de cada cámara dentro de una secuencia. */
export const SLOT_TRANSITIONS: TransitionMap<SlotOutcome> = {
  PENDIENTE: ['OK_PENDIENTE_ARCHIVO', 'OK_RECIBIDA', 'RECHAZADA_CALIDAD', 'ERROR_CAMARA', 'SIN_RESPUESTA'],
  OK_PENDIENTE_ARCHIVO: ['OK_RECIBIDA'],
  OK_RECIBIDA: [],
  RECHAZADA_CALIDAD: ['PENDIENTE'], // repetición
  ERROR_CAMARA: ['PENDIENTE'], // repetición
  // Resultado tardío (llegó después de vencer la espera) o repetición.
  SIN_RESPUESTA: ['OK_PENDIENTE_ARCHIVO', 'OK_RECIBIDA', 'RECHAZADA_CALIDAD', 'ERROR_CAMARA', 'PENDIENTE'],
};

export const QUALITY_TRANSITIONS: TransitionMap<QualityStatus> = {
  CAPTURED: ['UTILIZABLE', 'REPETIR_NITIDEZ', 'REPETIR_EXPOSICION', 'ERROR_CAMARA', 'PENDIENTE_REVISION_TECNICA'],
  UTILIZABLE: [],
  REPETIR_NITIDEZ: [],
  REPETIR_EXPOSICION: [],
  ERROR_CAMARA: [],
  PENDIENTE_REVISION_TECNICA: [],
};

export const LOCAL_TRANSFER_TRANSITIONS: TransitionMap<LocalTransferStatus> = {
  PENDIENTE_LOCAL: ['TRANSFIRIENDO_LOCAL'],
  TRANSFIRIENDO_LOCAL: ['RECIBIDA_CONTROLADOR', 'PENDIENTE_LOCAL', 'ERROR_LOCAL'],
  RECIBIDA_CONTROLADOR: [],
  ERROR_LOCAL: ['PENDIENTE_LOCAL'],
};

export const REMOTE_SYNC_TRANSITIONS: TransitionMap<RemoteSyncStatus> = {
  PENDIENTE_NUBE: ['SUBIENDO'],
  SUBIENDO: ['SINCRONIZADO', 'PENDIENTE_NUBE', 'ERROR_SINCRONIZACION'],
  // Solo una pasada y sus secuencias reabiertas por una foto tardía (8.13) vuelven a PENDIENTE_NUBE.
  SINCRONIZADO: ['PENDIENTE_NUBE'],
  ERROR_SINCRONIZACION: ['PENDIENTE_NUBE'],
};

export const CAMERA_LINK_TRANSITIONS: TransitionMap<CameraLinkStatus> = {
  DESCONECTADA: ['EMPAREJANDO'],
  EMPAREJANDO: ['CONECTADA', 'DESCONECTADA'],
  CONECTADA: ['INESTABLE', 'PERDIDA', 'DESCONECTADA'],
  INESTABLE: ['CONECTADA', 'PERDIDA', 'DESCONECTADA'],
  PERDIDA: ['EMPAREJANDO', 'DESCONECTADA'],
};

export const AUTH_TRANSITIONS: TransitionMap<AuthStatus> = {
  SIN_SESION: ['AUTENTICADO', 'CAMBIO_CONTRASENA_REQUERIDO'],
  CAMBIO_CONTRASENA_REQUERIDO: ['AUTENTICADO', 'SIN_SESION'],
  AUTENTICADO: ['SIN_SESION'],
};

export function canTransition<S extends string>(map: TransitionMap<S>, from: S, to: S): boolean {
  return map[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly entity: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Transición inválida en ${entity}: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition<S extends string>(entity: string, map: TransitionMap<S>, from: S, to: S): void {
  if (!canTransition(map, from, to)) throw new InvalidTransitionError(entity, from, to);
}
