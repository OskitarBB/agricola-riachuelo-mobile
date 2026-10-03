# ADR 0003 — Red local: TCP propio en el APK, simulador en Expo Go

**Estado:** aceptado · **Fecha:** 2026-10-02

## Decisión
- **Controlador (APK / dev build):** `react-native-tcp-socket` 6.4.3 con un servidor WebSocket propio
  (`src/local-network/wsCodec.ts`) y un receptor HTTP de fotos (`httpUpload.ts`), probados en Jest.
  El módulo se carga con `require()` diferido en `factory.ts`; está excluido de `expo install`.
- **Controlador en Expo Go:** `SimulatedControlServer` + dos cámaras virtuales (`simulator/`).
- **Cámara:** `WebSocket` estándar + `File.upload` de expo-file-system: funciona en Expo Go y en el APK.

## Riesgo y alternativa (opción B)
Si `react-native-tcp-socket` fallara con la Nueva Arquitectura, la opción B es un módulo Expo local
(Kotlin) con un servidor HTTP/WebSocket nativo que implemente la misma interfaz `ControlServer` /
`FileReceiver` de `transport.ts`; el resto de la app no cambia.
