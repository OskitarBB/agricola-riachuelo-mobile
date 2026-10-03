// src/config/env.ts — Lectura ÚNICA de las variables de entorno públicas (EXPO_PUBLIC_*).
//
// QUÉ HACE: Expo reemplaza `process.env.EXPO_PUBLIC_*` al compilar el bundle. Por eso se escriben
// con el nombre completo (no se pueden leer de forma dinámica). Ningún otro archivo debe leer process.env.
//
// INTEGRACIÓN FUTURA (backend real, Fase 4): cuando el backend Spring Boot esté desplegado, fijar
// EXPO_PUBLIC_API_URL=http(s)://<host>:<puerto> y EXPO_PUBLIC_USE_MOCK_API=0 en .env o en eas.json (env).

export type AppEnv = 'dev' | 'piloto';

export const ENV = {
  /** URL base del backend sin /api/v1, p. ej. http://192.168.1.50:8080 */
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, ''),
  /** true = usa el backend simulado de src/api/mock (Fase 1). Si no hay URL, siempre se usa el simulado. */
  useMockApi: process.env.EXPO_PUBLIC_USE_MOCK_API !== '0' || (process.env.EXPO_PUBLIC_API_URL ?? '') === '',
  appEnv: (process.env.EXPO_PUBLIC_APP_ENV === 'piloto' ? 'piloto' : 'dev') as AppEnv,
} as const;
