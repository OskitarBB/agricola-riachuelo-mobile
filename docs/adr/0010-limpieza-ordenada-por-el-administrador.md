# ADR 0010 — Limpieza ordenada por el administrador (app 0.5.1, CFG-9)

09/10/2026 · Aceptada · Plataforma v1.3.1 (ADR-W-008)

## Contexto

La plataforma permite al ADMINISTRADOR borrar para siempre una sesión o las fotos descartadas por la IA. El celular
tenía copia de esas fotos y, si no estaban sincronizadas, las volvería a subir.

## Decisión

- Al empezar cada sincronización (como máximo cada `cleanup.checkIntervalMs`, 10 min) la app pide
  `GET /api/v1/mobile/deleted-captures?since=<cursor>` y, para cada foto o sesión borrada, borra el archivo, marca
  `file_deleted_at` y cierra sus elementos de la cola (`HECHO` con `SESSION_DELETED` / `CAPTURE_DELETED`). La fila
  local se conserva (RN-09). El cursor se guarda en `app_meta.deleted_cursor`.
- Si el servidor responde **410 `SESSION_DELETED` o `CAPTURE_DELETED`** al sincronizar, se hace lo mismo con esa sesión
  o foto: no es un error, no se reintenta.
- Nuevos: `src/api/deletionApi.ts`, `src/domain/deletions.ts`, `src/storage/repositories/deletionRepo.ts`,
  `src/sync/deletionService.ts`; CFG-9 (`cleanup.*`). Versión 0.5.1 (versionCode 11): los tres celulares con la misma.

## Consecuencias

- Una app 0.5.0 trata el 410 como error definitivo (queda en «Errores» de PANT-20): conviene instalar 0.5.1 en los tres.
- Probado: jest (144), integración contra Django local 32/32 (2 pasos nuevos).
