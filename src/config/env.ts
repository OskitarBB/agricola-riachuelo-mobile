// src/config/env.ts — Lectura ÚNICA de las variables de entorno públicas (EXPO_PUBLIC_*).
//
// QUÉ HACE: Expo reemplaza `process.env.EXPO_PUBLIC_*` al compilar el bundle. Por eso se escriben
// con el nombre completo (no se pueden leer de forma dinámica). Ningún otro archivo debe leer process.env.
//
// Backend real (Fase 4, maestro v2.0 §5.6): la plataforma Django `/api/v1`.
//  - Piloto:     EXPO_PUBLIC_API_URL=https://monitoreo.agricolariachuelo.org  EXPO_PUBLIC_USE_MOCK_API=0
//                EXPO_PUBLIC_APP_ENV=piloto   (perfil "piloto" de eas.json)
//  - Laptop:     EXPO_PUBLIC_API_URL=http://<IP-de-la-laptop>:8000           EXPO_PUBLIC_USE_MOCK_API=0
//  - Simulado:   EXPO_PUBLIC_USE_MOCK_API=1 (o sin EXPO_PUBLIC_API_URL)
// La app NO tiene variables de Cloudinary ni de Supabase: la URL de subida y la firma llegan en cada ticket.
// Las variables EXPO_PUBLIC_* quedan dentro del APK: no son secretas (R-10).

export type AppEnv = 'dev' | 'piloto';

const rawApiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');

export const ENV = {
  /** URL base de la plataforma Django SIN /api/v1, p. ej. https://monitoreo.agricolariachuelo.org */
  apiUrl: rawApiUrl,
  /** true = usa el backend simulado de src/api/mock. Si no hay URL, siempre se usa el simulado. */
  useMockApi: process.env.EXPO_PUBLIC_USE_MOCK_API !== '0' || rawApiUrl === '',
  appEnv: (process.env.EXPO_PUBLIC_APP_ENV === 'piloto' ? 'piloto' : 'dev') as AppEnv,
} as const;

/** Servidor que se muestra en Ajustes y en el diagnóstico (sin credenciales ni rutas). */
export function apiHostLabel(): string {
  if (ENV.useMockApi) return 'Simulado';
  const m = /^(https?:\/\/)?([^/]+)/i.exec(ENV.apiUrl);
  return m ? m[2] : ENV.apiUrl;
}

/** HTTPS obligatorio fuera de la red local (maestro §15.1). En el piloto se avisa si la URL es http://. */
export function isSecureApiUrl(url: string = ENV.apiUrl): boolean {
  return /^https:\/\//i.test(url);
}
