# ADR 0002 — CFG-2: solo MANUAL/AUTOMÁTICO, marcador manual y disparo con cámara estable

**Estado:** aceptado · **Fecha:** 2026-10-02

## Decisión
1. Se elimina el modo MIXTO (contexto §25.1). En MANUAL el intervalo se desactiva visualmente (atenuado).
2. El cambio de marcador es siempre manual; en AUTOMÁTICO solo con la pasada en pausa (§25.2).
   *Pausar* siempre visible.
3. En AUTOMÁTICO la foto solo se toma si el celular está quieto: `src/device/stabilityDetector.ts`
   combina acelerómetro (desviación estándar < 0,025 g) y giroscopio (< 0,12 rad/s) en una ventana de
   600 ms, sostenido 350 ms; espera máximo 1200 ms. Si no se estabiliza, la cámara responde con el motivo
   `CAMARA_EN_MOVIMIENTO` (supuesto S-03) y el controlador lo trata como repetible.
4. Parámetros en `src/config/defaults.ts` (CONFIG_VERSION = 'CFG-2'), validados por
   `checkConfigCoherence()` y `__tests__/config.test.ts`.

## Supuestos documentados
- **S-03** motivo de calidad `CAMARA_EN_MOVIMIENTO`.
- **S-04** códigos de aviso de UI adicionales (CAMARA_RECONECTADA, PRUEBA_APROBADA, PASADA_INICIADA, ...).
- **S-05** claves `app_meta`: `ui_sounds`, `ui_haptics`, `last_online_user_id`.
- **S-06** `onCapture` del receptor recibe `remoteAddress` para validar que la foto viene de la cámara emparejada.
- SQLite se abre con `openDatabaseAsync` (no `SQLiteProvider`) para poder usarlo fuera de componentes.
