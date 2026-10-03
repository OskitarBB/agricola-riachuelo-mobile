# Informe de avance — App móvil v0.2.0 (formato maestro §23.2)

**Fecha:** 2026-10-02 · **Fases entregadas:** 0, 1, 2 y 3 · **Configuración:** CFG-2

## Hecho
- Fase 0: proyecto Expo SDK 57, capas, configuración centralizada, migración SQLite 001, textos centralizados.
- Fase 1: login online/offline con logo animado, registro, cuenta pendiente, recuperación, cambio
  obligatorio de contraseña, función del dispositivo, permisos, cierre de sesión (RN-19).
- Fase 2: QR de vinculación, protocolo local v1 (ACK, reintentos, heartbeat, RESYNC), receptor HTTP con MD5,
  prueba corta, simulador con dos cámaras virtuales para Expo Go.
- Fase 3: sesión, pasadas por lateral, marcadores, captura MANUAL/AUTOMÁTICA, disparo solo con cámara estable,
  calidad técnica Q0, repetición, pausa/reanudación, cierre de pasada y de sesión, incidencias, galería.
- UI: animaciones, sonidos y vibración en botones (configurables), mensajes cortos.

## Validación
- `tsc --noEmit` sin errores · `expo lint` sin errores ni avisos · Jest 8 suites / 45 pruebas OK.
- `expo export` Android e iOS OK (bundle Hermes ≈ 4,9 MB). `expo config` OK.
- `expo-doctor`: 19/21; los 2 restantes requieren internet (esquema y React Native Directory).

## Pendiente
- Fase 4: sincronización con la web/base de datos (`src/sync/syncService.ts`).
- Calibración en campo de umbrales de calidad y estabilidad; evidencias en `docs/evidencias/`.
- Prueba de vinculación real con 3 Android (APK EAS).
