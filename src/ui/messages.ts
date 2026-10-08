// src/ui/messages.ts — Mensajes al usuario por código (español, Perú). Un código = un texto (maestro §19).
//
// REGLAS: nunca mostrar el texto de una excepción; el detalle técnico va a event_log; los mensajes no
// culpan al usuario y dicen qué hacer. Contexto §25.4/25.5: SIN textos de desarrollo ni de capacitación;
// una función no implementada muestra solo "Pendiente".

import type { ApiErrorCode } from '../api/dto';
import type { OfflineDenyReason } from '../auth/offlineAuth';
import type { PairRejectReason } from '../protocol/messages';

export type AppErrorCode =
  | 'SIN_INTERNET'
  | 'BACKEND_NO_DISPONIBLE'
  | 'PERMISO_CAMARA'
  | 'PERMISO_UBICACION'
  | 'PERMISO_RED_LOCAL'
  | 'GPS_NO_DISPONIBLE'
  | 'GPS_IMPRECISO'
  | 'CATALOGOS_FALTANTES'
  | 'CATALOGOS_VACIOS'
  | 'HILERA_SIN_MARCADORES'
  | 'CATALOGOS_ANTIGUOS'
  | 'BATERIA_BAJA'
  | 'ESPACIO_BAJO'
  | 'ESPACIO_CRITICO'
  | 'CAMARAS_NO_LISTAS'
  | 'PRUEBA_CORTA_PENDIENTE'
  | 'CAMARA_DESCONECTADA'
  | 'ORDEN_VENCIDA'
  | 'CAMBIO_FUNCION_BLOQUEADO'
  | 'PENDIENTES_DE_TRANSFERENCIA'
  | 'CIERRE_CON_PENDIENTES'
  | 'FOTOS_DE_OTRO_CONTROLADOR'
  | 'LIBERAR_CAMARA_NO_PERMITIDO'
  | 'PRUEBA_CORTA_FALLIDA'
  | 'PRUEBA_CORTA_CALIDAD'
  | 'PAUSA_SEGUNDO_PLANO'
  | 'REAUTENTICACION_REQUERIDA'
  | 'QR_INVALIDO'
  | 'VERSION_DISTINTA'
  | 'ERROR_INESPERADO'
  // Códigos agregados para validaciones de interfaz (Supuesto S-04, mismos criterios de redacción):
  | 'CONTEXTO_INCOMPLETO'
  | 'LATERAL_A_PENDIENTE'
  | 'PASADA_ABIERTA'
  | 'ORDEN_EN_CURSO'
  | 'PAUSA_REQUERIDA'
  | 'RESYNC_EN_CURSO'
  | 'INCIDENCIA_REQUERIDA'
  | 'INTERVALO_REQUERIDO'
  | 'INTERVALO_FUERA_DE_RANGO'
  | 'PASADA_NO_ABIERTA'
  | 'CAMARA_EN_MOVIMIENTO'
  | 'CAMARA_RECONECTADA'
  | 'PRUEBA_APROBADA'
  | 'PASADA_INICIADA'
  | 'PASADA_CERRADA'
  | 'SESION_CERRADA'
  | 'MARCADOR_CAMBIADO'
  | 'REPETICION_EN_COLA'
  | 'CATALOGOS_ACTUALIZADOS'
  | 'PENDIENTE'
  // Elección de función después del login (ADR 0005):
  | 'CAMBIO_FUNCION_SESION_ABIERTA'
  | 'CAMBIO_FUNCION_FOTOS_PENDIENTES'
  | 'SINCRONIZACION_PENDIENTE'
  // v2.0 (maestro §19): subida directa a Cloudinary
  | 'FOTO_DEMASIADO_GRANDE'
  | 'SUBIDA_NUBE_FALLIDA'
  | 'REINTENTOS_DE_SUBIDA_AGOTADOS'
  // Fase 4 (Supuesto S-04, mismos criterios de redacción): resultado de una ronda de sincronización
  | 'SINCRONIZADO'
  | 'NADA_PENDIENTE'
  | 'SINCRONIZACION_PARCIAL'
  | 'SINCRONIZACION_CON_ERRORES'
  | 'SINCRONIZACION_EN_CURSO'
  | 'SINCRONIZACION_DETENIDA'
  | 'CAMBIO_FUNCION_ERRORES_SINCRONIZACION'
  | 'CAMBIO_FUNCION_SINCRONIZACION_PENDIENTE'
  | 'ACCESO_DENEGADO'
  | 'RESPUESTA_NO_JSON'
  // Fase 4: motivo visible en PANT-20 de un elemento con error
  | 'DATOS_LOCALES_FALTANTES'
  | 'METADATOS_INCOMPLETOS'
  | 'CALIDAD_SIN_EVALUAR'
  | 'ARCHIVO_NO_DISPONIBLE'
  | 'CAPTURA_NO_ENCONTRADA'
  | 'CAPTURA_SIN_PASADA'
  | 'SESION_CON_ERROR'
  | 'PASADA_CON_ERROR'
  | 'SECUENCIAS_CON_ERROR'
  | 'PADRE_NO_SINCRONIZADO'
  | 'TICKET_INVALIDO'
  | 'RECHAZO_NUBE'
  | 'RED'
  // Fase 4: cuenta y contraseña con la plataforma Django
  | 'CONTRASENA_ACTUAL_INCORRECTA'
  | 'CONEXION_OK';

export const API_ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: 'Revisa los datos marcados e inténtalo de nuevo.',
  EMAIL_ALREADY_REGISTERED: 'Ese correo ya tiene una cuenta. Inicia sesión o solicita restablecer tu contraseña.',
  INVALID_CREDENTIALS: 'Correo o contraseña incorrectos.',
  ACCOUNT_PENDING: 'Tu cuenta está pendiente de aprobación por el administrador.',
  ACCOUNT_REJECTED: 'Tu solicitud de cuenta fue rechazada. Comunícate con el administrador.',
  ACCOUNT_BLOCKED: 'Tu cuenta está bloqueada. Comunícate con el administrador.',
  ROLE_NOT_ALLOWED: 'Tu usuario no tiene permiso para usar la app móvil.',
  DEVICE_REVOKED: 'Este celular fue desactivado por el administrador.',
  PASSWORD_POLICY: 'La contraseña no cumple los requisitos.',
  TOO_MANY_ATTEMPTS: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  TOKEN_EXPIRED: 'Tu sesión venció. Vuelve a iniciar sesión.',
  REFRESH_INVALID: 'Tu sesión ya no es válida. Vuelve a iniciar sesión con internet.',
  SESSION_NOT_FOUND: 'El servidor aún no tiene la sesión; se enviará primero.',
  PASS_NOT_FOUND: 'El servidor aún no tiene la pasada; se enviará primero.',
  SEQUENCE_NOT_FOUND: 'El servidor aún no tiene la secuencia; se enviará primero.',
  CAPTURE_CONFLICT: 'El servidor ya tiene una foto con ese identificador pero con otro contenido. Requiere revisión.',
  PAYLOAD_TOO_LARGE: 'La foto supera el tamaño permitido por el servidor.',
  UPLOAD_SIGNATURE_INVALID: 'El servidor no pudo validar la foto subida. Se volverá a subir.',
  UPLOAD_NOT_FOUND: 'El servidor no encontró la foto en la nube. Se volverá a subir.',
  UPLOAD_MISMATCH: 'La foto en la nube no coincide con la del celular. Requiere revisión.',
  NOT_FOUND: 'El servidor no tiene ese registro.',
  INTERNAL_ERROR: 'El servidor tuvo un problema. Se volverá a intentar.',
};

export const OFFLINE_LOGIN_MESSAGES: Record<OfflineDenyReason, string> = {
  SIN_VERIFICADOR: 'Sin internet solo puede entrar quien ya inició sesión con internet en este celular.',
  OTRO_USUARIO: 'Sin internet solo puede entrar el último usuario que inició sesión con internet en este celular.',
  VENCIDO: 'Pasaron demasiados días sin conectarte. Inicia sesión con internet.',
  BLOQUEADO_TEMPORAL: 'Demasiados intentos fallidos. Espera unos minutos.',
  CUENTA_NO_ACTIVA: 'Tu cuenta no está activa.',
  ROL_NO_PERMITIDO: 'Tu usuario no tiene permiso para usar la app móvil.',
  CAMBIO_CONTRASENA_PENDIENTE: 'Debes cambiar tu contraseña con internet antes de entrar sin conexión.',
};

export const PAIR_REJECT_MESSAGES: Record<PairRejectReason, string> = {
  INVALID_TOKEN: 'El código QR no es válido o ya fue reemplazado. Escanea el QR actual del controlador.',
  SESSION_CLOSED: 'La sesión del controlador ya está cerrada.',
  ROLE_TAKEN: 'Esa función de cámara ya está ocupada por otro celular.',
  PROTOCOL_MISMATCH: 'La versión del protocolo no coincide. Actualiza la app en ambos celulares.',
  APP_VERSION_MISMATCH: 'La versión de la app no coincide con la del controlador.',
  USER_NOT_ALLOWED: 'El usuario de este celular no puede unirse a la sesión.',
};

export const APP_ERROR_MESSAGES: Record<AppErrorCode, string> = {
  SIN_INTERNET: 'No hay internet. Esta acción necesita conexión.',
  BACKEND_NO_DISPONIBLE: 'No se pudo contactar al servidor. Se reintentará más tarde.',
  PERMISO_CAMARA: 'Activa el permiso de cámara en Ajustes para continuar.',
  PERMISO_UBICACION: 'Activa el permiso de ubicación en Ajustes para registrar el GPS.',
  PERMISO_RED_LOCAL: 'Activa "Red local" para esta app en Ajustes del iPhone.',
  GPS_NO_DISPONIBLE: 'Sin señal GPS: las secuencias se guardarán sin coordenadas.',
  GPS_IMPRECISO: 'Precisión GPS baja: se usará lote, hilera y marcador para ubicar.',
  CATALOGOS_FALTANTES: 'Descarga los catálogos con internet antes de crear una sesión.',
  CATALOGOS_VACIOS:
    'El servidor todavía no tiene lotes con hileras activas. Pide que los carguen en la web (Gestión) y vuelve a tocar «Actualizar».',
  HILERA_SIN_MARCADORES: 'Esta hilera no tiene marcadores. Agrégalos en la web (Gestión → Marcadores) y actualiza los catálogos.',
  CATALOGOS_ANTIGUOS: 'Los catálogos tienen varios días. Actualízalos si tienes internet.',
  BATERIA_BAJA: 'Batería baja (menos de 15 %): conecta el power bank.',
  ESPACIO_BAJO: 'Queda poco espacio libre. Sincroniza y libera espacio al volver.',
  ESPACIO_CRITICO: 'Espacio insuficiente: la pasada se pausó.',
  CAMARAS_NO_LISTAS: 'Las dos cámaras deben estar conectadas para iniciar la pasada.',
  PRUEBA_CORTA_PENDIENTE: 'Haz la prueba corta antes de iniciar la primera pasada.',
  CAMARA_DESCONECTADA: 'Se perdió la conexión con una cámara. La pasada se pausó.',
  ORDEN_VENCIDA: 'La orden llegó tarde y se descartó.',
  CAMBIO_FUNCION_BLOQUEADO: 'No puedes cambiar la función con una sesión abierta o con pendientes en este celular.',
  PENDIENTES_DE_TRANSFERENCIA: 'Hay fotos pendientes de enviar al controlador.',
  CIERRE_CON_PENDIENTES:
    'Aún faltan fotos por llegar al controlador. Puedes esperar o cerrar igual: llegarán en el próximo emparejamiento.',
  FOTOS_DE_OTRO_CONTROLADOR: 'Hay fotos de otra sesión: se enviarán cuando este celular se vincule con su controlador.',
  LIBERAR_CAMARA_NO_PERMITIDO: 'Solo puedes liberar una cámara desconectada y sin una pasada abierta.',
  PRUEBA_CORTA_FALLIDA: 'La prueba corta falló en una cámara. Revisa la conexión y repítela.',
  PRUEBA_CORTA_CALIDAD: 'La comunicación funciona, pero la foto de prueba salió con mala calidad. Revisa la posición y la luz.',
  PAUSA_SEGUNDO_PLANO: 'Un celular salió de la app: la pasada se pausó. Vuelve a la app para continuar.',
  REAUTENTICACION_REQUERIDA: 'Hay internet. Ingresa tu contraseña para validar tu acceso y poder sincronizar.',
  QR_INVALIDO: 'Este código QR no es de la app de monitoreo.',
  VERSION_DISTINTA: 'Las versiones de la app no coinciden entre los celulares.',
  ERROR_INESPERADO: 'Ocurrió un error inesperado. Quedó registrado en el diagnóstico.',
  CONTEXTO_INCOMPLETO: 'Elige lote, hilera, lateral y marcador.',
  LATERAL_A_PENDIENTE: 'Primero cierra el LATERAL A de esta hilera.',
  PASADA_ABIERTA: 'Ya hay una pasada abierta. Ciérrala primero.',
  ORDEN_EN_CURSO: 'Espera la respuesta de las cámaras.',
  PAUSA_REQUERIDA: 'Pausa la captura automática para cambiar el marcador.',
  RESYNC_EN_CURSO: 'Conciliando con las cámaras. Espera un momento.',
  INCIDENCIA_REQUERIDA: 'Escribe el motivo de la incidencia.',
  INTERVALO_REQUERIDO: 'Elige el intervalo de captura.',
  INTERVALO_FUERA_DE_RANGO: 'El intervalo está fuera de los límites permitidos.',
  PASADA_NO_ABIERTA: 'No hay una pasada abierta.',
  CAMARA_EN_MOVIMIENTO: 'La cámara no estaba quieta. Mantén el soporte estable.',
  CAMARA_RECONECTADA: 'Cámara reconectada.',
  PRUEBA_APROBADA: 'Prueba corta aprobada.',
  PASADA_INICIADA: 'Pasada iniciada.',
  PASADA_CERRADA: 'Pasada cerrada.',
  SESION_CERRADA: 'Sesión de monitoreo cerrada.',
  MARCADOR_CAMBIADO: 'Marcador actualizado.',
  REPETICION_EN_COLA: 'La repetición sale en la siguiente captura.',
  CATALOGOS_ACTUALIZADOS: 'Catálogos actualizados.',
  CAMBIO_FUNCION_SESION_ABIERTA: 'Hay una sesión de monitoreo abierta en este celular. Ciérrala antes de cambiar la función.',
  CAMBIO_FUNCION_FOTOS_PENDIENTES:
    'Hay fotos pendientes de enviar al controlador. Espera a que se envíen antes de cambiar la función.',
  SINCRONIZACION_PENDIENTE: 'Este celular tiene datos del controlador sin sincronizar. No se borran: quedan guardados aquí.',
  PENDIENTE: 'Pendiente',
  FOTO_DEMASIADO_GRANDE:
    'La foto supera el tamaño que acepta la nube. Avisa al responsable: se resuelve con la configuración, no repitiendo la foto.',
  SUBIDA_NUBE_FALLIDA: 'No se pudo subir una foto a la nube. Se reintentará.',
  REINTENTOS_DE_SUBIDA_AGOTADOS: 'Una foto no se pudo validar después de varios intentos. Requiere revisión.',
  SINCRONIZADO: 'Todo quedó sincronizado con el servidor.',
  NADA_PENDIENTE: 'No hay nada pendiente por sincronizar.',
  SINCRONIZACION_PARCIAL: 'Quedan datos por enviar. Se volverá a intentar.',
  SINCRONIZACION_CON_ERRORES: 'Algunos datos no se pudieron enviar y requieren revisión.',
  SINCRONIZACION_EN_CURSO: 'La sincronización ya está en curso.',
  SINCRONIZACION_DETENIDA: 'Sincronización detenida. Lo pendiente sigue guardado en el celular.',
  CAMBIO_FUNCION_SINCRONIZACION_PENDIENTE:
    'Este celular tiene datos del controlador sin sincronizar. Sincronízalos con internet antes de cambiar la función.',
  CAMBIO_FUNCION_ERRORES_SINCRONIZACION:
    'Hay datos que no se pudieron sincronizar. No se borran: quedan guardados en este celular para revisarlos.',
  ACCESO_DENEGADO: 'El servidor rechazó el acceso. Inténtalo más tarde o avisa al administrador.',
  RESPUESTA_NO_JSON: 'La red no deja llegar al servidor (¿Wi-Fi con página de acceso?). Se volverá a intentar.',
  DATOS_LOCALES_FALTANTES: 'Faltan datos de este registro en el celular. Requiere revisión.',
  METADATOS_INCOMPLETOS: 'A la foto le faltan datos (tamaño o huella). Requiere revisión.',
  CALIDAD_SIN_EVALUAR: 'La foto no tiene evaluación de calidad. Requiere revisión.',
  ARCHIVO_NO_DISPONIBLE: 'El archivo de la foto ya no está en este celular.',
  CAPTURA_NO_ENCONTRADA: 'La foto no está registrada en este celular.',
  CAPTURA_SIN_PASADA: 'La foto no tiene una pasada asociada. Requiere revisión.',
  SESION_CON_ERROR: 'No se envió porque la sesión tiene un error.',
  PASADA_CON_ERROR: 'No se envió porque su pasada tiene un error.',
  SECUENCIAS_CON_ERROR: 'No se envió porque las secuencias de su pasada tienen un error.',
  PADRE_NO_SINCRONIZADO: 'El servidor no reconoce la sesión, pasada o secuencia de este dato. Requiere revisión.',
  TICKET_INVALIDO: 'El servidor respondió un permiso de subida inválido. Requiere revisión.',
  RECHAZO_NUBE: 'La nube rechazó la foto. Requiere revisión.',
  RED: 'Se cortó la conexión durante el envío. Se volverá a intentar.',
  CONTRASENA_ACTUAL_INCORRECTA: 'La contraseña actual no es correcta.',
  CONEXION_OK: 'El servidor responde correctamente.',
};

/** Códigos de classifyCloudinaryError (src/sync/retry.ts) que solo piden reintentar más tarde. */
const CLOUD_RETRY_CODES = [
  'TICKET_VENCIDO',
  'FIRMA_RECHAZADA',
  'LIMITE_DE_TASA',
  'CLOUDINARY_NO_DISPONIBLE',
  'RESPUESTA_INVALIDA',
  'TICKETS_AGOTADOS',
];

/**
 * Texto del motivo de un elemento de la cola en PANT-20: códigos del servidor (ApiErrorCode), de la subida a
 * Cloudinary, del controlador (DATOS_LOCALES_FALTANTES…) o HTTP_nnn cuando el servidor no mandó código.
 */
export function syncCodeMessage(code: string | null): string {
  if (!code) return APP_ERROR_MESSAGES.ERROR_INESPERADO;
  if (CLOUD_RETRY_CODES.includes(code)) return APP_ERROR_MESSAGES.SUBIDA_NUBE_FALLIDA;
  if (code === 'PUBLIC_ID_DISTINTO' || code === 'RECHAZO_CLOUDINARY') return APP_ERROR_MESSAGES.RECHAZO_NUBE;
  if (code === 'VALIDATION_ERROR') return 'El servidor rechazó los datos de este envío. Requiere revisión (exporta el diagnóstico).';
  const http = /^HTTP_(\d+)$/.exec(code);
  if (http) return `El servidor respondió con un error (${http[1]}). Requiere revisión.`;
  return messageFor(code);
}

/** Texto para cualquier código conocido; si no se reconoce, mensaje genérico. */
export function messageFor(code: string): string {
  if (code in APP_ERROR_MESSAGES) return APP_ERROR_MESSAGES[code as AppErrorCode];
  if (code in API_ERROR_MESSAGES) return API_ERROR_MESSAGES[code as ApiErrorCode];
  if (code in OFFLINE_LOGIN_MESSAGES) return OFFLINE_LOGIN_MESSAGES[code as OfflineDenyReason];
  if (code in PAIR_REJECT_MESSAGES) return PAIR_REJECT_MESSAGES[code as PairRejectReason];
  return APP_ERROR_MESSAGES.ERROR_INESPERADO;
}
