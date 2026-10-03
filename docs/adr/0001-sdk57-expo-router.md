# ADR 0001 — Expo SDK 57, Expo Router y carpeta `app/` en la raíz

**Estado:** aceptado · **Fecha:** 2026-10-02

## Contexto
El contexto de errores indica usar SDK 57 (no 54) porque Expo Go de las tiendas solo abre la versión vigente.

## Decisión
- Expo SDK 57 (RN 0.86.3, React 19.2.3, TypeScript 6). Módulos Expo instalados con `npx expo install`.
- Expo Router con `Stack.Protected` para separar: sin sesión → `(auth)`; con sesión sin función/permisos →
  `(setup)`; controlador → `controller/*`; cámara → `camera/*`.
- Rutas en `app/` (raíz). El código no-ruta vive en `src/`.
- TypeScript 6: se eliminó `baseUrl` del tsconfig y se declaran `types: ["jest","node"]` (TS 6 ya no
  incluye tipos globales por defecto).
- RN 0.86 eliminó `StyleSheet.absoluteFillObject`: se usan estilos absolutos explícitos.

## Consecuencias
`npm start` usa `expo start --go` porque `expo-dev-client` está instalado (para el APK de desarrollo).
