// src/api/httpClient.ts — Único cliente HTTP hacia la plataforma Django /api/v1 (maestro v2.0 §6.1 y §15.1).
//
// QUÉ HACE:
//  - Arma la URL `${EXPO_PUBLIC_API_URL}/api/v1${path}`, agrega cabeceras (X-Device-Id siempre y, si aplica,
//    Authorization: Bearer) y aplica tiempo de espera con AbortController.
//  - apiRequest(): devuelve el JSON o lanza ApiError — kind 'NETWORK' (sin red, tiempo agotado, sin respuesta) o
//    'HTTP' con status, ApiErrorCode, fieldErrors y traceId del cuerpo ApiErrorBody de Django.
//  - apiCall(): igual, pero NUNCA lanza: devuelve ApiCallResult (lo usa la sincronización, §15.5).
// El texto de las excepciones NUNCA se muestra al usuario: las pantallas usan messageFor(code). El traceId es el
// mismo que imprime la consola del servidor (docs/INTEGRACION_APP.md §2): se guarda en event_log para soporte.
// Ningún otro archivo arma URLs de /api/v1 (regla de capas §6.1). Cloudinary lo maneja solo cloudinaryUpload.ts.

import { ENV } from '../config';
import type { ApiErrorBody, ApiErrorCode } from './dto';

export class ApiError extends Error {
  constructor(
    public readonly kind: 'NETWORK' | 'HTTP',
    public readonly status: number | undefined,
    public readonly code: ApiErrorCode | undefined,
    public readonly fieldErrors: { field: string; message: string }[] = [],
    public readonly traceId: string | null = null,
    public readonly serverMessage: string | null = null,
  ) {
    super(kind === 'NETWORK' ? 'Sin respuesta del servidor' : `HTTP ${status ?? '?'} ${code ?? ''}`);
    this.name = 'ApiError';
  }

  get isNetwork(): boolean {
    return this.kind === 'NETWORK';
  }
}

/** Resultado de una llamada a la API sin excepciones (forma compatible con src/sync/captureUploader.ts). */
export type ApiCallResult<T> =
  | { ok: true; status: number; data: T }
  | {
      ok: false;
      networkError: boolean;
      status?: number;
      code?: ApiErrorCode;
      message?: string | null;
      traceId?: string | null;
      fieldErrors?: { field: string; message: string }[];
    };

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string | null;
  deviceId?: string | null;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export function apiBaseUrl(): string {
  return `${ENV.apiUrl}/api/v1`;
}

/** Cabeceras comunes de la API del proyecto (nunca se envían a Cloudinary: §15.5 paso 4). */
export function apiHeaders(opts: { accessToken?: string | null; deviceId?: string | null; json?: boolean }): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.json) headers['Content-Type'] = 'application/json';
  if (opts.deviceId) headers['X-Device-Id'] = opts.deviceId;
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;
  return headers;
}

const KNOWN_CODES: readonly ApiErrorCode[] = [
  'VALIDATION_ERROR',
  'EMAIL_ALREADY_REGISTERED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_PENDING',
  'ACCOUNT_REJECTED',
  'ACCOUNT_BLOCKED',
  'ROLE_NOT_ALLOWED',
  'DEVICE_REVOKED',
  'PASSWORD_POLICY',
  'TOO_MANY_ATTEMPTS',
  'TOKEN_EXPIRED',
  'REFRESH_INVALID',
  'SESSION_NOT_FOUND',
  'PASS_NOT_FOUND',
  'SEQUENCE_NOT_FOUND',
  'CAPTURE_CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UPLOAD_SIGNATURE_INVALID',
  'UPLOAD_NOT_FOUND',
  'UPLOAD_MISMATCH',
  'NOT_FOUND',
  'INTERNAL_ERROR',
];

/**
 * Convierte la respuesta de error del servidor en ApiError. Si el cuerpo no es ApiErrorBody (p. ej. una página
 * HTML del proxy), el código queda vacío salvo en 5xx (INTERNAL_ERROR: la app reintenta) y 413 (PAYLOAD_TOO_LARGE).
 */
export function errorFromResponse(status: number, bodyText: string): ApiError {
  let body: Partial<ApiErrorBody> = {};
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed && typeof parsed === 'object') body = parsed as Partial<ApiErrorBody>;
  } catch {
    body = {};
  }
  const rawCode = typeof body.code === 'string' ? body.code : undefined;
  let code: ApiErrorCode | undefined = rawCode && (KNOWN_CODES as readonly string[]).includes(rawCode) ? (rawCode as ApiErrorCode) : undefined;
  if (!code && status >= 500) code = 'INTERNAL_ERROR';
  if (!code && status === 413) code = 'PAYLOAD_TOO_LARGE';
  if (!code && status === 429) code = 'TOO_MANY_ATTEMPTS';
  const fieldErrors = Array.isArray(body.fieldErrors)
    ? body.fieldErrors.filter((f) => f && typeof f.field === 'string' && typeof f.message === 'string')
    : [];
  return new ApiError(
    'HTTP',
    status,
    code,
    fieldErrors,
    typeof body.traceId === 'string' ? body.traceId : null,
    typeof body.message === 'string' ? body.message : null,
  );
}

/** Envía la petición y devuelve el estado HTTP y el JSON (o lanza ApiError). */
async function send<T>(path: string, opts: RequestOptions): Promise<{ status: number; data: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers = apiHeaders({ accessToken: opts.accessToken, deviceId: opts.deviceId, json: opts.body !== undefined });
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    // El cuerpo se lee dentro del tiempo de espera: un corte a mitad de la respuesta también es error de red.
    text = res.status === 204 ? '' : await res.text();
  } catch {
    throw new ApiError('NETWORK', undefined, undefined);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw errorFromResponse(res.status, text);
  if (res.status === 204 || text === '') return { status: res.status, data: undefined as T };
  try {
    return { status: res.status, data: JSON.parse(text) as T };
  } catch {
    // 2xx con un cuerpo que no es JSON: no es la API del proyecto (URL mal configurada o proxy intermedio).
    throw new ApiError('HTTP', res.status, undefined, [], null, 'RESPUESTA_NO_JSON');
  }
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await send<T>(path, opts)).data;
}

/** Convierte cualquier excepción en ApiCallResult (sin lanzar). */
export function toCallResult<T>(err: unknown): ApiCallResult<T> {
  if (err instanceof ApiError) {
    if (err.isNetwork) return { ok: false, networkError: true };
    return {
      ok: false,
      networkError: false,
      status: err.status,
      code: err.code,
      message: err.serverMessage,
      traceId: err.traceId,
      fieldErrors: err.fieldErrors,
    };
  }
  return { ok: false, networkError: false, status: 0, code: undefined, message: err instanceof Error ? err.message : null };
}

/** apiRequest sin excepciones: { ok: true, status, data } o el error clasificable (classifySyncError). */
export async function apiCall<T>(path: string, opts: RequestOptions = {}): Promise<ApiCallResult<T>> {
  try {
    const { status, data } = await send<T>(path, opts);
    return { ok: true, status, data };
  } catch (err) {
    return toCallResult<T>(err);
  }
}
