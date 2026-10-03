// src/api/httpClient.ts — Cliente HTTP hacia Spring Boot /api/v1 (maestro §15.1).
//
// QUÉ HACE:
//  - Arma la URL `${EXPO_PUBLIC_API_URL}/api/v1${path}`, agrega cabeceras (X-Device-Id y, si aplica,
//    Authorization: Bearer) y aplica tiempo de espera con AbortController.
//  - Convierte cualquier fallo en ApiError: kind 'NETWORK' (sin red / tiempo agotado / sin respuesta)
//    o 'HTTP' con status y ApiErrorCode del cuerpo ApiErrorBody.
// El texto de las excepciones NUNCA se muestra al usuario: las pantallas usan messageFor(code).
//
// INTEGRACIÓN FUTURA (backend real): este cliente ya está listo; se activa con EXPO_PUBLIC_USE_MOCK_API=0.
// Pendiente acordar con el backend: CORS no aplica (app nativa); HTTPS en entornos remotos.

import { ENV } from '../config';
import type { ApiErrorBody, ApiErrorCode } from './dto';

export class ApiError extends Error {
  constructor(
    public readonly kind: 'NETWORK' | 'HTTP',
    public readonly status: number | undefined,
    public readonly code: ApiErrorCode | undefined,
    public readonly fieldErrors: { field: string; message: string }[] = [],
  ) {
    super(kind === 'NETWORK' ? 'Sin respuesta del servidor' : `HTTP ${status ?? '?'} ${code ?? ''}`);
    this.name = 'ApiError';
  }

  get isNetwork(): boolean {
    return this.kind === 'NETWORK';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string | null;
  deviceId?: string | null;
  timeoutMs?: number;
}

export function apiBaseUrl(): string {
  return `${ENV.apiUrl}/api/v1`;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.deviceId) headers['X-Device-Id'] = opts.deviceId;
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError('NETWORK', undefined, undefined);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const body = (json ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      'HTTP',
      res.status,
      body.code ?? (res.status >= 500 ? 'INTERNAL_ERROR' : undefined),
      body.fieldErrors ?? [],
    );
  }
  return json as T;
}
